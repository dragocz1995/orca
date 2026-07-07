import { describe, it, expect } from 'vitest';
import { SESSION_IDLE_ROLLOVER_MS, rolloverDue } from '../../src/brain/session/idleRollover.js';

/** SQLite-shaped UTC timestamp `ms` before `now` (matches brain_messages.created_at). */
const sqliteTs = (now: number, agoMs: number): string => new Date(now - agoMs).toISOString().replace('T', ' ').slice(0, 19);

describe('rolloverDue', () => {
  const now = Date.UTC(2026, 6, 7, 12, 0, 0);

  it('is due once the newest message is older than the cutoff', () => {
    expect(rolloverDue({ lastMessageAt: sqliteTs(now, SESSION_IDLE_ROLLOVER_MS + 1000), interactedAt: undefined, now })).toBe(true);
  });

  it('is NOT due while the newest message is within the cutoff', () => {
    expect(rolloverDue({ lastMessageAt: sqliteTs(now, SESSION_IDLE_ROLLOVER_MS - 1000), interactedAt: undefined, now })).toBe(false);
  });

  it('never fires for a conversation with no stored messages (nothing stale to cut)', () => {
    expect(rolloverDue({ lastMessageAt: undefined, interactedAt: undefined, now })).toBe(false);
  });

  it('a recent explicit interaction (resume/model switch/compact) shields an old conversation', () => {
    expect(rolloverDue({ lastMessageAt: sqliteTs(now, 2 * SESSION_IDLE_ROLLOVER_MS), interactedAt: now - 60_000, now })).toBe(false);
  });

  it('an explicit interaction that itself went stale no longer shields it', () => {
    expect(rolloverDue({ lastMessageAt: sqliteTs(now, 3 * SESSION_IDLE_ROLLOVER_MS), interactedAt: now - SESSION_IDLE_ROLLOVER_MS - 1000, now })).toBe(true);
  });

  it('an unparseable timestamp is treated as no history (no rollover) rather than an instant cut', () => {
    expect(rolloverDue({ lastMessageAt: 'not-a-date', interactedAt: undefined, now })).toBe(false);
  });
});
