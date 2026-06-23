import { randomBytes } from 'node:crypto';
import type { TerminalTicket } from './types.js';

/** In-memory store of single-use WebSocket tickets. A ticket authorises exactly one terminal WS
 *  upgrade and is consumed on first use; it also expires after a short TTL so a leaked id is useless
 *  within seconds. The WS endpoint is unauthenticated (no session cookie survives the direct-to-daemon
 *  upgrade), so the ticket IS the capability — keep the TTL tight and never reissue an id. */
export interface TicketStore {
  /** Mint a ticket for an already-authorised session; returns an opaque id to hand to the browser. */
  issue(t: TerminalTicket): string;
  /** Redeem an id exactly once. Returns the ticket, or null when unknown / already used / expired. */
  consume(id: string): TerminalTicket | null;
  /** Drop every entry whose TTL elapsed before `now` (periodic housekeeping). */
  sweep(now: number): void;
}

export function createTicketStore(opts: { ttlMs?: number; now?: () => number } = {}): TicketStore {
  const ttl = opts.ttlMs ?? 30_000;
  const now = opts.now ?? (() => Date.now());
  const map = new Map<string, { t: TerminalTicket; exp: number }>();
  return {
    issue(t) {
      const id = randomBytes(18).toString('hex');
      map.set(id, { t, exp: now() + ttl });
      return id;
    },
    consume(id) {
      const e = map.get(id);
      if (!e) return null;
      map.delete(id); // single-use: remove on the first lookup regardless of expiry
      return e.exp >= now() ? e.t : null;
    },
    sweep(at) {
      for (const [id, e] of map) if (e.exp < at) map.delete(id);
    },
  };
}
