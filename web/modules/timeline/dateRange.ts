/** Date-range filtering for the Timeline view. Pure, side-effect-free helpers so the window logic is
 *  unit-testable independent of the view. Presets are *rolling* (computed from "now"). The whole
 *  feature lives caller-side in TimelineView — it never touches any shared API/query. */

export type RangePreset = '7d' | '30d' | 'all';
export const RANGE_PRESETS: readonly RangePreset[] = ['7d', '30d', 'all'];

export interface DateRange { preset: RangePreset }

export const DEFAULT_RANGE: DateRange = { preset: '7d' };

/** Serialize for a localStorage slot: just the preset string. */
export function serializeRange(r: DateRange): string {
  return r.preset;
}

/** Parse a stored value back to a range; returns null when the stored string is not a known preset. */
export function parseRange(raw: string): DateRange | null {
  if (!(RANGE_PRESETS as readonly string[]).includes(raw)) return null;
  return { preset: raw as RangePreset };
}

/** Predicate for usePersistentState — true when the raw stored string is a well-formed range. */
export const isStoredRange = (raw: string): boolean => parseRange(raw) !== null;

const DAY = 86400000;

/** Local start-of-day for an epoch ms. */
const startOfDay = (ms: number): number => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** Effective `[fromMs, toMs]` window. Presets reach from N-1 days before today up to infinity
 *  (so upcoming activity stays visible). */
export function rangeBounds(r: DateRange, now: number): { fromMs: number; toMs: number } {
  if (r.preset === 'all') return { fromMs: -Infinity, toMs: Infinity };
  const days = r.preset === '7d' ? 7 : 30;
  return { fromMs: startOfDay(now) - (days - 1) * DAY, toMs: Infinity };
}

/** True when an epoch-ms timestamp falls inside the range's window. */
export function inRange(ms: number, r: DateRange, now: number): boolean {
  const { fromMs, toMs } = rangeBounds(r, now);
  return ms >= fromMs && ms <= toMs;
}

/** Cap of the visible window in hours. For '7d'/'30d' this is finite and derived from rangeBounds
 *  (the distance from the lower bound to now). For 'all' the window is open-ended → Infinity. */
export function rangeWindowCapHours(r: DateRange, now: number): number {
  if (r.preset === 'all') return Infinity;
  const { fromMs } = rangeBounds(r, now);
  return (now - fromMs) / 3_600_000;
}
