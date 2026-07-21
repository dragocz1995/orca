import type { Db } from './db.js';
import type { TokenUsage, CostSource } from '../integrations/usage/types.js';
import { TASK_PREFIX } from '../brain/sessionId.js';

// Normalized usage rows shared by usageByDay + usageByModel. One row per LIVE assistant message (its
// `$.usage`, attributed to the model it recorded in `$.model`) UNIONed with one row per per-model
// compaction-rollup bucket (`$.usageRollup[]` fanned out with json_each — a divider with no rollup
// contributes nothing). `ts` is the ms-epoch attribution point: a live row's own `$.timestamp`, or a
// rolled-up bucket's `at` (newest dropped row of that model) — so compaction NEVER moves spend to the
// compaction moment. `model` is the row's own producing model, falling back to the session's model only
// for legacy rows that predate per-message model capture. Purely static SQL (no user input) → safe to
// interpolate. Callers add the user/window/day filters + GROUP BY.
const USAGE_ROWS = `
  SELECT s.user_id AS user_id, s.id AS session_id,
         COALESCE(NULLIF(json_extract(m.content, '$.model'), ''), s.model) AS model,
         json_extract(m.content, '$.timestamp') AS ts,
         COALESCE(json_extract(m.content, '$.usage.input'), 0) AS input,
         COALESCE(json_extract(m.content, '$.usage.output'), 0) AS output,
         COALESCE(json_extract(m.content, '$.usage.cacheRead'), 0) AS cache_read,
         COALESCE(json_extract(m.content, '$.usage.cacheWrite'), 0) AS cache_write,
         COALESCE(json_extract(m.content, '$.usage.totalTokens'), 0) AS total,
         COALESCE(json_extract(m.content, '$.usage.reasoning'), 0) AS reasoning,
         json_extract(m.content, '$.usage.cost.total') AS cost
    FROM brain_messages m JOIN brain_sessions s ON s.id = m.session_id
   WHERE m.role = 'assistant'
  UNION ALL
  SELECT s.user_id AS user_id, s.id AS session_id,
         COALESCE(NULLIF(json_extract(je.value, '$.model'), ''), s.model) AS model,
         json_extract(je.value, '$.at') AS ts,
         COALESCE(json_extract(je.value, '$.input'), 0) AS input,
         COALESCE(json_extract(je.value, '$.output'), 0) AS output,
         COALESCE(json_extract(je.value, '$.cacheRead'), 0) AS cache_read,
         COALESCE(json_extract(je.value, '$.cacheWrite'), 0) AS cache_write,
         COALESCE(json_extract(je.value, '$.totalTokens'), 0) AS total,
         COALESCE(json_extract(je.value, '$.reasoning'), 0) AS reasoning,
         json_extract(je.value, '$.cost.total') AS cost
    FROM brain_messages m JOIN brain_sessions s ON s.id = m.session_id,
         json_each(json_extract(m.content, '$.usageRollup')) je
   WHERE m.role = 'compaction'`;

// A `brain-task-<id>` worker session is EXCLUDED from the brain aggregates ONLY when its spend is
// already snapshotted in task_usage (merged separately by /usage/by-model & /usage/by-day) — excluding
// it here too would double-count a task creator's spend. A worker that crashed BEFORE snapshotting
// (task then failed/cancelled, never relaunched) has NO task_usage row, so its persisted spend is KEPT
// here instead of vanishing from every stat. Non-task chat sessions always pass.
// `substr(id, TASK_PREFIX.length + 1)` recovers the task id (SQLite substr is 1-indexed) — derived from
// the prefix so a rename can't leave the old magic offset behind.
const TASK_SNAPSHOT_EXCLUSION = `NOT (session_id LIKE '${TASK_PREFIX}%' AND EXISTS (SELECT 1 FROM task_usage tu WHERE tu.task_id = substr(session_id, ${TASK_PREFIX.length + 1})))`;

/** Persisted usage of a delegated session tree. Unlike live context usage, these are cumulative token
 *  and cost totals only; callers must keep the root session's own context-window fill unchanged. */
export interface BrainDescendantUsage {
  input: number; output: number; cacheRead: number; cacheWrite: number;
  totalTokens: number; reasoning: number; cost: number;
}

/** One per-model bucket of usage rolled up from the assistant rows a compaction DROPS, folded onto the
 *  `compaction` divider so historical spend survives (compaction deletes those rows). Stored as an ARRAY
 *  under `$.usageRollup` — one bucket per model that produced dropped spend — under a key that is NEVER
 *  `usage`, so PI's live session and `usageOf` (statusline) never double-count it after rehydrate.
 *  `model` preserves per-model attribution across compaction; `at` is the ms-epoch of the newest dropped
 *  row of that model (the day/window attribution basis, standing in for a live row's `$.timestamp`). */
export interface UsageRollupBucket {
  model: string;
  input: number; output: number; cacheRead: number; cacheWrite: number;
  totalTokens: number; reasoning: number; at: number; cost?: { total: number };
}

/** Fold the usage of the rows a compaction is about to delete into PER-MODEL rollup buckets: assistant
 *  rows via `$.usage`, attributed to their own `$.model`; and any earlier compaction dividers via their
 *  own `$.usageRollup` buckets, so multiple compactions chain without losing spend OR its per-model
 *  breakdown. Each bucket's `at` is the ms-epoch of the newest dropped row of THAT model, so rolled-up
 *  spend keeps its ORIGINAL date instead of jumping to the compaction moment. Returns null when nothing
 *  dropped carried usage (keeps the divider clean). */
export function rollupDroppedUsage(dropped: readonly { content: string }[]): UsageRollupBucket[] | null {
  const byModel = new Map<string, UsageRollupBucket>();
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const bucketFor = (model: string): UsageRollupBucket => {
    let b = byModel.get(model);
    if (!b) { b = { model, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, reasoning: 0, at: 0 }; byModel.set(model, b); }
    return b;
  };
  const fold = (b: UsageRollupBucket, u: Record<string, unknown>, at: number): void => {
    b.input += num(u.input); b.output += num(u.output);
    b.cacheRead += num(u.cacheRead); b.cacheWrite += num(u.cacheWrite);
    b.reasoning += num(u.reasoning); b.totalTokens += num(u.totalTokens);
    const cost = (u as { cost?: { total?: unknown } }).cost;
    if (cost && typeof cost === 'object' && typeof cost.total === 'number') b.cost = { total: (b.cost?.total ?? 0) + cost.total };
    if (at > b.at) b.at = at; // newest dropped row of this model wins as its attribution point
  };
  for (const row of dropped) {
    let content: unknown;
    try { content = JSON.parse(row.content); } catch { continue; }
    if (typeof content !== 'object' || content === null) continue;
    const c = content as { usage?: Record<string, unknown>; usageRollup?: unknown; model?: unknown; timestamp?: unknown };
    if (Array.isArray(c.usageRollup)) {
      // A prior divider — merge each of its per-model buckets (chained compaction).
      for (const raw of c.usageRollup) {
        if (!raw || typeof raw !== 'object') continue;
        const pb = raw as Record<string, unknown>;
        fold(bucketFor(typeof pb.model === 'string' ? pb.model : ''), pb, num(pb.at));
      }
    } else if (c.usage && typeof c.usage === 'object') {
      // An assistant message — attribute to the model it recorded (empty → resolved to the session model
      // in SQL for legacy rows that predate per-message model capture).
      fold(bucketFor(typeof c.model === 'string' ? c.model : ''), c.usage, typeof c.timestamp === 'number' ? c.timestamp : 0);
    }
  }
  const buckets = [...byModel.values()].filter((b) => b.totalTokens !== 0 || b.cost != null);
  if (buckets.length === 0) return null;
  for (const b of buckets) if (b.at === 0) b.at = Date.now(); // undated legacy → the compaction moment
  return buckets;
}

/** Persisted usage-accounting views over the brain message store: per-day and per-model spend for the
 *  Stats dashboard, and per-tree descendant totals. Extracted from {@link BrainStore} (which delegates to
 *  it) — it shares only the {@link Db} handle. Reads the normalized {@link USAGE_ROWS} (live assistant
 *  `$.usage` + per-model compaction rollups), so a compacted session's history keeps its spend. */
export class BrainUsageStore {
  constructor(private db: Db) {}

  /** Per-day token/cost totals of the user's OWN brain chat sessions (NOT task worker or channel-anchor
   *  sessions) over the last `days` days, for the dashboard spend tiles — task_usage only covers task
   *  workers, so without this a paid chat model burned money invisibly. `brain-task-%` sessions are
   *  excluded only when already snapshotted in task_usage (see {@link TASK_SNAPSHOT_EXCLUSION}). */
  usageByDay(userId: number, days = 7): { day: string; tokens: number; cost: number | null }[] {
    return this.db.prepare(
      `WITH usage_rows AS (${USAGE_ROWS})
       SELECT date(ts / 1000, 'unixepoch') AS day,
              COALESCE(SUM(total), 0) AS tokens,
              CASE WHEN COUNT(cost) = 0 THEN NULL ELSE SUM(cost) END AS cost
         FROM usage_rows
        WHERE user_id = ?
          AND ts IS NOT NULL
          AND ${TASK_SNAPSHOT_EXCLUSION}
          AND date(ts / 1000, 'unixepoch') >= date('now', ?)
        GROUP BY day ORDER BY day`
    ).all(userId, `-${Math.max(0, Math.floor(days) - 1)} days`) as { day: string; tokens: number; cost: number | null }[];
  }

  /** Total token/cost usage of the user's OWN brain CHAT sessions aggregated per model (exec spec), for
   *  the web Stats page's /usage/by-model view — the analogue of usageByDay, so chat spend on a paid
   *  model is no longer invisible there. Groups the normalized USAGE_ROWS by the model that ACTUALLY
   *  produced each assistant row (its `$.model`, or a rollup bucket's `model`) — NOT the session's
   *  current model, so switching a conversation's model never retroactively re-attributes its history —
   *  and emits `elowen:<model>` so a model that ALSO ran as a task worker folds into the SAME bucket the
   *  task_usage aggregate uses. `brain-task-%` sessions are excluded only when already snapshotted in
   *  task_usage (TASK_SNAPSHOT_EXCLUSION); platform channel sessions (Discord) ARE included — the operator
   *  anchors them, so their spend counts as the operator's. Brain chat cost is OpenRouter provider-reported, so a costed
   *  bucket is `provider_reported`; an uncosted one is `unavailable` (costUsd null), matching usageByDay's
   *  null-vs-real-$0 distinction. Optional `window` narrows by each row's own attribution timestamp (ms
   *  epoch), same basis as usageByDay; undated rows are excluded from BOTH the windowed and unwindowed
   *  view (`ts IS NOT NULL`) so windowed totals always sum to the unwindowed total. A bucket comes back
   *  if it has any tokens OR any cost (a provider that reports cost with zero tokens still counts). */
  usageByModel(userId: number, window?: { fromIso?: string; toIso?: string }): { exec: string; usage: TokenUsage }[] {
    const clauses = [`user_id = ?`, `ts IS NOT NULL`, `model != ''`, TASK_SNAPSHOT_EXCLUSION];
    const params: (string | number)[] = [userId];
    const fromMs = window?.fromIso ? Date.parse(window.fromIso) : NaN;
    const toMs = window?.toIso ? Date.parse(window.toIso) : NaN;
    if (Number.isFinite(fromMs)) { clauses.push(`ts >= ?`); params.push(fromMs); }
    if (Number.isFinite(toMs)) { clauses.push(`ts <= ?`); params.push(toMs); }
    interface Row { model: string; input: number; output: number; cache_read: number; cache_write: number; total: number; reasoning: number; cost: number | null }
    const rows = this.db.prepare(
      `WITH usage_rows AS (${USAGE_ROWS})
       SELECT model AS model,
              COALESCE(SUM(input), 0) AS input,
              COALESCE(SUM(output), 0) AS output,
              COALESCE(SUM(cache_read), 0) AS cache_read,
              COALESCE(SUM(cache_write), 0) AS cache_write,
              COALESCE(SUM(total), 0) AS total,
              COALESCE(SUM(reasoning), 0) AS reasoning,
              CASE WHEN COUNT(cost) = 0 THEN NULL ELSE SUM(cost) END AS cost
         FROM usage_rows
        WHERE ${clauses.join(' AND ')}
        GROUP BY model`
    ).all(...params) as Row[];
    return rows
      .filter((r) => r.total > 0 || (r.cost ?? 0) > 0)
      .map((r) => {
        const costSource: CostSource = r.cost != null ? 'provider_reported' : 'unavailable';
        const usage: TokenUsage = {
          input: r.input, output: r.output, cacheRead: r.cache_read, cacheWrite: r.cache_write,
          total: r.total, reasoning: r.reasoning, costUsd: r.cost, currency: r.cost != null ? 'USD' : null, costSource,
        };
        return { exec: `elowen:${r.model}`, usage };
      });
  }

  /** Sum every persisted descendant of `sessionId` (direct child + arbitrary nested delegates) from
   *  the SAME normalized rows used by the global usage views. This includes compaction `usageRollup`
   *  buckets, so archiving old child context never makes its spend disappear. The root itself is
   *  intentionally excluded: its live PI session remains authoritative for its own statusline usage.
   *  No task-snapshot exclusion applies here — this is one conversation tree, not the global task/chat
   *  merge. The owner predicate is defensive against a manually-corrupted cross-user relation. */
  descendantUsage(sessionId: string): BrainDescendantUsage {
    interface Row {
      input: number; output: number; cache_read: number; cache_write: number;
      total: number; reasoning: number; cost: number;
    }
    const row = this.db.prepare(
      `WITH RECURSIVE descendants(id, user_id) AS (
         SELECT child.id, child.user_id
           FROM brain_sessions child
           JOIN brain_sessions root ON root.id = ?
          WHERE child.parent_session_id = root.id AND child.user_id = root.user_id
         UNION
         SELECT child.id, child.user_id
           FROM brain_sessions child JOIN descendants parent ON child.parent_session_id = parent.id
          WHERE child.user_id = parent.user_id
       ), usage_rows AS (${USAGE_ROWS})
       SELECT COALESCE(SUM(u.input), 0) AS input,
              COALESCE(SUM(u.output), 0) AS output,
              COALESCE(SUM(u.cache_read), 0) AS cache_read,
              COALESCE(SUM(u.cache_write), 0) AS cache_write,
              COALESCE(SUM(u.total), 0) AS total,
              COALESCE(SUM(u.reasoning), 0) AS reasoning,
              COALESCE(SUM(u.cost), 0) AS cost
         FROM usage_rows u JOIN descendants d ON d.id = u.session_id`
    ).get(sessionId) as Row;
    return {
      input: row.input, output: row.output, cacheRead: row.cache_read, cacheWrite: row.cache_write,
      totalTokens: row.total, reasoning: row.reasoning, cost: row.cost,
    };
  }
}
