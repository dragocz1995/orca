import type { BrainEvent } from '../events.js';

/** Live client attachment tracking, shared by the conversation lifecycle (subscribe/tap and the
 *  switch-away/default-start guards), the turn runner (an idle rollover carries attachments onto the
 *  replacement session), the spawner (tap re-attach on respawn) and the status views (`attached`). */
export class ClientAttachments {
  /** Live client streams (SSE listeners from /brain/stream) → the session id each is attached to.
   *  Only REAL client streams register here (subscribe + tapSession); internal fanout listeners and the
   *  respawn re-attach never do. An idle rollover re-keys entries onto the replacement session (the
   *  listeners are carried there). Powers `attached` in listSessions, the CLI default-start resolution
   *  ("don't grab a conversation another client holds") and the switch-away cleanup guard. */
  readonly clientStreams = new Map<(e: BrainEvent) => void, string>();

  /** Long-lived listeners keyed by SESSION id — re-attached by the spawner whenever that session
   *  (re)spawns, so an open drill-in stream survives respawns (unlike a raw `listeners.add`). */
  readonly sessionTaps = new Map<string, Set<(e: BrainEvent) => void>>();

  /** How many live client streams are currently attached to this session (web dock subscriptions +
   *  CLI session taps). 0 = no client is following the conversation right now. */
  attachedCount(sessionId: string): number {
    let n = 0;
    for (const sid of this.clientStreams.values()) if (sid === sessionId) n += 1;
    return n;
  }

  /** Re-key everything attached to a rolled-over conversation onto its replacement session. */
  retarget(oldId: string, freshId: string): void {
    // Attached client streams move with their listeners so `attached` stays truthful post-rollover.
    for (const [l, sid] of this.clientStreams) if (sid === oldId) this.clientStreams.set(l, freshId);
    // Session taps (the CLI's bound stream) follow too, so a later respawn of the REPLACEMENT session
    // re-attaches them — the client just rebinds its id, its open stream never goes dark.
    const taps = this.sessionTaps.get(oldId);
    if (taps) {
      this.sessionTaps.delete(oldId);
      const existing = this.sessionTaps.get(freshId);
      if (existing) for (const t of taps) existing.add(t);
      else this.sessionTaps.set(freshId, taps);
    }
  }
}
