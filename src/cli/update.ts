import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, constants } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, basename } from 'node:path';
import { isNewer } from './version.js';
import { start, stop } from './launcher.js';
import { readInstallInfo } from './installInfo.js';
import { SERVICES, systemctl } from './systemd.js';

const execFileAsync = promisify(execFile);

/** The npm `--prefix` this very binary lives under, so `orca update` reinstalls *itself* in place —
 *  no matter where it was globally installed (e.g. a www-data-owned prefix), and without the operator
 *  having to remember any `--prefix`. Returns null when run from a source checkout (no node_modules in
 *  the path), in which case we let npm use its default global prefix. Exported so `orca install` pins
 *  the exact same self-reinstall command in sudoers. */
export function selfPrefix(): string | null {
  const here = fileURLToPath(import.meta.url); // <prefix>[/lib]/node_modules/orcasynth/dist/cli/update.js
  const idx = here.lastIndexOf('/node_modules/');
  if (idx === -1) return null;
  let base = here.slice(0, idx); // <prefix>/lib  (global, has lib/)  OR  <prefix>  (prefix-style install)
  if (basename(base) === 'lib') base = dirname(base);
  return base;
}

/** The exact `node_modules` directory npm rewrites on an in-place self-update (it renames the
 *  orcasynth package to a temp sibling there). Writability of THIS dir decides whether the reinstall
 *  needs root. Derived straight from the binary's own path so it's correct for both `lib/node_modules`
 *  (global) and bare-`node_modules` prefixes. Null from a source checkout. */
function selfPackagesDir(): string | null {
  const here = fileURLToPath(import.meta.url);
  const marker = '/node_modules/';
  const idx = here.lastIndexOf(marker);
  return idx === -1 ? null : here.slice(0, idx + marker.length - 1);
}

/** The npm args that reinstall orcasynth in place, pinned identically by `orca install` (sudoers) and
 *  run by `orca update` — the single source of truth for the self-update command. */
export function reinstallNpmArgs(prefix: string | null): string[] {
  return ['install', '-g', 'orcasynth@latest', ...(prefix ? ['--prefix', prefix] : [])];
}

/** Injectable IO for the in-place reinstall, so the root-vs-not decision is unit-testable. */
export interface ReinstallIO {
  packagesDir: () => string | null;
  prefix: () => string | null;
  writable: (dir: string) => Promise<boolean>;
  exec: (cmd: string, args: string[]) => Promise<void>;
}

const defaultReinstallIO: ReinstallIO = {
  packagesDir: selfPackagesDir,
  prefix: selfPrefix,
  writable: async (dir) => { try { await access(dir, constants.W_OK); return true; } catch { return false; } },
  exec: async (cmd, args) => { await execFileAsync(cmd, args); },
};

/** Reinstall orcasynth in place. When the global packages dir isn't writable by the current user
 *  (the common "installed as root in /usr, daemon runs as a non-root service user" layout), route
 *  the npm install through `sudo` — `orca install` grants exactly this command via a pinned sudoers
 *  drop-in. A writable prefix (root, or a service-user-owned prefix) installs directly, no sudo. */
export async function reinstall(io: ReinstallIO = defaultReinstallIO): Promise<void> {
  const args = reinstallNpmArgs(io.prefix());
  const dir = io.packagesDir();
  const needsRoot = dir !== null && !(await io.writable(dir));
  if (needsRoot) await io.exec('sudo', ['npm', ...args]);
  else await io.exec('npm', args);
}

/** Latest published version of orcasynth from the npm registry. Uses the bare registry JSON endpoint
 *  (no npm spawn) so a version check is cheap and offline-tolerant (throws → caller reports it). */
async function checkLatest(fetchFn: typeof fetch = fetch): Promise<string> {
  const r = await fetchFn('https://registry.npmjs.org/orcasynth/latest');
  if (!r.ok) throw new Error(`registry returned ${r.status}`);
  const body = await r.json() as { version?: string };
  if (!body.version) throw new Error('registry returned no version');
  return body.version;
}

export interface UpdateDeps {
  fetch?: typeof fetch;
  current: string;
  /** Run the global install. Injected for tests; defaults to `npm i -g orcasynth@latest`. */
  install?: () => Promise<void>;
  /** Restart running services after a successful install. */
  restart?: (env: NodeJS.ProcessEnv) => Promise<void>;
}

export interface UpdateResult { updated: boolean; from: string; to: string }

/** Check npm for a newer release; if there is one, install it and restart the (running) services so
 *  the new binary takes over. The DB migrates itself on the next boot (openDb runs additive
 *  migrations), so no migration step is needed here. Returns what happened for the menu to report. */
export async function update(env: NodeJS.ProcessEnv, deps: UpdateDeps): Promise<UpdateResult> {
  const fetchFn = deps.fetch ?? fetch;
  const latest = await checkLatest(fetchFn);
  if (!isNewer(latest, deps.current)) return { updated: false, from: deps.current, to: latest };

  const install = deps.install ?? (() => reinstall());
  await install();

  // A box provisioned by `orca install` is systemd-managed — restart those units (sudo when not root).
  // A plain launcher install has no install.json — fall back to stop/start of our own spawned daemon.
  const restart = deps.restart ?? (async (e) => {
    if (readInstallInfo()) {
      const r = await systemctl('restart', ...SERVICES);
      if (r.code !== 0) throw new Error(`systemctl restart failed (code ${r.code})`);
      return;
    }
    await stop(e);
    await start(e, { version: latest });
  });
  await restart(env);

  return { updated: true, from: deps.current, to: latest };
}
