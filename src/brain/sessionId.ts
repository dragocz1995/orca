/** Brain session id conventions — the ONE place the `brain-*` prefixes live. Three kinds share the
 *  `brain_sessions` table: user conversations (`brain-<uid>` / `brain-<uid>-<ts36>` for fresh ones),
 *  platform channel sessions (`brain-ch-<channel>`) and task-worker sessions (`brain-task-<id>`).
 *  Channel/task sessions are never listable, resumable or deletable through the user-facing routes. */

export function defaultUserSessionId(userId: number): string {
  return `brain-${userId}`;
}

export function freshUserSessionId(userId: number): string {
  // Timestamp for rough ordering + a random suffix so two clients opening fresh conversations in the
  // same millisecond (two CLIs launched together) can never mint the SAME id and share a session.
  return `brain-${userId}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function channelSessionId(channelId: string): string {
  return `brain-ch-${channelId}`;
}

export function taskSessionId(taskId: string): string {
  return `brain-task-${taskId}`;
}

function isChannelSession(id: string): boolean {
  return id.startsWith('brain-ch-');
}

function isTaskSession(id: string): boolean {
  return id.startsWith('brain-task-');
}

/** Not a user conversation — excluded from the user's session list / resume / delete. */
export function isNonUserSession(id: string): boolean {
  return isChannelSession(id) || isTaskSession(id);
}
