import type { ActivityEvent, Task } from './types';
import type { DepEdge } from './agentUtils';

/** A pending overseer escalation: a post-done review rejected a phase, and a human still has to
 *  resolve it — either by accepting the result (releasing the gated dependents) or re-running the
 *  rejected phase. The `blocked` dependents are the phases the engine gated waiting on that call. */
export interface Escalation {
  /** The phase the overseer rejected (carries the rationale). */
  taskId: string;
  /** Human label of the rejected phase. */
  title: string;
  /** The overseer's reason — the text that used to live in the toast. */
  rationale: string;
  /** When the escalation happened (the review event's timestamp). */
  ts: string;
  /** The mission's epic id, so actions can resume `m-<epicId>`. */
  epicId: string | null;
  /** Dependent phases currently gated 'blocked' behind this rejection. */
  blocked: Task[];
}

const ESCALATED = 'escalated';

/** Pending overseer escalations, newest-first. Built from the persisted review feed (so it reads
 *  retrospectively) joined to live task state: an escalation is pending only while a human still has
 *  something to act on — the rejected phase is itself blocked, or it has dependents gated 'blocked'.
 *  Once the human approves (releases the dependents) or re-runs the phase, those rows clear and the
 *  escalation drops off automatically — no extra server state needed. */
export function pendingEscalations(events: ActivityEvent[], tasks: Task[], deps: DepEdge[]): Escalation[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const seen = new Set<string>();
  const out: Escalation[] = [];
  for (const e of events) { // events arrive newest-first → first hit per target is the latest verdict
    if (e.type !== 'review' || !e.detail.startsWith(ESCALATED)) continue;
    if (seen.has(e.target)) continue;
    seen.add(e.target);
    const task = byId.get(e.target);
    // A phase the engine has re-opened is mid-flight under L3 self-heal: it re-runs with the review
    // feedback while its dependents stay gated, but no human is needed — Elowen clears it itself on the
    // next approving verdict. Only a phase that stayed put (closed after the self-heal budget ran out,
    // or under L1/L2 where rejects never self-heal) is a real, standing escalation. Skip the in-flight
    // ones so the self-heal loop doesn't masquerade as an escalation in the inbox.
    if (task?.status === 'open' || task?.status === 'in_progress') continue;
    const blocked = deps
      .filter((d) => d.depends_on_id === e.target)
      .map((d) => byId.get(d.task_id))
      .filter((t): t is Task => !!t && t.status === 'blocked');
    if (blocked.length === 0 && task?.status !== 'blocked') continue; // already resolved
    out.push({
      taskId: e.target,
      title: task?.title || e.label || e.target,
      rationale: e.detail.replace(/^escalated:\s*/, ''),
      ts: e.ts,
      epicId: task?.parent_id ?? null,
      blocked,
    });
  }
  return out;
}
