import { openDb } from '../store/db.js';
import { ConfigStore } from '../store/configStore.js';
import { MissionStore } from '../store/missionStore.js';
import { dbPath } from './paths.js';
import { update, type UpdateResult } from './update.js';

/** What `orca update --auto` (the hourly systemd timer) decided. It only upgrades when the operator
 *  opted in (config.autoUpdate) AND no mission is live — restarting the daemon mid-mission would kill
 *  the running agent sessions, so a busy box defers to the next tick. */
export type AutoUpdateOutcome =
  | { ran: false; reason: 'disabled' | 'busy' }
  | { ran: true; result: UpdateResult };

export interface AutoUpdateDeps {
  current: string;
  /** Reads the opt-in flag + whether any mission is live. Injected for tests; defaults to opening the
   *  daemon's own SQLite DB read-only (WAL lets us read alongside the running daemon). */
  gate?: () => { enabled: boolean; busy: boolean };
  /** The actual updater. Injected for tests; defaults to the real npm install + restart. */
  runUpdate?: (env: NodeJS.ProcessEnv, deps: { current: string }) => Promise<UpdateResult>;
}

function readGate(env: NodeJS.ProcessEnv): { enabled: boolean; busy: boolean } {
  const db = openDb(dbPath(env));
  try {
    const enabled = new ConfigStore(db).get().autoUpdate;
    const busy = new MissionStore(db).live().length > 0;
    return { enabled, busy };
  } finally {
    db.close();
  }
}

/** Gate, then update. Never throws on the "skip" paths — a disabled or busy box is a normal no-op for
 *  the timer, not a failure (so `systemctl status orca-update` stays green). */
export async function autoUpdate(env: NodeJS.ProcessEnv, deps: AutoUpdateDeps): Promise<AutoUpdateOutcome> {
  const { enabled, busy } = (deps.gate ?? (() => readGate(env)))();
  if (!enabled) return { ran: false, reason: 'disabled' };
  if (busy) return { ran: false, reason: 'busy' };
  const run = deps.runUpdate ?? update;
  return { ran: true, result: await run(env, { current: deps.current }) };
}
