import { execFileSync } from 'node:child_process';
import * as p from '../ui/prompts.js';
import { defaultLifecycleDeps, runLifecycle } from '../commands.js';
import { readInstallInfo } from '../installInfo.js';
import { SERVICES, systemctl } from '../systemd.js';
import { clearMarker, isOnboarded, readMarker } from './marker.js';
import { runOnboarding } from './wizard.js';

/** `elowen setup [--reset] [--debug]` — run the onboarding wizard on demand. In a non-interactive shell it
 *  NEVER blocks: it prints the next step and exits 0 (so CI / Docker / pipes are unaffected). Otherwise
 *  it makes sure the daemon is up (the wizard talks to it over the API), then runs. */
export async function runSetup(args: string[], env: NodeJS.ProcessEnv, base: string, version: string): Promise<void> {
  const reset = args.includes('--reset');
  const debug = args.includes('--debug');
  const nonInteractive = args.includes('--non-interactive') || args.includes('--yes') || args.includes('-y');

  // Non-interactive: flag-driven setup (agents / CI / E2E). Works in or out of a TTY; never prompts.
  if (nonInteractive) {
    if (reset) clearMarker(env);
    try { await bringUp(base, env, version); }
    catch (e) { console.error(`Couldn't start the Elowen daemon: ${(e as Error).message}`); process.exit(1); }
    try {
      const { runHeadlessSetup } = await import('./headless.js');
      await runHeadlessSetup(base, env, args);
    } catch (e) {
      console.error(debug ? ((e as Error).stack ?? String(e)) : (e as Error).message);
      process.exit(1);
    }
    return;
  }

  if (!process.stdout.isTTY) {
    if (reset) clearMarker(env);
    console.log(isOnboarded(env)
      ? 'Elowen is set up. Run `elowen setup` in an interactive terminal to reconfigure.'
      : 'Elowen is not set up yet. Run `elowen setup` in an interactive terminal to get started.');
    return;
  }

  if (reset) clearMarker(env);
  else if (isOnboarded(env)) p.log.info('Elowen is already set up — re-running the wizard (use `elowen setup --reset` to start clean).');

  warnMissingPrereqs();

  try { await bringUp(base, env, version); }
  catch (e) { console.error(`Couldn't start the Elowen daemon: ${(e as Error).message}`); process.exit(1); }

  try {
    await runOnboarding(base, env, { reset });
  } catch (e) {
    // Never dump a stack unless the operator asked for it — a human message is the default.
    console.error(debug ? ((e as Error).stack ?? String(e)) : (e as Error).message);
    process.exit(1);
  }
}

/** The single first-run gate for the launcher menus: offer setup once, never re-nag after completion, and
 *  stay silent (and daemon-free) in a non-TTY or when already onboarded. */
export async function maybeOfferSetup(base: string, env: NodeJS.ProcessEnv, version: string): Promise<void> {
  if (!process.stdout.isTTY || isOnboarded(env)) return;
  const resume = readMarker(env)?.resume;
  const go = await p.confirm({ message: resume ? 'Resume your Elowen setup?' : 'Set up Elowen now? (about 2 minutes)', initialValue: true });
  if (p.isCancel(go) || !go) return;
  try { await bringUp(base, env, version); }
  catch (e) { p.log.error(`Couldn't start the Elowen daemon: ${(e as Error).message}`); return; }
  // The wizard is a guest inside the launcher menu here — a mid-step failure (daemon died, fetch failed)
  // must return to the menu like every other menu action, not crash the whole `elowen` process.
  try { await runOnboarding(base, env, {}); }
  catch (e) { p.log.error((e as Error).message); }
}

/** Warn (never block) about missing prerequisites before the wizard runs. tmux is the real one — agents
 *  run inside tmux, so tasks can't launch without it (mirrors the `elowen install` preflight copy). Node is
 *  already >=22 by the time this JS runs, so it needs no check here. We only inform + print the platform's
 *  install hint and continue — setup usually runs as an unprivileged local user, so we don't offer to
 *  apt-install like `elowen install` does. */
function warnMissingPrereqs(): void {
  if (hasCommand('tmux')) return;
  p.log.warn('tmux is required to run agents and is not installed — tasks will not run until it is.');
  p.note(tmuxInstallHint(), 'Install tmux');
}

/** True when `cmd` resolves on PATH. Uses a login shell so it matches the same PATH agents get, like the
 *  install runner's `which`. */
function hasCommand(cmd: string): boolean {
  try { execFileSync('bash', ['-lc', `command -v ${cmd}`], { stdio: 'ignore' }); return true; }
  catch { return false; }
}

/** The exact install command for this platform, or a generic fallback when no known manager is present. */
function tmuxInstallHint(): string {
  if (process.platform === 'darwin') return 'brew install tmux';
  if (hasCommand('apt-get')) return 'sudo apt install tmux';
  if (hasCommand('dnf')) return 'sudo dnf install tmux';
  if (hasCommand('pacman')) return 'sudo pacman -S tmux';
  return 'install tmux with your system package manager';
}

/** Bring the daemon up the right way for this box: nothing if it's already healthy, else systemctl on an
 *  `elowen install` box (never a second, port-conflicting detached daemon), otherwise the local lifecycle. */
async function bringUp(base: string, env: NodeJS.ProcessEnv, version: string): Promise<void> {
  try { await fetch(`${base}/health`); return; } catch { /* down — start it below */ }
  if (readInstallInfo()) {
    const r = await systemctl('start', ...SERVICES);
    if (r.code !== 0) throw new Error(`systemctl start failed (code ${r.code})`);
    for (let i = 0; i < 50; i++) { try { await fetch(`${base}/health`); return; } catch { await sleep(100); } }
    throw new Error('daemon did not become healthy');
  }
  await runLifecycle('up', env, defaultLifecycleDeps(version));
}

function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }
