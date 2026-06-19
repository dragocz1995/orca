import { describe, it, expect } from 'vitest';
import { stallState, DEFAULT_STALL_THRESHOLDS, type StallThresholds } from '../../lib/useSessionStall';

const TH: StallThresholds = { stalledSec: 5 * 60, stuckSec: 15 * 60 };

describe('stallState', () => {
  it('returns fresh for a non-live session regardless of silence', () => {
    expect(stallState(99999, false, TH)).toBe('fresh');
  });
  it('returns fresh while below the stalled threshold', () => {
    expect(stallState(0, true, TH)).toBe('fresh');
    expect(stallState(4 * 60, true, TH)).toBe('fresh');
  });
  it('returns stalled at/above the stalled threshold but below stuck', () => {
    expect(stallState(5 * 60, true, TH)).toBe('stalled');
    expect(stallState(10 * 60, true, TH)).toBe('stalled');
  });
  it('returns stuck at/above the stuck threshold', () => {
    expect(stallState(15 * 60, true, TH)).toBe('stuck');
    expect(stallState(60 * 60, true, TH)).toBe('stuck');
  });
  it('clamps negative silence to 0 (treated as fresh)', () => {
    expect(stallState(-10, true, TH)).toBe('fresh');
  });
  it('respects custom thresholds', () => {
    const custom: StallThresholds = { stalledSec: 60, stuckSec: 180 };
    expect(stallState(60, true, custom)).toBe('stalled');
    expect(stallState(180, true, custom)).toBe('stuck');
  });
  it('defaults to 5m/15m', () => {
    expect(DEFAULT_STALL_THRESHOLDS.stalledSec).toBe(300);
    expect(DEFAULT_STALL_THRESHOLDS.stuckSec).toBe(900);
  });
});