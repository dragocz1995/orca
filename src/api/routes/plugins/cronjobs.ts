import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { isValidSchedule } from '../../../shared/cronSchedule.js';
import type { ElowenApp, RouteContext } from '../../context.js';
import type { PluginRoutesShared } from './shared.js';

/** ── Cron jobs (cronjob plugin): jobs.json is a SHARED list — the scheduler stamps runs into it, the
 *  brain's CronAdd/CronRemove tools write it, and this UI edits it. So a write here names exactly ONE
 *  job and the file is read-modify-written around it. It must never take the whole array from the
 *  client: a page that loaded its snapshot before someone else added a job would delete that job on the
 *  next save, and a browser tab left open for a day is enough to lose one. The plugin's scheduler
 *  re-reads the file every tick (30 s), so an edit applies live — no restart. ── */
export function registerCronjobRoutes(app: ElowenApp, ctx: RouteContext, shared: PluginRoutesShared): void {
  const { d } = ctx;
  const { notAdmin } = shared;

  const cronJobsFile = (): string | null => (d.pluginDataRoot ? join(d.pluginDataRoot, 'cronjob', 'jobs.json') : null);
  /** The jobs on disk. THROWS when the file is there but unreadable — a caller about to write the list
   *  back must abort, not rebuild it from an empty base: the plugin's own store rewrites jobs.json with a
   *  plain (non-atomic) writeFileSync, so a read that lands mid-write must never be mistaken for "there
   *  are no jobs". Only the read-only GET may treat that as empty. */
  const readCronJobs = (file: string): Record<string, unknown>[] => {
    if (!existsSync(file)) return [];
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf-8'));
    if (!Array.isArray(parsed)) throw new Error('jobs.json is not an array');
    return parsed as Record<string, unknown>[];
  };
  /** The fields a client owns. Everything else a job carries on disk is the SCHEDULER's (lastRun,
   *  lastSlot, lastResult) and is merged back from the file — writing a stale lastRun back would make an
   *  interval job due again on the next tick, and a dropped lastSlot would re-fire a slot already run. */
  const CRON_FIELDS = ['id', 'name', 'schedule', 'prompt', 'check', 'hours', 'notifyChannelId', 'plain', 'model', 'enabled', 'runAt', 'createdAt'] as const;
  /** Why this job is not storable, or null when it is. */
  const cronJobError = (j: Record<string, unknown>): string | null => {
    for (const k of ['id', 'name', 'schedule', 'prompt'] as const) {
      if (typeof j[k] !== 'string' || (j[k] as string).trim() === '') return `a job needs a non-empty "${k}"`;
    }
    const oneShot = j.runAt !== undefined;
    if (oneShot ? typeof j.runAt !== 'string' || Number.isNaN(Date.parse(j.runAt)) : !isValidSchedule(j.schedule as string)) {
      return `invalid schedule "${String(j.schedule)}" — use "every 15m", "every 2h", "daily 07:30", "weekly sun 20:00" or a 5-field cron expression`;
    }
    // Optional cheap guard command — must be a string when present (empty = no guard).
    if (j.check !== undefined && typeof j.check !== 'string') return 'check must be omitted or a string';
    // Optional plain delivery flag — suppresses the "⏰ job name" header on delivered results.
    if (j.plain !== undefined && typeof j.plain !== 'boolean') return 'plain must be omitted or a boolean';
    // Optional per-job model: either absent, or an object carrying non-empty provider + model strings.
    if (j.model !== undefined) {
      const m = j.model as { provider?: unknown; model?: unknown } | null;
      if (typeof m !== 'object' || m === null || typeof m.provider !== 'string' || typeof m.model !== 'string' || !m.provider.trim() || !m.model.trim()) {
        return 'model must be omitted or an object with non-empty provider and model';
      }
    }
    return null;
  };

  app.get('/plugins/cronjob/jobs', (c) => {
    if (notAdmin(c)) return c.json({ error: 'forbidden' }, 403);
    const file = cronJobsFile();
    if (!file) return c.json([]);
    try { return c.json(readCronJobs(file)); }
    catch { return c.json([]); } // a read-only view may show an unreadable file as empty; a write may not
  });

  // Upsert ONE job, leaving every other job on disk exactly as it is.
  app.put('/plugins/cronjob/jobs/:id', async (c) => {
    if (notAdmin(c)) return c.json({ error: 'forbidden' }, 403);
    const file = cronJobsFile();
    if (!file) return c.json({ error: 'plugin data dir unavailable' }, 503);
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object' || Array.isArray(body)) return c.json({ error: 'body must be a job object' }, 400);
    // The URL names the job — a body id can't redirect the write onto another one.
    const job: Record<string, unknown> = { ...body, id: c.req.param('id') };
    const error = cronJobError(job);
    if (error) return c.json({ error }, 400);

    let jobs: Record<string, unknown>[];
    try { jobs = readCronJobs(file); }
    catch { return c.json({ error: 'jobs file is unreadable — refusing to write over it' }, 500); }
    const prev = jobs.find((j) => j.id === job.id);
    const edit: Record<string, unknown> = {};
    for (const k of CRON_FIELDS) if (job[k] !== undefined) edit[k] = job[k];
    const runtime: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(prev ?? {})) if (!(CRON_FIELDS as readonly string[]).includes(k)) runtime[k] = v;
    // A job that just flipped to enabled (or arrived new as enabled) is armed from NOW, so it waits for
    // its next natural slot instead of firing immediately. Arming means BOTH halves of the scheduler's run
    // state: `lastSlot` decides a daily/weekly job on slot identity alone, so leaving Monday's slot behind
    // on a job re-enabled on Thursday would fire it on the spot. One-shot (runAt) jobs are excluded — they
    // fire exactly once, while lastRun is empty.
    const enabling = !job.runAt && edit.enabled !== false && (!prev || prev.enabled === false);
    if (enabling) delete runtime.lastSlot;
    const saved = { ...edit, ...runtime, ...(enabling ? { lastRun: new Date().toISOString() } : {}) };

    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(prev ? jobs.map((j) => (j.id === job.id ? saved : j)) : [...jobs, saved], null, 2));
    return c.json({ ok: true });
  });

  // Idempotent: deleting a job that is already gone is a success, not a 404. A client racing its own
  // in-flight save (or another tab) must be able to say "this job should not exist" without having to know
  // whether it currently does.
  app.delete('/plugins/cronjob/jobs/:id', (c) => {
    if (notAdmin(c)) return c.json({ error: 'forbidden' }, 403);
    const file = cronJobsFile();
    if (!file) return c.json({ error: 'plugin data dir unavailable' }, 503);
    let jobs: Record<string, unknown>[];
    try { jobs = readCronJobs(file); }
    catch { return c.json({ error: 'jobs file is unreadable — refusing to write over it' }, 500); }
    const rest = jobs.filter((j) => j.id !== c.req.param('id'));
    if (rest.length !== jobs.length) writeFileSync(file, JSON.stringify(rest, null, 2));
    return c.json({ ok: true });
  });
}
