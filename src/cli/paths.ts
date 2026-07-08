import { existsSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';

/** Single source of truth for where a globally-installed elowen keeps its state. Everything persistent
 *  lives OUTSIDE the npm package (which `npm update` overwrites): the SQLite DB, logs and the run
 *  file all sit under `~/.config/elowen` so an update never touches user data. Each resolver takes the
 *  process env so it stays pure and testable; the daemon's own default (src/daemon/index.ts) matches. */
export function dataDir(env: NodeJS.ProcessEnv): string {
  return join(env.HOME ?? '', '.config', 'elowen');
}

/** One-time, non-destructive shim for the Orca→Elowen rename of the default state dir + DB filename
 *  (`~/.config/orca/orca.db` → `~/.config/elowen/elowen.db`). When ONLY the legacy paths exist, symlink
 *  the new default onto them so an in-place upgrade keeps reading the same DB/logs/run file instead of
 *  silently starting empty. It never moves or deletes the old data (an explicit ELOWEN_DB/ORCA_DB
 *  override still resolves to the real path) and is a no-op once the new dir/file exists. Call once at
 *  process start, before the DB is opened. */
export function migrateLegacyConfigDir(env: NodeJS.ProcessEnv): void {
  const home = env.HOME ?? '';
  if (!home) return;
  const nextDir = join(home, '.config', 'elowen');
  const prevDir = join(home, '.config', 'orca');
  // Only bridge when the legacy dir is the sole one present (a genuine pre-rename upgrade).
  if (!existsSync(nextDir) && existsSync(prevDir)) {
    try { symlinkSync(prevDir, nextDir); } catch { /* best-effort — a fresh empty dir is the fallback */ }
  }
  // The DB file was renamed too; bridge the filename inside the (now-linked) dir so the new default
  // path resolves to the existing database rather than creating an empty one beside it.
  const nextDb = join(nextDir, 'elowen.db');
  const prevDb = join(nextDir, 'orca.db');
  if (existsSync(nextDir) && !existsSync(nextDb) && existsSync(prevDb)) {
    try { symlinkSync(prevDb, nextDb); } catch { /* best-effort */ }
  }
}

export function dbPath(env: NodeJS.ProcessEnv): string {
  return (env.ELOWEN_DB ?? env.ORCA_DB) ?? join(dataDir(env), 'elowen.db');
}

export function logDir(env: NodeJS.ProcessEnv): string {
  return (env.ELOWEN_LOG_DIR ?? env.ORCA_LOG_DIR) ?? join(dataDir(env), 'logs');
}

export function runFile(env: NodeJS.ProcessEnv): string {
  return join(dataDir(env), 'run.json');
}
