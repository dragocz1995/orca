import type { BrainStore, SessionEventKind } from '../../store/brainStore.js';
import type { LiveBrain } from '../session/liveBrain.js';

/** The model-facing wording for each change — a predicate completing "the user …". Kept terse; the
 *  turn-context builder wraps the collected notices in one <system-reminder>. */
const NOTICE: Record<SessionEventKind, (detail: string) => string> = {
  model: (d) => `switched your model to ${d}`,
  mode: (d) => `switched the work mode to ${d}`,
  rename: (d) => `renamed this conversation to "${d}"`,
  reasoning: (d) => `set your reasoning effort to ${d}`,
  cwd: (d) => `changed the working directory to ${d}`,
};

/** Record an owner-driven session-state change, in three parts:
 *   1. persist a display-only marker (brain_session_events) — the visible, reconnect-safe transcript line;
 *   2. publish a `session-event` on the live stream so connected clients render it immediately;
 *   3. queue a one-shot, model-facing notice so the agent is told on its NEXT turn (drained + cleared by
 *      the turn-context builder, never persisted — mirrors the mode reminder).
 *  The marker never enters brain_messages, so it stays out of the model's context and compaction.
 *
 *  `live` is optional: a conversation can be renamed from the picker while it is not running, in which
 *  case only the marker is persisted (there is no stream to publish on, and no agent waiting to be told —
 *  it simply shows the next time the transcript loads). Every caller goes through here so the
 *  empty-conversation guard cannot be bypassed by writing to the store directly. */
export function recordSessionEvent(
  store: BrainStore,
  sessionId: string,
  live: LiveBrain | undefined,
  kind: SessionEventKind,
  detail: string,
): void {
  const clean = detail.trim();
  if (!clean) return;
  // Nothing to annotate before the conversation has any turns: the agent reads its model/mode/reasoning
  // from the very prompt it is about to be handed, so a marker stacked above the first message would
  // report a "change" to settings nobody has worked under yet. Setup before speaking is not history.
  if (!store.lastMessageAt(sessionId)) return;
  const event = store.appendSessionEvent(sessionId, kind, clean);
  if (!live) return;
  live.replay.publish({ type: 'session-event', id: event.id, kind: event.kind, detail: event.detail, at: event.at });
  (live.pendingSessionNotices ??= []).push(NOTICE[kind](clean));
}

/** How long the reasoning level must sit unchanged before its marker lands. Cycling with ctrl+r fires
 *  one change per keypress and stepping several levels takes roughly 150–300ms between presses, so the
 *  window must comfortably outlast the next press of a burst; much longer only delays the marker after
 *  the user has visibly settled. */
export const REASONING_MARKER_DEBOUNCE_MS = 600;

/** Debounce the reasoning-effort marker: apply-now, announce-later. The caller has already applied the
 *  new level to the live session — only the visible marker (and its model-facing notice, both via
 *  recordSessionEvent) waits until the level has been STABLE for the debounce window, so cycling
 *  low→medium→high emits one "reasoning → high" instead of a marker per keystroke. Changing again
 *  restarts the window and keeps the latest target; settling back on the level the transcript last
 *  reflected cancels the marker entirely (nothing changed, nothing to announce). */
export function scheduleReasoningMarker(store: BrainStore, live: LiveBrain, previousLevel: string | undefined, level: string): void {
  const pending = live.pendingReasoningMarker;
  if (pending) clearTimeout(pending.timer);
  const baseline = pending ? pending.baseline : previousLevel;
  if (baseline === level) { live.pendingReasoningMarker = undefined; return; }
  const timer = setTimeout(() => flushReasoningMarker(store, live), REASONING_MARKER_DEBOUNCE_MS);
  timer.unref?.();
  live.pendingReasoningMarker = { timer, baseline, level };
}

/** Land a pending (debounced) reasoning marker NOW. Called by the settle timer, and by the turn runner
 *  at turn admission — a turn must not start with the marker still in flight, or the marker row would
 *  land AFTER the user message it preceded and its model-facing notice would miss the turn. No-op when
 *  nothing is pending. */
export function flushReasoningMarker(store: BrainStore, live: LiveBrain): void {
  const pending = live.pendingReasoningMarker;
  if (!pending) return;
  clearTimeout(pending.timer);
  live.pendingReasoningMarker = undefined;
  recordSessionEvent(store, live.sessionId, live, 'reasoning', live.thinkingLabels[pending.level] ?? pending.level);
}

/** Drain the queued session-change notices into a single model-facing <system-reminder>, clearing the
 *  buffer (one-shot). Returns '' when nothing is queued. Placed under the user message like the mode
 *  reminder — it is volatile per-turn context the agent should adapt to, not durable history. */
export function drainSessionNotices(live: LiveBrain): string {
  const notices = live.pendingSessionNotices;
  if (!notices || notices.length === 0) return '';
  live.pendingSessionNotices = [];
  const rows = notices.map((n) => `- The user ${n}.`).join('\n');
  return '<system-reminder>\n<session-changes>\n'
    + `${rows}\n</session-changes>\n`
    + '<instruction>These settings changed since your last reply. Work under the new settings from now on '
    + '(e.g. a new work mode or model) and do not re-confirm them with the user.</instruction>\n'
    + '</system-reminder>';
}
