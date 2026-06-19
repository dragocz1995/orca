import type { Task, Mission, DerivedSignal } from './types';
import { taskSessionName, parseTs } from './agentUtils';

/** Children of each epic, keyed by epic id, in sequence order (oldest first). */
export function epicChildren(tasks: Task[]): Map<string, Task[]> {
  const epicIds = new Set(tasks.filter((t) => t.type === 'epic').map((t) => t.id));
  const out = new Map<string, Task[]>();
  for (const t of tasks) {
    if (t.parent_id && epicIds.has(t.parent_id)) {
      const list = out.get(t.parent_id) ?? [];
      list.push(t);
      out.set(t.parent_id, list);
    }
  }
  for (const list of out.values()) list.sort((a, b) => (parseTs(a.created_at) ?? 0) - (parseTs(b.created_at) ?? 0));
  return out;
}

/** Ids of every task that is a phase under some epic (so the flat list can hide them). */
export function phaseIds(tasks: Task[]): Set<string> {
  const ids = new Set<string>();
  for (const list of epicChildren(tasks).values()) for (const c of list) ids.add(c.id);
  return ids;
}

/** Done / total progress across an epic's phases. */
export function epicProgress(children: Task[]): { done: number; total: number } {
  const done = children.filter((c) => c.status === 'closed' || c.status === 'cancelled').length;
  return { done, total: children.length };
}

/** Aggregate live state of an epic's phases: how many are running and how many await input. */
export function epicLive(children: Task[], sessions: string[], signals: Record<string, DerivedSignal>): { running: number; needsInput: number } {
  let running = 0;
  let needsInput = 0;
  for (const c of children) {
    const s = taskSessionName(c);
    if (c.status === 'in_progress' && s && sessions.includes(s)) running++;
    if (s && signals[s]?.type === 'needs_input') needsInput++;
  }
  return { running, needsInput };
}

/** Mission capacity: how many of the maxSessions slots are occupied by live running phases.
 *  `running` is clamped to [0, max] so a stale in_progress child without a live session never
 *  over-reports. `free` is the number of slots still open for the overseer to schedule into. */
export function epicCapacity(children: Task[], sessions: string[], maxSessions: number): { running: number; max: number; free: number } {
  let running = 0;
  for (const c of children) {
    const s = taskSessionName(c);
    if (c.status === 'in_progress' && s && sessions.includes(s)) running++;
  }
  const max = Math.max(0, Math.floor(maxSessions));
  const clamped = Math.min(running, max);
  return { running: clamped, max, free: Math.max(0, max - clamped) };
}

/** Effective status of an epic on the kanban board: while a mission is actively engaged
 *  (any state other than 'disengaged'), the epic is shown as 'in_progress' regardless of
 *  its true task status — epics stay 'open' underneath. The true status stays available
 *  separately (e.g. for a title/tooltip). */
export function epicEffectiveStatus(epic: Task, missions: Mission[]): Task['status'] {
  if (epic.type !== 'epic') return epic.status;
  const active = missions.some((m) => m.epic_id === epic.id && m.state !== 'disengaged');
  return active ? 'in_progress' : epic.status;
}
