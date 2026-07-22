import { spawn as nodeSpawn } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dataDir, dbPath, logDir, runFile } from '../shared/paths.js';

interface Svc { pid: number; port: number }
export interface RunState { daemon: Svc; web: Svc; version: string; startedAt: string }
export interface SvcStatus { running: boolean; pid: number | null; port: number; healthy: boolean }

const DAEMON_PORT = 4400;
const WEB_PORT = 4500;

/** Read the tracked run state, or null when absent/corrupt. A corrupt file (partial write, manual
 *  edit) must not throw — the caller treats null as "nothing running" and can re-start cleanly. */
export function readState(env: NodeJS.ProcessEnv): RunState | null {
  try { return JSON.parse(readFileSync(runFile(env), 'utf8')) as RunState; }
  catch { return null; }
}

export function writeState(env: NodeJS.ProcessEnv, state: RunState): void {
  mkdirSync(dataDir(env), { recursive: true });
  writeFileSync(runFile(env), JSON.stringify(state, null, 2), 'utf8');
}

export function clearState(env: NodeJS.ProcessEnv): void {
  rmSync(runFile(env), { force: true });
}

/** Liveness via signal 0: it delivers nothing but still does the permission/existence check. ESRCH
 *  means gone; EPERM means alive but owned by another user (still "alive" for our purposes). */
export function isAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; }
}

/** Which tracked service a pid claims to be — its entry script is the birth-identity marker. */
export type ServiceMark = 'daemon' | 'web';
const ENTRY_MARK: Record<ServiceMark, string> = { daemon: 'daemon/index.js', web: 'web-dist/server.js' };

/** A pid liveness+identity predicate; injectable so tests need not mint real daemon processes. */
export type IsTracked = (pid: number, mark: ServiceMark) => boolean;

/** Whether a tracked pid is STILL our service, not an unrelated pid that reused the number after a
 *  reboot/crash. A bare `isAlive` check is not enough: run.json survives a reboot, the OS recycles pids,
 *  and `stop` would then SIGTERM an innocent process while `start` would adopt it as "already running"
 *  and never spawn. On Linux we birth-validate by matching the procfs argv against the service's entry
 *  script; a dead pid, or one whose argv doesn't carry the entry, is "not ours". Off Linux there is no
 *  /proc, so this falls back to liveness alone (best effort — documented). */
export function isTrackedService(pid: number, mark: ServiceMark): boolean {
  if (!isAlive(pid)) return false;
  if (process.platform !== 'linux') return true; // no procfs — liveness is all we have
  try {
    const cmdline = readFileSync(`/proc/${pid}/cmdline`, 'utf8'); // NUL-separated argv
    return cmdline.split('\0').some((arg) => arg.includes(ENTRY_MARK[mark]));
  } catch {
    return false; // /proc unreadable or the pid vanished mid-check → cannot confirm it is ours
  }
}

async function portHealthy(fetchFn: typeof fetch, port: number, path: string): Promise<boolean> {
  try { const r = await fetchFn(`http://127.0.0.1:${port}${path}`); return r.ok; }
  catch { return false; }
}

/** Status of both services: a service is `running` when its tracked pid is alive, and `healthy` when
 *  its port also answers (a recycled pid or a wedged process is running-but-unhealthy). */
export async function status(env: NodeJS.ProcessEnv, fetchFn: typeof fetch = fetch, isTracked: IsTracked = isTrackedService): Promise<{ daemon: SvcStatus; web: SvcStatus }> {
  const state = readState(env);
  const of = async (svc: Svc | undefined, path: string, mark: ServiceMark): Promise<SvcStatus> => {
    if (!svc) return { running: false, pid: null, port: 0, healthy: false };
    const running = isTracked(svc.pid, mark);
    const healthy = running && await portHealthy(fetchFn, svc.port, path);
    return { running, pid: svc.pid, port: svc.port, healthy };
  };
  return { daemon: await of(state?.daemon, '/health', 'daemon'), web: await of(state?.web, '/', 'web') };
}

/** Stop both tracked services and forget them. Tolerates already-dead pids (kill throws → ignored).
 *  Default kill is SIGTERM via process.kill; injectable for tests. */
export async function stop(env: NodeJS.ProcessEnv, kill: (pid: number, signal?: NodeJS.Signals | number) => void = (p, s) => process.kill(p, s), isTracked: IsTracked = isTrackedService): Promise<void> {
  const state = readState(env);
  if (!state) return;
  for (const [svc, mark] of [[state.daemon, 'daemon'], [state.web, 'web']] as const) {
    // Only signal a pid we can confirm is still our service — a recycled/unrelated pid is left untouched.
    if (!isTracked(svc.pid, mark)) continue;
    try { kill(svc.pid, 'SIGTERM'); } catch { /* raced to exit — fine */ }
  }
  clearState(env);
}

export interface StartDeps {
  spawn?: typeof nodeSpawn;
  fetch?: typeof fetch;
  version: string;
  now?: () => string;
  /** ms between health polls and how many attempts before giving up. */
  pollMs?: number;
  attempts?: number;
  /** Pid liveness+identity check; injectable for tests (defaults to the procfs birth-validation). */
  isTracked?: IsTracked;
}

const here = dirname(fileURLToPath(import.meta.url)); // dist/cli at runtime
const daemonEntry = () => join(here, '..', 'daemon', 'index.js');    // dist/daemon/index.js
const webServer = () => join(here, '..', '..', 'web-dist', 'server.js'); // <pkg>/web-dist/server.js (Next standalone)

/** Start daemon + web as detached background processes and record their pids. Idempotent-ish: if both
 *  ports are already healthy it just refreshes the run file rather than double-spawning. */
export async function start(env: NodeJS.ProcessEnv, deps: StartDeps): Promise<RunState> {
  const spawn = deps.spawn ?? nodeSpawn;
  const fetchFn = deps.fetch ?? fetch;
  const now = deps.now ?? (() => new Date().toISOString());
  const pollMs = deps.pollMs ?? 200;
  const attempts = deps.attempts ?? 100;
  // Ports are overridable (ELOWEN_PORT / ELOWEN_WEB_PORT) so a second instance — or a smoke test — can run
  // alongside an existing one. Defaults are the conventional 4400/4500.
  const daemonPort = Number((env.ELOWEN_PORT) ?? DAEMON_PORT);
  const webPort = Number((env.ELOWEN_WEB_PORT) ?? WEB_PORT);
  const childEnv = { ...env, ELOWEN_DB: dbPath(env), ELOWEN_LOG_DIR: logDir(env), ELOWEN_AUTOSTART: '0' };

  const launch = (entry: string, extra: NodeJS.ProcessEnv) => {
    const child = spawn(process.execPath, [entry], { detached: true, stdio: 'ignore', env: { ...childEnv, ...extra } });
    child.unref();
    if (!child.pid) throw new Error(`failed to spawn ${entry}`);
    return child.pid;
  };

  const isTracked = deps.isTracked ?? isTrackedService;
  const existing = readState(env);
  // Adopt a tracked pid only when it is confirmably STILL our service; a stale run.json (e.g. after a
  // reboot that recycled the pid) re-spawns instead of skipping the launch and adopting a stranger.
  const daemonPid = existing && isTracked(existing.daemon.pid, 'daemon') ? existing.daemon.pid : launch(daemonEntry(), { ELOWEN_PORT: String(daemonPort) });
  const webPid = existing && isTracked(existing.web.pid, 'web') ? existing.web.pid
    : launch(webServer(), { PORT: String(webPort), HOSTNAME: '127.0.0.1', ELOWEN_DAEMON_URL: `http://127.0.0.1:${daemonPort}` });

  // Wait for the daemon to answer; the web proxies it, so it comes up second.
  let healthy = false;
  for (let i = 0; i < attempts; i++) {
    if (await portHealthy(fetchFn, daemonPort, '/health')) { healthy = true; break; }
    await new Promise((r) => setTimeout(r, pollMs));
  }

  // Record state even on failure so `elowen down`/`status` can see and clean up the spawned pids.
  const state: RunState = { daemon: { pid: daemonPid, port: daemonPort }, web: { pid: webPid, port: webPort }, version: deps.version, startedAt: now() };
  writeState(env, state);
  // But never report success when the daemon never answered: a wedged or crash-looping daemon would
  // otherwise be written as "elowen is up". Surface it so the operator knows to check the logs.
  if (!healthy) throw new Error(`elowen daemon did not become healthy on :${daemonPort} after ${Math.round((attempts * pollMs) / 1000)}s — check the logs in ${logDir(env)}`);
  return state;
}
