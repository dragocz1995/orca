import { join } from 'node:path';

/** Single source of truth for where a globally-installed orca keeps its state. Everything persistent
 *  lives OUTSIDE the npm package (which `npm update` overwrites): the SQLite DB, logs and the run
 *  file all sit under `~/.config/orca` so an update never touches user data. Each resolver takes the
 *  process env so it stays pure and testable; the daemon's own default (src/daemon/index.ts) matches. */
export function dataDir(env: NodeJS.ProcessEnv): string {
  return join(env.HOME ?? '', '.config', 'orca');
}

export function dbPath(env: NodeJS.ProcessEnv): string {
  return env.ORCA_DB ?? join(dataDir(env), 'orca.db');
}

export function logDir(env: NodeJS.ProcessEnv): string {
  return env.ORCA_LOG_DIR ?? join(dataDir(env), 'logs');
}

export function runFile(env: NodeJS.ProcessEnv): string {
  return join(dataDir(env), 'run.json');
}
