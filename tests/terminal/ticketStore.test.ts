import { describe, it, expect } from 'vitest';
import { createTicketStore } from '../../src/terminal/ticketStore.js';

describe('ticketStore', () => {
  it('issues an opaque id that consumes exactly once', () => {
    const s = createTicketStore({ now: () => 0 });
    const id = s.issue({ session: 'elowen-advisor-1', userId: 1 });
    expect(id).toMatch(/^[a-f0-9]{32,}$/);
    expect(s.consume(id)).toEqual({ session: 'elowen-advisor-1', userId: 1 });
    expect(s.consume(id)).toBeNull(); // already used
  });

  it('expires after ttl', () => {
    let t = 0;
    const s = createTicketStore({ ttlMs: 1000, now: () => t });
    const id = s.issue({ session: 'elowen-x', userId: null });
    t = 1500;
    expect(s.consume(id)).toBeNull();
  });

  it('sweep drops expired entries', () => {
    let t = 0;
    const s = createTicketStore({ ttlMs: 1000, now: () => t });
    const id = s.issue({ session: 'elowen-x', userId: null });
    t = 2000;
    s.sweep(t);
    expect(s.consume(id)).toBeNull();
  });
});
