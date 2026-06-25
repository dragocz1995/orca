import Database from 'better-sqlite3';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';
import { homedir } from 'node:os';
import { walkFiles } from './walk.js';

/** Outcome of clearing one executor's session store. `cleared` is false when the store was absent
 *  (a no-op) or when it errored — `error` distinguishes the two. `removed` counts deleted rows/files. */
interface ExecClearResult { cleared: boolean; removed: number; error?: string }
export interface ResetResult { opencode: ExecClearResult; claude: ExecClearResult; codex: ExecClearResult }

/** Destructively clear every CLI session store that usage is summed from, for the daemon user's HOME.
 *  Symmetric to the readers in this folder (opencode/claude/codex). Best-effort and isolated: each
 *  executor is cleared in its own try/catch so one failure (locked db, EACCES, missing dir) can never
 *  abort the others. Returns a per-executor summary. HOME is resolved like the readers (`homedir()`). */
export function clearAllUsage(home: string = homedir()): ResetResult {
  return { opencode: clearOpencode(home), claude: clearClaude(home), codex: clearCodex(home) };
}

/** opencode keeps sessions (with their token/cost columns) in a SQLite `session` table. Delete the
 *  rows, leaving the schema intact for the next agent run. */
function clearOpencode(home: string): ExecClearResult {
  const dbPath = join(home, '.local', 'share', 'opencode', 'opencode.db');
  if (!existsSync(dbPath)) return { cleared: false, removed: 0 };
  let db: Database.Database | null = null;
  try {
    db = new Database(dbPath, { fileMustExist: true });
    const removed = db.prepare('DELETE FROM session').run().changes;
    return { cleared: true, removed };
  } catch (e) {
    console.error('[usage/reset] opencode clear failed', e);
    return { cleared: false, removed: 0, error: String(e) };
  } finally {
    db?.close();
  }
}

/** claude-code stores one JSONL transcript per session under ~/.claude/projects/<encoded-cwd>/.
 *  Reset has no cwd, so sweep every project dir and remove all transcripts. */
function clearClaude(home: string): ExecClearResult {
  const root = join(home, '.claude', 'projects');
  if (!existsSync(root)) return { cleared: false, removed: 0 };
  try {
    let removed = 0;
    for (const proj of readdirSync(root, { withFileTypes: true })) {
      if (!proj.isDirectory()) continue;
      const dir = join(root, proj.name);
      for (const name of readdirSync(dir)) {
        if (!name.endsWith('.jsonl')) continue;
        rmSync(join(dir, name), { force: true });
        removed++;
      }
    }
    return { cleared: true, removed };
  } catch (e) {
    console.error('[usage/reset] claude clear failed', e);
    return { cleared: false, removed: 0, error: String(e) };
  }
}

/** codex stores one rollout JSONL per session under ~/.codex/sessions/<Y>/<M>/<D>/rollout-*.jsonl.
 *  Walk the date-nested tree and remove only the rollouts, leaving any siblings untouched. */
function clearCodex(home: string): ExecClearResult {
  const root = join(home, '.codex', 'sessions');
  if (!existsSync(root)) return { cleared: false, removed: 0 };
  try {
    let removed = 0;
    for (const f of walkFiles(root)) {
      if (!basename(f).startsWith('rollout-') || !f.endsWith('.jsonl')) continue;
      rmSync(f, { force: true });
      removed++;
    }
    return { cleared: true, removed };
  } catch (e) {
    console.error('[usage/reset] codex clear failed', e);
    return { cleared: false, removed: 0, error: String(e) };
  }
}
