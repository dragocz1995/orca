import type { Context } from 'hono';
import type { WSEvents } from 'hono/ws';
import type { TicketStore } from './ticketStore.js';
import type { PtyModule } from './ptyLoader.js';
import { attachPty } from './ptySession.js';
import { bridge } from './bridge.js';

export interface TerminalWsDeps {
  tickets: TicketStore;
  loadPty: () => Promise<PtyModule | null>;
  /** Injectable for tests; defaults to the real `attachPty`. */
  attach?: typeof attachPty;
}

/** Close code signalling "no PTY stream here — fall back to the snapshot mirror" (bad ticket or
 *  node-pty unavailable). An application close code (4000–4999); the browser hook keys off it. Must
 *  stay in sync with `UNSUPPORTED_CLOSE` in `web/lib/useTerminalStream.ts`. */
export const UNSUPPORTED_CLOSE = 4001;

/** Build the `createEvents` factory for `upgradeWebSocket('/ws/terminal')`. The ticket is consumed at
 *  upgrade time (single use); node-pty is probed then too. The actual `tmux attach` waits for `onOpen`
 *  (when the socket can carry bytes). When the ticket is invalid or node-pty is unavailable we send a
 *  one-line `unsupported` frame and close, so the browser falls back to the snapshot mirror. */
export function terminalWsHandler(deps: TerminalWsDeps): (c: Context) => Promise<WSEvents> {
  return async (c) => {
    const ticketId = new URL(c.req.url).searchParams.get('ticket') ?? '';
    const ticket = deps.tickets.consume(ticketId);
    const mod = ticket ? await deps.loadPty() : null;
    const failure: 'ticket' | 'pty' | null = !ticket ? 'ticket' : !mod ? 'pty' : null;
    let b: ReturnType<typeof bridge> | null = null;

    return {
      onOpen(_evt, ws) {
        if (failure || !ticket || !mod) {
          // No data frame — close with a dedicated code so the browser can't mistake a PTY line that
          // happens to start with '{' for a control message.
          ws.close(UNSUPPORTED_CLOSE, failure ?? 'ticket');
          return;
        }
        const attach = deps.attach ?? attachPty;
        const pty = attach(mod, { session: ticket.session, cols: 80, rows: 24 });
        b = bridge(pty, { send: (d: string) => ws.send(d), close: () => ws.close() });
      },
      onMessage(evt) {
        if (b) b.onMessage(String(evt.data));
      },
      onClose() {
        b?.dispose();
      },
    };
  };
}
