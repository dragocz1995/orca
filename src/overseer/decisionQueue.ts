import { randomBytes } from 'node:crypto';

export type DecisionKind = 'prompt' | 'review' | 'question' | 'message';
export interface DecisionResult {
  approve: boolean;
  confidence: number;
  rationale: string;
  /** For a 'question' decision: the option id the overseer picked. Absent ⇒ escalate to a human
   *  (also the shape of a timeout/drain verdict, which therefore escalates the question). */
  choice?: string;
  /** For a 'message' decision (worker asked the autopilot a free-text question): the overseer's
   *  free-text reply. Absent ⇒ the overseer escalated (or timed out) → the ask falls to the human
   *  window. Distinct from `choice`/`approve`, which don't apply to a free-text exchange. */
  message?: string;
  /** True only when the overseer never answered (the decision timed out): there is NO real verdict,
   *  so the decision must be handed to a human and never auto-acted on. In particular a post-done
   *  review must NOT self-heal/re-run the phase on this — that turns a slow/absent overseer into an
   *  infinite reopen loop. A genuine overseer reject leaves this unset. */
  escalated?: boolean;
}
export interface PendingDecision { id: string; kind: DecisionKind; context: Record<string, unknown> }

interface Entry extends PendingDecision { settle: (r: DecisionResult) => void; timer: NodeJS.Timeout }
type Waiter = (r: PendingDecision | null) => void;

const HEARTBEAT_MS = 25_000;
const DECISION_TIMEOUT_MS = 120_000;

/** Per-mission FIFO of decisions awaiting a verdict from the parked overseer agent. The engine/
 *  deriver `enqueue` (and await) a decision; the agent long-polls `next` and answers via `resolve`.
 *  Every enqueue is guaranteed to settle: by the agent, by a timeout (conservative escalate), or by
 *  `drain` (mission gone). No model output is parsed here — the agent submits a structured verdict. */
export class DecisionQueue {
  private pending = new Map<string, Entry[]>();   // missionId → FIFO of unanswered requests
  private waiters = new Map<string, Waiter[]>();  // missionId → long-poll resolvers awaiting a request

  enqueue(missionId: string, kind: DecisionKind, context: Record<string, unknown>, timeoutMs = DECISION_TIMEOUT_MS): Promise<DecisionResult> {
    return new Promise<DecisionResult>((resolveVerdict) => {
      const id = randomBytes(6).toString('hex');
      const timer = setTimeout(() => {
        this.remove(missionId, id);
        // Timeout = the overseer never answered. This is NOT a verdict — it escalates to a human and
        // must never auto-act (see `escalated`). Without this flag a review's L3 self-heal read the
        // synthetic reject as "overseer rejected" and re-ran the phase forever (livelock).
        resolveVerdict({ approve: false, confidence: 0, rationale: 'overseer timeout', escalated: true });
      }, timeoutMs);
      if (typeof timer.unref === 'function') timer.unref();
      const entry: Entry = { id, kind, context, timer, settle: (r) => { clearTimeout(timer); resolveVerdict(r); } };
      const list = this.pending.get(missionId) ?? [];
      list.push(entry);
      this.pending.set(missionId, list);
      this.wakeWaiter(missionId);
    });
  }

  next(missionId: string, timeoutMs = HEARTBEAT_MS): Promise<PendingDecision | null> {
    const ready = (this.pending.get(missionId) ?? [])[0];
    if (ready) return Promise.resolve({ id: ready.id, kind: ready.kind, context: ready.context });
    return new Promise<PendingDecision | null>((resolve) => {
      const timer = setTimeout(() => { this.dropWaiter(missionId, w); resolve(null); }, timeoutMs);
      if (typeof timer.unref === 'function') timer.unref();
      const w: Waiter = (req) => { clearTimeout(timer); resolve(req); };
      const list = this.waiters.get(missionId) ?? [];
      list.push(w);
      this.waiters.set(missionId, list);
    });
  }

  resolve(missionId: string, id: string, result: DecisionResult): boolean {
    const entry = (this.pending.get(missionId) ?? []).find((e) => e.id === id);
    if (!entry) return false;
    this.remove(missionId, id);
    entry.settle(result);
    return true;
  }

  drain(missionId: string): void {
    for (const e of this.pending.get(missionId) ?? []) e.settle({ approve: false, confidence: 0, rationale: 'mission disengaged' });
    this.pending.delete(missionId);
    for (const w of this.waiters.get(missionId) ?? []) w(null);
    this.waiters.delete(missionId);
  }

  private wakeWaiter(missionId: string): void {
    const w = (this.waiters.get(missionId) ?? []).shift();
    const head = (this.pending.get(missionId) ?? [])[0];
    if (w && head) w({ id: head.id, kind: head.kind, context: head.context });
  }

  private dropWaiter(missionId: string, w: Waiter): void {
    const list = (this.waiters.get(missionId) ?? []).filter((x) => x !== w);
    if (list.length) this.waiters.set(missionId, list); else this.waiters.delete(missionId);
  }

  private remove(missionId: string, id: string): void {
    const list = (this.pending.get(missionId) ?? []).filter((e) => e.id !== id);
    if (list.length) this.pending.set(missionId, list); else this.pending.delete(missionId);
  }
}
