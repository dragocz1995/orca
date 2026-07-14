import { describe, it, expect } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const pluginPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../plugins/cronjob/index.mjs');
const mod = await import(pluginPath) as {
  zonedParts(ms: number, tz: string): { year: number; month: number; day: number; hour: number; minute: number; weekday: number };
  zonedTimeToMs(tz: string, y: number, mo: number, d: number, h: number, mi: number): number;
  slotKey(ms: number, tz: string): string;
  dueSlot(job: Record<string, unknown>, now: number, tz?: string): string | null;
  isDue(job: Record<string, unknown>, now: number, tz?: string): boolean;
  parseOneShot(spec: string, now: number, tz?: string): number | null;
  inHours(hours: string | undefined, now: number, tz?: string): boolean;
};

const PRAGUE = 'Europe/Prague';
const NEW_YORK = 'America/New_York';
const TOKYO = 'Asia/Tokyo';
const utc = (iso: string) => Date.parse(iso);

// A schedule is a statement about the USER's wall clock. If it were read on the server's clock instead,
// a Prague user on a US-hosted daemon would get their 07:30 report at 13:30.
describe('cron schedules run on the user\'s clock, not the server\'s', () => {
  it('zonedParts reads an instant in the requested zone', () => {
    const ms = utc('2026-07-14T09:30:00Z'); // a Tuesday
    expect(mod.zonedParts(ms, 'UTC')).toMatchObject({ year: 2026, month: 7, day: 14, hour: 9, minute: 30, weekday: 2 });
    expect(mod.zonedParts(ms, PRAGUE)).toMatchObject({ hour: 11, minute: 30, day: 14 });   // UTC+2 in July
    expect(mod.zonedParts(ms, NEW_YORK)).toMatchObject({ hour: 5, minute: 30, day: 14 });  // UTC-4 in July
    expect(mod.zonedParts(ms, TOKYO)).toMatchObject({ hour: 18, minute: 30, day: 14 });    // UTC+9
  });

  it('midnight reads as hour 0, never 24', () => {
    expect(mod.zonedParts(utc('2026-07-14T22:00:00Z'), PRAGUE).hour).toBe(0); // 00:00 Prague, next day
    expect(mod.zonedParts(utc('2026-07-14T22:00:00Z'), PRAGUE).day).toBe(15);
  });

  it('zonedTimeToMs is the exact inverse — including across a DST boundary', () => {
    const roundTrip = (tz: string, y: number, mo: number, d: number, h: number, mi: number) => {
      const p = mod.zonedParts(mod.zonedTimeToMs(tz, y, mo, d, h, mi), tz);
      return [p.year, p.month, p.day, p.hour, p.minute];
    };
    expect(roundTrip(PRAGUE, 2026, 7, 14, 7, 30)).toEqual([2026, 7, 14, 7, 30]);   // summer
    expect(roundTrip(PRAGUE, 2026, 1, 14, 7, 30)).toEqual([2026, 1, 14, 7, 30]);   // winter
    expect(roundTrip(NEW_YORK, 2026, 3, 9, 7, 30)).toEqual([2026, 3, 9, 7, 30]);   // day after US spring-forward
    expect(roundTrip(TOKYO, 2026, 7, 14, 23, 59)).toEqual([2026, 7, 14, 23, 59]);  // a zone with no DST at all
  });

  it('"daily 07:30" fires at 07:30 in the USER\'s zone, whatever the server thinks', () => {
    const job = { id: 'j', schedule: 'daily 07:30', lastRun: utc('2026-07-13T00:00:00Z') && new Date(utc('2026-07-13T00:00:00Z')).toISOString() };
    // 05:30 UTC IS 07:30 in Prague — due there…
    expect(mod.isDue(job, utc('2026-07-14T05:30:00Z'), PRAGUE)).toBe(true);
    // …and is only 01:30 in New York, where the slot has not come yet.
    expect(mod.isDue(job, utc('2026-07-14T05:30:00Z'), NEW_YORK)).toBe(false);
    // New York reaches 07:30 five hours later — and Prague has long since run it.
    expect(mod.isDue(job, utc('2026-07-14T11:30:00Z'), NEW_YORK)).toBe(true);
  });

  it('"weekly sun 20:00" uses the weekday on the user\'s clock, not the server\'s', () => {
    const job = { id: 'j', schedule: 'weekly sun 20:00', lastRun: new Date(utc('2026-07-10T00:00:00Z')).toISOString() };
    // 2026-07-12 is a Sunday. 22:00 UTC is Sunday 18:00 in New York — but already MONDAY 00:00 in Prague.
    const ms = utc('2026-07-12T22:00:00Z');
    expect(mod.zonedParts(ms, PRAGUE).weekday).toBe(1);   // Monday in Prague
    expect(mod.zonedParts(ms, NEW_YORK).weekday).toBe(0); // still Sunday in New York
    expect(mod.isDue(job, ms, PRAGUE)).toBe(false);       // Prague's Sunday 20:00 already passed/not today
    expect(mod.isDue({ ...job, schedule: 'weekly sun 18:00' }, ms, NEW_YORK)).toBe(true);
  });

  it('a cron expression matches on the user\'s clock', () => {
    const job = { id: 'j', schedule: '0 9 * * *', lastRun: new Date(utc('2026-07-14T00:00:00Z')).toISOString() };
    expect(mod.isDue(job, utc('2026-07-14T07:00:00Z'), PRAGUE)).toBe(true);   // 09:00 Prague
    expect(mod.isDue(job, utc('2026-07-14T07:00:00Z'), NEW_YORK)).toBe(false); // 03:00 New York
    expect(mod.isDue(job, utc('2026-07-14T13:00:00Z'), NEW_YORK)).toBe(true);  // 09:00 New York
  });

  it('active hours are the user\'s hours', () => {
    const ms = utc('2026-07-14T03:00:00Z'); // 05:00 Prague, 23:00 (prev day) New York
    expect(mod.inHours('5-21', ms, PRAGUE)).toBe(true);
    expect(mod.inHours('5-21', ms, NEW_YORK)).toBe(false);
  });

  it('"at HH:MM" wake-ups resolve on the user\'s clock', () => {
    const now = utc('2026-07-14T09:00:00Z'); // 11:00 Prague, 05:00 New York
    // "at 18:30" in Prague is 16:30 UTC…
    expect(mod.parseOneShot('at 18:30', now, PRAGUE)).toBe(utc('2026-07-14T16:30:00Z'));
    // …and in New York it is 22:30 UTC.
    expect(mod.parseOneShot('at 18:30', now, NEW_YORK)).toBe(utc('2026-07-14T22:30:00Z'));
    // A time already past today rolls to the same wall-clock time tomorrow.
    expect(mod.parseOneShot('at 06:00', now, PRAGUE)).toBe(utc('2026-07-15T04:00:00Z'));
  });

  it('an interval is a DURATION, not a wall-clock time — it ignores the calendar entirely', () => {
    const job = { id: 'j', schedule: 'every 15m', lastRun: new Date(utc('2026-07-14T09:00:00Z')).toISOString() };
    for (const tz of [PRAGUE, NEW_YORK, TOKYO]) {
      expect(mod.isDue(job, utc('2026-07-14T09:14:00Z'), tz)).toBe(false);
      expect(mod.isDue(job, utc('2026-07-14T09:15:00Z'), tz)).toBe(true);
    }
  });
});

// The autumn change repeats an hour: two different INSTANTS carry the same clock time. Comparing instants
// alone fires "daily 02:30" twice that night. `lastSlot` — the wall-clock minute — is what makes it once.
describe('daylight saving', () => {
  // Prague falls back at 03:00 → 02:00 on 2026-10-25, so 02:30 CEST (00:30 UTC) and 02:30 CET (01:30 UTC).
  const FIRST_0230 = utc('2026-10-25T00:30:00Z');
  const SECOND_0230 = utc('2026-10-25T01:30:00Z');

  it('the repeated hour really does produce two instants with the same clock time', () => {
    expect(mod.slotKey(FIRST_0230, PRAGUE)).toBe('2026-10-25T02:30');
    expect(mod.slotKey(SECOND_0230, PRAGUE)).toBe('2026-10-25T02:30');
    expect(SECOND_0230 - FIRST_0230).toBe(3_600_000); // an hour apart in real time
  });

  /** Replay the scheduler across a span of real time, recording exactly what it would have run. Ticks every
   *  30 s and stamps `lastRun`/`lastSlot` on a fire, exactly as CronAdapter.tick does. */
  const replay = (job: Record<string, unknown>, from: number, to: number, tz: string): string[] => {
    const fired: string[] = [];
    let state = { ...job };
    for (let now = from; now <= to; now += 30_000) {
      const slot = mod.dueSlot(state, now, tz);
      if (slot === null) continue;
      fired.push(slot);
      state = { ...state, lastRun: new Date(now).toISOString(), lastSlot: slot };
    }
    return fired;
  };

  // The whole point: the clock says 02:30 twice that night, and the job must run once. WHICH of the two
  // instants it picks is an implementation detail nobody can observe — the count is what the user feels.
  it('a daily job in the repeated hour fires exactly ONCE across the whole night', () => {
    const job = { id: 'j', schedule: 'daily 02:30', lastRun: new Date(utc('2026-10-24T02:30:00Z')).toISOString() };
    const fired = replay(job, utc('2026-10-24T23:00:00Z'), utc('2026-10-25T05:00:00Z'), PRAGUE);
    expect(fired).toEqual(['2026-10-25T02:30']);
  });

  it('a cron job in the repeated hour fires exactly ONCE too', () => {
    const job = { id: 'j', schedule: '30 2 * * *', lastRun: new Date(utc('2026-10-24T02:30:00Z')).toISOString() };
    const fired = replay(job, utc('2026-10-24T23:00:00Z'), utc('2026-10-25T05:00:00Z'), PRAGUE);
    expect(fired).toEqual(['2026-10-25T02:30']);
  });

  it('without the slot dedup it WOULD have fired twice — the repeated hour really is two instants', () => {
    // Guards the test above from silently passing for the wrong reason: drop `lastSlot` from the state (the
    // old instant-only behaviour) and the same night produces two runs.
    const job = { id: 'j', schedule: '30 2 * * *', lastRun: new Date(utc('2026-10-24T02:30:00Z')).toISOString() };
    let state: Record<string, unknown> = { ...job };
    const fired: string[] = [];
    for (let now = utc('2026-10-24T23:00:00Z'); now <= utc('2026-10-25T05:00:00Z'); now += 30_000) {
      const slot = mod.dueSlot(state, now, PRAGUE);
      if (slot === null) continue;
      fired.push(slot);
      state = { ...state, lastRun: new Date(now).toISOString() }; // lastRun only — no slot recorded
    }
    expect(fired).toEqual(['2026-10-25T02:30', '2026-10-25T02:30']);
  });

  it('the NEXT day still fires — the dedup is per slot, not a permanent block', () => {
    const ran = {
      id: 'j', schedule: 'daily 02:30',
      lastRun: new Date(FIRST_0230).toISOString(), lastSlot: '2026-10-25T02:30',
    };
    expect(mod.dueSlot(ran, utc('2026-10-26T01:30:00Z'), PRAGUE)).toBe('2026-10-26T02:30'); // 02:30 CET
  });

  it('a job whose clock time is SKIPPED by the spring change is skipped for that day, like standard cron', () => {
    // Prague springs forward 02:00 → 03:00 on 2026-03-29: 02:30 never happens that day.
    const job = { id: 'j', schedule: 'daily 02:30', lastRun: new Date(utc('2026-03-28T02:30:00Z')).toISOString() };
    // Right after the jump, the clock reads 03:05 — 02:30 was never on it.
    expect(mod.dueSlot(job, utc('2026-03-29T02:05:00Z'), PRAGUE)).not.toBe('2026-03-29T02:30');
    // …and the following day it fires normally again.
    expect(mod.dueSlot(job, utc('2026-03-30T00:30:00Z'), PRAGUE)).toBe('2026-03-30T02:30');
  });

  it('a job created before `lastSlot` existed does not re-fire its already-run slot on upgrade', () => {
    // Legacy row: lastRun only. Today's 07:30 already ran an hour ago.
    const legacy = { id: 'j', schedule: 'daily 07:30', lastRun: new Date(utc('2026-07-14T05:31:00Z')).toISOString() };
    expect(mod.dueSlot(legacy, utc('2026-07-14T06:30:00Z'), PRAGUE)).toBeNull();
    // …and tomorrow's slot still fires.
    expect(mod.dueSlot(legacy, utc('2026-07-15T05:30:00Z'), PRAGUE)).toBe('2026-07-15T07:30');
  });
});

// The zone is a free-text field an operator types by hand. Intl THROWS on an unknown zone, and every
// schedule flows through it — a typo must not take the whole scheduler down.
describe('a nonsense timezone degrades, it does not crash', () => {
  it('falls back to the machine\'s zone instead of throwing', () => {
    expect(() => mod.zonedParts(utc('2026-07-14T09:30:00Z'), 'Not/AZone')).not.toThrow();
    const job = { id: 'j', schedule: 'every 15m', lastRun: new Date(utc('2026-07-14T09:00:00Z')).toISOString() };
    expect(() => mod.isDue(job, utc('2026-07-14T09:20:00Z'), 'Not/AZone')).not.toThrow();
    expect(mod.isDue(job, utc('2026-07-14T09:20:00Z'), 'Not/AZone')).toBe(true); // jobs keep running
  });
});
