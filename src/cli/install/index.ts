import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import * as p from '@clack/prompts';
import { realRunner, type Runner } from './runner.js';
import { preflight, preflightBlockers } from './preflight.js';
import { ensureServiceUser, userHome, type ServiceUserChoice } from './serviceUser.js';
import { detectAgentClis, installCommand } from './agentClis.js';
import { daemonUnit, webUnit, type UnitParams } from './systemdUnits.js';
import { detectProxy, nginxVhost, apacheVhost, certbotCommand, type ProxyKind } from './proxy.js';
import { applySetup, buildSetupPlan, isFirstRun, type SetupAnswers } from '../setup.js';
import { runSetupWizard } from '../setupWizard.js';

const DAEMON_PORT = Number(process.env.ORCA_PORT ?? 4400);
const WEB_PORT = Number(process.env.ORCA_WEB_PORT ?? 4500);

/** Everything `orca install` needs to provision a box, resolved either interactively (clack prompts)
 *  or non-interactively (CLI flags). Collecting it up front keeps the two front-ends thin and lets the
 *  executor below stay prompt-free. `admin === null` means "don't create an admin" (e.g. re-run on a
 *  box that already has one). */
interface InstallPlan {
  installTmux: boolean;
  user: ServiceUserChoice;
  agents: string[];
  domain: string | null;
  proxyPreference: ProxyKind;
  tls: boolean;
  email: string | null;
  admin: SetupAnswers | null;
}

// ── package + npm path resolution ────────────────────────────────────────────

/** Absolute paths into the globally-installed package — this file lives at
 *  <pkgRoot>/dist/cli/install/index.js, so the daemon entry and web bundle resolve relative to it. */
function packagePaths(): { daemonEntry: string; webServer: string } {
  const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  return { daemonEntry: join(pkgRoot, 'dist', 'daemon', 'index.js'), webServer: join(pkgRoot, 'web-dist', 'server.js') };
}

/** npm's global bin dir (where the `orca` symlink + globally-installed agent CLIs land). */
async function npmGlobalBin(r: Runner): Promise<string> {
  const res = await r.exec('npm', ['prefix', '-g']);
  return join(res.stdout.trim() || '/usr/local', 'bin');
}

// ── small helpers ────────────────────────────────────────────────────────────

const base = `http://127.0.0.1:${DAEMON_PORT}`;

function bail(v: unknown): asserts v is string {
  if (p.isCancel(v)) { p.cancel('Installation cancelled.'); process.exit(1); }
}

async function step<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const s = p.spinner();
  s.start(label);
  try { const out = await fn(); s.stop(`${label} ✓`); return out; }
  catch (e) { s.stop(`${label} ✗`); throw e; }
}

/** Run a command and throw with its stderr when it fails — used for the system mutations where a
 *  non-zero exit must abort the wizard rather than silently continue. */
async function must(r: Runner, cmd: string, args: string[], opts?: { user?: string }): Promise<void> {
  const res = await r.exec(cmd, args, opts);
  if (res.code !== 0) throw new Error(`${cmd} ${args.join(' ')} failed: ${(res.stderr || res.stdout).trim() || res.code}`);
}

/** Poll the daemon's /setup endpoint until it answers (services just came up) or we give up. */
async function waitForDaemon(tries = 40): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    try { if ((await fetch(`${base}/setup`)).ok) return true; } catch { /* not up yet */ }
    await new Promise((res) => setTimeout(res, 500));
  }
  return false;
}

/** End-to-end check: the admin can authenticate against the running daemon. */
async function loginSmokeTest(username: string, password: string): Promise<void> {
  const res = await fetch(`${base}/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error(`login returned ${res.status}`);
  const body = await res.json() as { token?: string };
  if (!body.token) throw new Error('login returned no token');
}

// ── prompt-free executors (shared by interactive + unattended) ───────────────

async function aptInstall(r: Runner, ...pkgs: string[]): Promise<void> {
  await must(r, 'apt-get', ['update']);
  await must(r, 'apt-get', ['install', '-y', ...pkgs]);
}

/** Write + enable the two systemd units and verify they came active. */
async function provisionSystemd(r: Runner, user: string, home: string): Promise<void> {
  const { daemonEntry, webServer } = packagePaths();
  const params: UnitParams = {
    user, home, nodePath: process.execPath, daemonEntry, webServer,
    npmGlobalBin: await npmGlobalBin(r), daemonPort: DAEMON_PORT, webPort: WEB_PORT,
  };
  // Ensure the data tree exists and is owned by the service user before first boot.
  await must(r, 'mkdir', ['-p', join(home, '.config', 'orca', 'logs')]);
  await must(r, 'chown', ['-R', `${user}:`, join(home, '.config', 'orca')]);

  await r.writeFile('/etc/systemd/system/orca-daemon.service', daemonUnit(params));
  await r.writeFile('/etc/systemd/system/orca-web.service', webUnit(params));
  await must(r, 'systemctl', ['daemon-reload']);
  await must(r, 'systemctl', ['enable', '--now', 'orca-daemon.service']);
  await must(r, 'systemctl', ['enable', '--now', 'orca-web.service']);

  for (const svc of ['orca-daemon', 'orca-web']) {
    const res = await r.exec('systemctl', ['is-active', svc]);
    if (res.stdout.trim() !== 'active') throw new Error(`${svc} did not start (journalctl -u ${svc})`);
  }
}

/** Detect the installed reverse proxy, installing the preferred one when none is present. */
async function resolveProxy(r: Runner, preference: ProxyKind): Promise<ProxyKind> {
  const existing = await detectProxy(r);
  if (existing) return existing;
  await aptInstall(r, preference === 'nginx' ? 'nginx' : 'apache2');
  return preference;
}

/** Render the vhost for the domain and make the proxy serve it. */
async function configureVhost(r: Runner, kind: ProxyKind, domain: string): Promise<void> {
  if (kind === 'nginx') {
    await r.writeFile('/etc/nginx/sites-available/orca.conf', nginxVhost(domain, WEB_PORT));
    await must(r, 'ln', ['-sf', '/etc/nginx/sites-available/orca.conf', '/etc/nginx/sites-enabled/orca.conf']);
    await must(r, 'nginx', ['-t']);
    await must(r, 'systemctl', ['reload', 'nginx']);
  } else {
    await r.writeFile('/etc/apache2/sites-available/orca.conf', apacheVhost(domain, WEB_PORT));
    await must(r, 'a2enmod', ['proxy', 'proxy_http']);
    await must(r, 'a2ensite', ['orca']);
    await must(r, 'systemctl', ['reload', 'apache2']);
  }
}

/** Install certbot if needed and obtain + install a Let's Encrypt certificate. */
async function obtainTls(r: Runner, kind: ProxyKind, domain: string, email: string | null): Promise<void> {
  if (!(await r.which('certbot'))) {
    await aptInstall(r, 'certbot', kind === 'nginx' ? 'python3-certbot-nginx' : 'python3-certbot-apache');
  }
  const { cmd, args } = certbotCommand(kind, domain, email ?? undefined);
  await must(r, cmd, args);
}

/** Create the first admin from the plan (only when the daemon has no users yet) and prove login. */
async function provisionAdmin(answers: SetupAnswers): Promise<void> {
  if (!(await isFirstRun(fetch, base))) { p.log.info('Admin already exists — skipping account creation.'); return; }
  await applySetup(fetch, base, buildSetupPlan(answers));
  await loginSmokeTest(answers.username, answers.password);
}

/** Provision a box from a fully-resolved plan. Used directly by the unattended path; the interactive
 *  path drives the same executors with spinners and inline prompts. */
async function execute(r: Runner, plan: InstallPlan): Promise<void> {
  if (plan.installTmux) await step('Installing tmux', () => aptInstall(r, 'tmux'));

  const { home } = await step(`Service user "${plan.user.username}"`, () => ensureServiceUser(r, plan.user));

  for (const id of plan.agents) {
    const { cmd, args } = installCommand({ id, bin: id, pkg: agentPkg(id) });
    await step(`Installing ${id}`, () => must(r, cmd, args));
  }

  await step('Configuring systemd services', () => provisionSystemd(r, plan.user.username, home));

  const ready = await step('Waiting for the daemon', () => waitForDaemon());
  if (!ready) throw new Error('daemon did not become reachable — check: journalctl -u orca-daemon');

  if (plan.domain) {
    const kind = await step('Configuring reverse proxy', async () => {
      const k = await resolveProxy(r, plan.proxyPreference);
      await configureVhost(r, k, plan.domain!);
      return k;
    });
    if (plan.tls) await step('Requesting HTTPS certificate', () => obtainTls(r, kind, plan.domain!, plan.email));
  }

  if (plan.admin) await step('Creating admin + verifying login', () => provisionAdmin(plan.admin!));
}

/** npm package for an agent CLI id (so the executor needn't carry the full AgentCli around). */
function agentPkg(id: string): string {
  const map: Record<string, string> = { claude: '@anthropic-ai/claude-code', opencode: 'opencode-ai', codex: '@openai/codex' };
  const pkg = map[id];
  if (!pkg) throw new Error(`unknown agent CLI: ${id}`);
  return pkg;
}

// ── unattended front-end ─────────────────────────────────────────────────────

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
}

/** Build a plan from CLI flags for `--unattended`. Resolves create-vs-existing from whether the user
 *  already exists, so the same command is idempotent across re-runs. */
async function planFromArgs(r: Runner, args: string[]): Promise<InstallPlan> {
  const username = flag(args, '--user') ?? 'orca';
  const exists = (await userHome(r, username)) !== null;

  const agentsRaw = flag(args, '--agents');
  const agents = !agentsRaw || agentsRaw === 'none' ? []
    : agentsRaw === 'all' ? ['claude', 'opencode', 'codex']
    : agentsRaw.split(',').map((s) => s.trim()).filter(Boolean);

  const domain = flag(args, '--domain') ?? null;
  const adminUser = flag(args, '--admin-user');
  const adminPass = flag(args, '--admin-pass');
  const admin: SetupAnswers | null = adminUser && adminPass
    ? { username: adminUser, password: adminPass, apiUrl: flag(args, '--llm-url') ?? 'https://api.openai.com/v1', apiKey: flag(args, '--llm-key') ?? '', model: flag(args, '--llm-model') ?? 'gpt-4o-mini' }
    : null;

  return {
    installTmux: !args.includes('--no-tmux'),
    user: { mode: exists ? 'existing' : 'create', username },
    agents,
    domain,
    proxyPreference: flag(args, '--proxy') === 'apache' ? 'apache' : 'nginx',
    tls: domain !== null && !args.includes('--no-tls'),
    email: flag(args, '--email') ?? null,
    admin,
  };
}

// ── interactive front-end ────────────────────────────────────────────────────

async function chooseServiceUser(): Promise<ServiceUserChoice> {
  const mode = await p.select({
    message: 'Which user should the ORCA services and agents run as?',
    options: [
      { value: 'create', label: 'Create a dedicated "orca" system user', hint: 'recommended' },
      { value: 'existing', label: 'Use an existing user' },
    ],
  });
  bail(mode);
  const name = await p.text({
    message: mode === 'existing' ? 'Existing username' : 'New username',
    initialValue: mode === 'existing' ? '' : 'orca',
    validate: (v) => (mode === 'existing' && !(v ?? '').trim() ? 'Required' : undefined),
  });
  bail(name);
  return { mode: mode as ServiceUserChoice['mode'], username: name.trim() || 'orca' };
}

async function chooseAgents(r: Runner, user: string): Promise<string[]> {
  const detected = await detectAgentClis(r, user);
  const installed = detected.filter((c) => c.installed).map((c) => c.id);
  const missing = detected.filter((c) => !c.installed);
  if (installed.length) p.log.success(`Found agent CLIs: ${installed.join(', ')}`);
  if (!missing.length) return [];

  const pick = await p.multiselect({
    message: 'Install missing agent CLIs? (space to toggle, enter to confirm)',
    required: false,
    options: missing.map((c) => ({ value: c.id, label: c.id, hint: c.pkg })),
  });
  if (p.isCancel(pick)) return [];
  return pick as string[];
}

async function chooseProxy(r: Runner): Promise<{ domain: string | null; proxyPreference: ProxyKind; tls: boolean; email: string | null }> {
  const domain = await p.text({
    message: 'Domain for the web UI (blank to skip the reverse proxy and serve on localhost only)',
    placeholder: 'orca.example.com',
  });
  bail(domain);
  if (!domain.trim()) return { domain: null, proxyPreference: 'nginx', tls: false, email: null };

  let proxyPreference: ProxyKind = 'nginx';
  if (!(await detectProxy(r))) {
    const which = await p.select({
      message: 'No reverse proxy found. Install one?',
      options: [{ value: 'nginx', label: 'nginx', hint: 'recommended' }, { value: 'apache', label: 'apache2' }],
    });
    bail(which);
    proxyPreference = which as ProxyKind;
  }

  const wantTls = await p.confirm({ message: `Obtain a free HTTPS certificate for ${domain.trim()} via Let's Encrypt?` });
  if (p.isCancel(wantTls) || !wantTls) return { domain: domain.trim(), proxyPreference, tls: false, email: null };
  const email = await p.text({ message: 'Email for renewal notices (blank to register without email)', placeholder: 'you@example.com' });
  bail(email);
  return { domain: domain.trim(), proxyPreference, tls: true, email: email.trim() || null };
}

// ── entry point ──────────────────────────────────────────────────────────────

/** `orca install` — provision a fresh Debian/Ubuntu box. Run as root. Pass `--unattended` (with flags)
 *  for a non-interactive install; otherwise an interactive wizard collects every answer. */
export async function install(args: string[] = []): Promise<void> {
  const r = realRunner();
  const unattended = args.includes('--unattended');
  p.intro(`🐋 orca install${unattended ? ' (unattended)' : ''}`);

  const pf = await preflight(r);
  const blockers = preflightBlockers(pf);
  if (blockers.length) { blockers.forEach((b) => p.log.error(b)); p.outro('Cannot continue.'); process.exit(1); }
  if (pf.tmux) p.log.success('tmux present');

  let plan: InstallPlan;
  if (unattended) {
    plan = await planFromArgs(r, args);
  } else {
    let installTmux = false;
    if (!pf.tmux) {
      const wantTmux = await p.confirm({ message: 'tmux is required to run agents and is not installed. Install it now?' });
      installTmux = !p.isCancel(wantTmux) && wantTmux === true;
      if (!installTmux) p.log.warn('Continuing without tmux — agents will not run until it is installed.');
    }
    const user = await chooseServiceUser();
    const agents = await chooseAgents(r, user.username);
    const proxy = await chooseProxy(r);
    // Admin is created via the shared wizard AFTER the daemon is up, so collect it there instead.
    plan = { installTmux, user, agents, ...proxy, admin: null };
  }

  await execute(r, plan);

  // Interactive: now that the daemon is live, run the shared first-run wizard for the admin + LLM.
  if (!unattended) {
    p.log.step('Create the first admin account');
    const creds = await runSetupWizard(base);
    if (creds) await step('Verifying login', () => loginSmokeTest(creds.username, creds.password));
  }

  const url = plan.domain ? (plan.tls ? `https://${plan.domain}` : `http://${plan.domain}`) : `http://127.0.0.1:${WEB_PORT}`;
  p.log.info('Manage the services with: systemctl status orca-daemon orca-web');
  p.outro(`Done — ORCA is live at ${url} 🐋`);
}
