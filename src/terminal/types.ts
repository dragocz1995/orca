// Shared types for the real-PTY terminal-streaming module. This layer powers the interactive
// (advisor) and enlarged (modal) terminals with a true PTY stream over a WebSocket; the snapshot
// mirror in `web/components/terminal/Terminal.tsx` stays the fallback and the grid-preview path.

/** A short-lived, single-use capability to open one terminal WebSocket. Minted only after an
 *  authenticated `POST /sessions/:name/ws-ticket` passed the ownership check, so the unauthenticated
 *  WS upgrade (which carries no session cookie) can trust it. */
export interface TerminalTicket {
  session: string;
  userId: number | null;
}
