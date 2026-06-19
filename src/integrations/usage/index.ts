import { homedir } from 'node:os';
import { resolveExecutor } from '../../overseer/routing.js';
import type { AgentSpec } from '../../spawn/commandBuilder.js';
import type { Task } from '../../store/types.js';
import { opencodeUsage } from './opencode.js';
import { claudeUsage } from './claude.js';
import { codexUsage } from './codex.js';
import type { TokenUsage } from './types.js';

export type { TokenUsage } from './types.js';

/** Parse a SQLite ("2026-06-19 11:13:20", UTC) or ISO timestamp to epoch ms. */
function parseTs(ts?: string | null): number {
  if (!ts) return 0;
  const ms = Date.parse(ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z');
  return Number.isNaN(ms) ? 0 : ms;
}

/** Token usage for a task's agent run, read from the executor CLI's local session storage.
 *  Chooses the parser by the task's resolved program and matches the session by project dir +
 *  the task's start time. Returns null when no matching session is found (e.g. CLI not used).
 *  LIMITATION: the (dir + start-time) heuristic cannot disambiguate two agents that start in the
 *  same project dir within the skew window (max_sessions >= 2) — both resolve to the same earliest
 *  session, so usage may be mis-attributed. orca's missions are sequential (one agent per dir at a
 *  time), so this doesn't bite today; the robust fix is to record the CLI's own session id at spawn. */
export function readTaskUsage(task: Pick<Task, 'labels' | 'created_at'>, projectPath: string, fallback: AgentSpec, home: string = homedir()): TokenUsage | null {
  const spec = resolveExecutor(task.labels ?? [], fallback);
  const since = parseTs(task.created_at);
  const program = spec.program.startsWith('opencode') ? 'opencode' : spec.program;
  switch (program) {
    case 'opencode': return opencodeUsage(home, projectPath, since);
    case 'claude-code': return claudeUsage(home, projectPath, since);
    case 'codex': return codexUsage(home, projectPath, since);
    default: return null;
  }
}
