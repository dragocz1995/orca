import { describe, it, expect } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const pluginPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../plugins/cronjob/index.mjs');
const mod = await import(pluginPath) as {
  parseCronField(spec: string, min: number, max: number, names?: string[], wrapValue?: number): Set<number> | null;
  parseCron(spec: string): { kind: string; domRestricted: boolean; dowRestricted: boolean } | null;
  cronMatches(sched: unknown, date: Date): boolean;
  parseSchedule(spec: string): { kind: string } | null;
  isDue(job: Record<string, unknown>, now: number): boolean;
};

const sorted = (s: Set<number> | null) => (s ? [...s].sort((a, b) => a - b) : null);
const at = (y: number, mo: number, d: number, h: number, mi: number) => new Date(y, mo, d, h, mi, 0).getTime();
const iso = (ms: number) => new Date(ms).toISOString();

describe('cron fields', () => {
  it('expands every syntax a cron field is allowed to use', () => {
    expect(sorted(mod.parseCronField('*', 0, 5))).toEqual([0, 1, 2, 3, 4, 5]);
    expect(sorted(mod.parseCronField('3', 0, 59))).toEqual([3]);
    expect(sorted(mod.parseCronField('1-4', 0, 59))).toEqual([1, 2, 3, 4]);
    expect(sorted(mod.parseCronField('*/15', 0, 59))).toEqual([0, 15, 30, 45]);
    expect(sorted(mod.parseCronField('0-30/10', 0, 59))).toEqual([0, 10, 20, 30]);
    expect(sorted(mod.parseCronField('1,5,9', 0, 59))).toEqual([1, 5, 9]);
    expect(sorted(mod.parseCronField('0,30-32', 0, 59))).toEqual([0, 30, 31, 32]);
    // A bare value with a step means "from here to the end of the range" — standard cron.
    expect(sorted(mod.parseCronField('5/15', 0, 59))).toEqual([5, 20, 35, 50]);
  });

  it('folds weekday names, and accepts Sunday as both 0 and 7', () => {
    const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    expect(sorted(mod.parseCronField('mon-fri', 0, 6, days, 7))).toEqual([1, 2, 3, 4, 5]);
    expect(sorted(mod.parseCronField('7', 0, 6, days, 7))).toEqual([0]);       // cron's other name for Sunday
    expect(sorted(mod.parseCronField('5-7', 0, 6, days, 7))).toEqual([0, 5, 6]); // …and it wraps inside a range
    expect(sorted(mod.parseCronField('sun', 0, 6, days, 7))).toEqual([0]);
  });

  // Names are indexed from the FIELD'S OWN minimum: weekdays start at sun=0, months at jan=1. Taking the
  // raw array index instead puts every month one too low — "feb" would fire in January, and "jan" would be
  // rejected for falling under the minimum.
  it('folds month names onto cron\'s 1-based month numbers', () => {
    const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    expect(sorted(mod.parseCronField('jan', 1, 12, months))).toEqual([1]);
    expect(sorted(mod.parseCronField('feb', 1, 12, months))).toEqual([2]);
    expect(sorted(mod.parseCronField('dec', 1, 12, months))).toEqual([12]);
    expect(sorted(mod.parseCronField('feb-apr', 1, 12, months))).toEqual([2, 3, 4]);
  });

  it('a named month fires in THAT month, end to end', () => {
    const sched = mod.parseCron('0 9 * feb *')!;
    expect(mod.cronMatches(sched, new Date(2026, 1, 10, 9, 0))).toBe(true);   // February
    expect(mod.cronMatches(sched, new Date(2026, 0, 10, 9, 0))).toBe(false);  // NOT January
    expect(mod.parseCron('0 9 * jan *')).not.toBeNull();                      // and January parses at all
    expect(mod.cronMatches(mod.parseCron('0 9 * jan *')!, new Date(2026, 0, 10, 9, 0))).toBe(true);
  });

  it('rejects malformed fields instead of silently matching them', () => {
    expect(mod.parseCronField('', 0, 59)).toBeNull();
    expect(mod.parseCronField('abc', 0, 59)).toBeNull();
    expect(mod.parseCronField('99', 0, 59)).toBeNull();      // out of range
    expect(mod.parseCronField('5-1', 0, 59)).toBeNull();     // inverted range
    expect(mod.parseCronField('*/0', 0, 59)).toBeNull();     // zero step would loop forever
    expect(mod.parseCronField('*/x', 0, 59)).toBeNull();
    expect(mod.parseCronField('1-3-5', 0, 59)).toBeNull();   // not silently "1-3"
    expect(mod.parseCronField('1-5/2/3', 0, 59)).toBeNull(); // not silently "1-5/2"
  });
});

describe('parseCron', () => {
  it('parses the canonical expressions', () => {
    expect(mod.parseCron('*/5 * * * *')?.kind).toBe('cron');
    expect(mod.parseCron('0 9 * * 1-5')?.kind).toBe('cron');
    expect(mod.parseCron('0 0 1 * *')?.kind).toBe('cron');
  });

  it('rejects anything that is not exactly five well-formed fields', () => {
    expect(mod.parseCron('* * * *')).toBeNull();        // four
    expect(mod.parseCron('* * * * * *')).toBeNull();    // six
    expect(mod.parseCron('0 9 * * xyz')).toBeNull();
    expect(mod.parseCron('')).toBeNull();
  });

  it('matches a weekday-morning schedule only on weekday mornings', () => {
    const sched = mod.parseCron('0 9 * * 1-5')!;
    expect(mod.cronMatches(sched, new Date(2026, 6, 6, 9, 0))).toBe(true);   // Mon 09:00
    expect(mod.cronMatches(sched, new Date(2026, 6, 6, 9, 1))).toBe(false);  // wrong minute
    expect(mod.cronMatches(sched, new Date(2026, 6, 6, 10, 0))).toBe(false); // wrong hour
    expect(mod.cronMatches(sched, new Date(2026, 6, 5, 9, 0))).toBe(false);  // Sunday
  });

  it('ORs day-of-month against day-of-week when BOTH are restricted (the cron quirk)', () => {
    // "1st of the month OR any Monday" — not "a Monday that is also the 1st".
    const sched = mod.parseCron('0 0 1 * 1')!;
    expect(mod.cronMatches(sched, new Date(2026, 6, 1, 0, 0))).toBe(true);   // Wed the 1st → dom hit
    expect(mod.cronMatches(sched, new Date(2026, 6, 6, 0, 0))).toBe(true);   // Mon the 6th → dow hit
    expect(mod.cronMatches(sched, new Date(2026, 6, 7, 0, 0))).toBe(false);  // Tue the 7th → neither
    // With only ONE of them restricted the other must not veto: "every Monday", any date.
    const mondays = mod.parseCron('0 0 * * 1')!;
    expect(mod.cronMatches(mondays, new Date(2026, 6, 6, 0, 0))).toBe(true);
    expect(mod.cronMatches(mondays, new Date(2026, 6, 7, 0, 0))).toBe(false);
  });

  it('a wildcard WITH a step still counts as unrestricted for the OR quirk (Vixie semantics)', () => {
    // "*/2 * * 1-5" is "every other day-of-month, AND a weekday" — not "every other day OR any weekday",
    // which would fire it on days nobody asked for.
    const sched = mod.parseCron('0 0 */2 * 1-5')!;
    expect(sched.domRestricted).toBe(false);
    expect(mod.cronMatches(sched, new Date(2026, 6, 7, 0, 0))).toBe(true);   // Tue the 7th — odd day, weekday
    expect(mod.cronMatches(sched, new Date(2026, 6, 4, 0, 0))).toBe(false);  // Sat the 4th — weekend vetoes
    expect(mod.cronMatches(sched, new Date(2026, 6, 8, 0, 0))).toBe(false);  // Wed the 8th — even day vetoes
  });
});

describe('parseSchedule auto-detection', () => {
  it('keeps every human-readable form working exactly as before', () => {
    expect(mod.parseSchedule('every 15m')).toEqual({ kind: 'interval', ms: 900_000 });
    expect(mod.parseSchedule('daily 07:30')).toEqual({ kind: 'daily', hour: 7, minute: 30 });
    expect(mod.parseSchedule('weekly sun 20:00')).toEqual({ kind: 'weekly', day: 0, hour: 20, minute: 0 });
  });

  it('detects a 5-field cron expression, and still rejects genuine garbage', () => {
    expect(mod.parseSchedule('*/5 * * * *')?.kind).toBe('cron');
    expect(mod.parseSchedule('0 9 * * 1-5')?.kind).toBe('cron');
    expect(mod.parseSchedule('every 30s')).toBeNull();   // below the 1-minute floor
    expect(mod.parseSchedule('whenever')).toBeNull();
    expect(mod.parseSchedule('0 9 * *')).toBeNull();     // four fields is not a schedule
  });
});

describe('isDue with a cron schedule', () => {
  const job = (schedule: string, lastRun: number) => ({ id: 'j', schedule, lastRun: iso(lastRun) });

  it('fires in a matching minute and not again within that same minute', () => {
    const nine = at(2026, 6, 6, 9, 0);              // Mon 09:00, a matching slot
    const eight = at(2026, 6, 6, 8, 0);
    expect(mod.isDue(job('0 9 * * 1-5', eight), nine)).toBe(true);
    // The 30 s tick runs again 30 s later: already fired this minute → not due.
    expect(mod.isDue(job('0 9 * * 1-5', nine), nine + 30_000)).toBe(false);
  });

  it('does not fire outside its slot', () => {
    const last = at(2026, 6, 6, 8, 0);
    expect(mod.isDue(job('0 9 * * 1-5', last), at(2026, 6, 6, 8, 30))).toBe(false); // before 09:00
    expect(mod.isDue(job('0 9 * * 1-5', at(2026, 6, 5, 8, 0)), at(2026, 6, 5, 9, 0))).toBe(false); // Sunday
  });

  it('catches up on a slot missed during downtime, exactly like the daily form does', () => {
    // The daemon was restarting at 09:00 and only ticks again at 09:07. The run must not be lost.
    const last = at(2026, 6, 6, 8, 0);
    expect(mod.isDue(job('0 9 * * 1-5', last), at(2026, 6, 6, 9, 7))).toBe(true);
  });

  it('replays at most one occurrence after a long outage — never a backlog', () => {
    // Down for three days on an every-5-minutes schedule. It comes back due (once), and once the tick has
    // run, the next tick in the same minute is not due again — no queue of hundreds of missed runs.
    const last = at(2026, 6, 3, 9, 0);
    const now = at(2026, 6, 6, 9, 0);
    expect(mod.isDue(job('*/5 * * * *', last), now)).toBe(true);
    expect(mod.isDue(job('*/5 * * * *', now), now + 30_000)).toBe(false);
  });

  it('respects enabled:false and the active-hours window, same as any other schedule', () => {
    const last = at(2026, 6, 6, 8, 0);
    const nine = at(2026, 6, 6, 9, 0);
    expect(mod.isDue({ ...job('0 9 * * 1-5', last), enabled: false }, nine)).toBe(false);
    expect(mod.isDue({ ...job('0 9 * * 1-5', last), hours: '12-20' }, nine)).toBe(false);
  });

  it('an every-5-minutes cron fires once per 5-minute slot', () => {
    const base = at(2026, 6, 6, 9, 0);
    expect(mod.isDue(job('*/5 * * * *', base - 60_000), base)).toBe(true);
    expect(mod.isDue(job('*/5 * * * *', base), at(2026, 6, 6, 9, 3))).toBe(false); // 09:03 is not a slot
    expect(mod.isDue(job('*/5 * * * *', base), at(2026, 6, 6, 9, 5))).toBe(true);
  });
});
