import type { CronJob } from './types';

/** Weekday tokens as used by the cronjob plugin's `weekly <day> HH:MM` schedule (index = getDay()). */
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** A parsed 5-field cron expression: each field is the set of values it matches. */
interface CronParsed {
  kind: 'cron';
  minute: Set<number>; hour: Set<number>; dayOfMonth: Set<number>; month: Set<number>; dayOfWeek: Set<number>;
  domRestricted: boolean; dowRestricted: boolean;
}

type Parsed =
  | { kind: 'interval'; ms: number }
  | { kind: 'daily'; hour: number; minute: number }
  | { kind: 'weekly'; day: number; hour: number; minute: number }
  | CronParsed;

/** Parse ONE cron field into the set of values it matches — mirror of `parseCronField` in
 *  plugins/cronjob/index.mjs (kept in lockstep; a conformance test asserts they accept/reject the same
 *  corpus). Null on anything malformed so the caller rejects the whole expression. */
function parseCronField(spec: string, min: number, max: number, names?: string[], wrapValue?: number): Set<number> | null {
  const text = String(spec ?? '').trim().toLowerCase();
  if (!text) return null;
  const values = new Set<number>();
  const ceiling = wrapValue === undefined ? max : wrapValue;
  const wrap = (v: number) => (v === wrapValue ? min : v);
  const num = (token: string): number => {
    const named = names ? names.indexOf(token) : -1;
    const n = named >= 0 ? named + min : (/^\d+$/.test(token) ? Number(token) : NaN);
    return Number.isInteger(n) ? n : NaN;
  };
  for (const part of text.split(',')) {
    const slices = part.split('/');
    if (slices.length > 2) return null;
    const [range, stepText] = slices;
    if (stepText !== undefined && !/^\d+$/.test(stepText)) return null;
    const step = stepText === undefined ? 1 : Number(stepText);
    if (step < 1) return null;
    let lo: number;
    let hi: number;
    if (range === '*') {
      lo = min; hi = max;
    } else if (range.includes('-')) {
      const bounds = range.split('-');
      if (bounds.length !== 2) return null;
      lo = num(bounds[0]); hi = num(bounds[1]);
    } else {
      lo = num(range);
      hi = stepText === undefined ? lo : max;
    }
    if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo > hi) return null;
    if (lo < min || hi > ceiling) return null;
    for (let v = lo; v <= hi; v += step) values.add(wrap(v));
  }
  return values.size ? values : null;
}

/** Parse a standard 5-field cron expression, or null when it is not five valid fields. Mirror of the
 *  plugin's `parseCron`. */
function parseCron(spec: string): CronParsed | null {
  const fields = String(spec ?? '').trim().split(/\s+/);
  if (fields.length !== 5) return null;
  const minute = parseCronField(fields[0], 0, 59);
  const hour = parseCronField(fields[1], 0, 23);
  const dayOfMonth = parseCronField(fields[2], 1, 31);
  const month = parseCronField(fields[3], 1, 12, MONTHS);
  const dayOfWeek = parseCronField(fields[4], 0, 6, WEEKDAYS, 7);
  if (!minute || !hour || !dayOfMonth || !month || !dayOfWeek) return null;
  return {
    kind: 'cron', minute, hour, dayOfMonth, month, dayOfWeek,
    domRestricted: !fields[2].trim().startsWith('*'),
    dowRestricted: !fields[4].trim().startsWith('*'),
  };
}

/** Parse the plugin's schedule grammar — `every 15m` / `every 2h` / `daily 07:30` / `weekly sun 20:00`,
 *  or a standard 5-field cron expression. Deliberately a small mirror of `parseSchedule` in
 *  plugins/cronjob/index.mjs (kept in lockstep with it). Null = invalid. */
function parseSchedule(spec: string): Parsed | null {
  let m = /^every\s+(\d+)\s*(m|h)$/i.exec(spec.trim());
  if (m) {
    const ms = Number(m[1]) * (m[2].toLowerCase() === 'h' ? 3_600_000 : 60_000);
    return ms < 60_000 ? null : { kind: 'interval', ms };
  }
  m = /^daily\s+([01]?\d|2[0-3]):([0-5]\d)$/i.exec(spec.trim());
  if (m) return { kind: 'daily', hour: Number(m[1]), minute: Number(m[2]) };
  m = /^weekly\s+(sun|mon|tue|wed|thu|fri|sat)\s+([01]?\d|2[0-3]):([0-5]\d)$/i.exec(spec.trim());
  if (m) return { kind: 'weekly', day: WEEKDAYS.indexOf(m[1].toLowerCase()), hour: Number(m[2]), minute: Number(m[3]) };
  return parseCron(spec);
}

// A cron expression may next fire up to ~4 years out (e.g. `0 0 29 2 *` — Feb 29). Scanning by day keeps
// the day-level check cheap; capping at 4 years + 1 covers every leap-year case without an unbounded loop.
const CRON_SCAN_DAYS = 366 * 4 + 1;

/** The next epoch-ms a 5-field cron fires at or after `now`, on the viewer's local wall clock (matching
 *  the daily/weekly forms below). Walks candidate days forward, then picks the earliest matching HH:MM. */
function nextCronFire(sched: CronParsed, now: number): number | null {
  const start = new Date(now);
  const hours = [...sched.hour].sort((a, b) => a - b);
  const minutes = [...sched.minute].sort((a, b) => a - b);
  for (let d = 0; d <= CRON_SCAN_DAYS; d++) {
    const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + d);
    if (!sched.month.has(day.getMonth() + 1)) continue;
    const dom = sched.dayOfMonth.has(day.getDate());
    const dow = sched.dayOfWeek.has(day.getDay());
    // Cron's quirk: when BOTH day-of-month and day-of-week are restricted, a date matches if EITHER does.
    const dayMatch = sched.domRestricted && sched.dowRestricted ? (dom || dow) : (dom && dow);
    if (!dayMatch) continue;
    for (const h of hours) for (const mnt of minutes) {
      const t = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, mnt, 0, 0).getTime();
      if (t > now) return t;
    }
  }
  return null;
}

/** The next time a cron job will fire, in epoch ms — or null when it never will (disabled, spent
 *  one-shot, or an unparseable schedule). The soonest future-or-imminent fire: an overdue interval or
 *  a never-run job resolves to `now` (it fires on the next scheduler tick). Mirrors the plugin's
 *  `isDue` logic but computes the timestamp instead of a boolean. */
export function nextCronRun(job: CronJob, now: number): number | null {
  if (job.enabled === false) return null;
  // One-shot wake-up: fires exactly once at runAt, then the plugin deletes it. Already run → gone.
  if (job.runAt) {
    if (job.lastRun) return null;
    const at = Date.parse(job.runAt);
    return Number.isNaN(at) ? null : Math.max(at, now);
  }
  const sched = parseSchedule(job.schedule);
  if (!sched) return null;
  const last = job.lastRun ? Date.parse(job.lastRun) : 0;

  if (sched.kind === 'interval') {
    return Math.max((Number.isNaN(last) ? 0 : last) + sched.ms, now);
  }

  if (sched.kind === 'cron') {
    return nextCronFire(sched, now);
  }

  // daily / weekly: the next clock occurrence of HH:MM (on the right weekday), at or after now.
  const at = new Date(now);
  at.setHours(sched.hour, sched.minute, 0, 0);
  if (sched.kind === 'weekly') {
    const ahead = (sched.day - at.getDay() + 7) % 7;
    at.setDate(at.getDate() + ahead);
  }
  if (at.getTime() <= now) at.setDate(at.getDate() + (sched.kind === 'weekly' ? 7 : 1));
  return at.getTime();
}

/** Whether `spec` is a valid schedule the dashboard can compute a next-run for. Exposed for the
 *  cross-tree cron conformance test (the parser must accept/reject the same corpus as the daemon). */
export function isParseableSchedule(spec: string): boolean {
  return parseSchedule(spec) !== null;
}
