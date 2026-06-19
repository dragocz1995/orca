import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { EMPTY_USAGE, SESSION_MATCH_SKEW_MS, type TokenUsage } from './types.js';

/** claude-code stores one JSONL transcript per session under
 *  ~/.claude/projects/<encoded-cwd>/<sessionUuid>.jsonl, where each assistant event carries
 *  `message.usage`. Pick the session that started when this spawn ran and sum its usage.
 *  claude does not record cost, so costUsd stays null (price externally if needed). */
export function claudeUsage(home: string, dir: string, sinceMs: number): TokenUsage | null {
  const projDir = join(home, '.claude', 'projects', dir.replace(/[/.]/g, '-'));
  if (!existsSync(projDir)) return null;

  // Find the transcript whose first event started closest-after the spawn time.
  let best: { path: string; start: number } | null = null;
  for (const name of readdirSync(projDir)) {
    if (!name.endsWith('.jsonl')) continue;
    const p = join(projDir, name);
    const start = firstEventMs(p);
    if (start == null || start < sinceMs - SESSION_MATCH_SKEW_MS) continue;
    if (!best || start < best.start) best = { path: p, start };
  }
  if (!best) return null;

  const u: TokenUsage = { ...EMPTY_USAGE };
  for (const line of readFileSync(best.path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const ev = JSON.parse(line) as { message?: { usage?: Record<string, number> } };
      const us = ev.message?.usage;
      if (!us) continue;
      u.input += us.input_tokens ?? 0;
      u.output += us.output_tokens ?? 0;
      u.cacheWrite += us.cache_creation_input_tokens ?? 0;
      u.cacheRead += us.cache_read_input_tokens ?? 0;
    } catch { /* skip */ }
  }
  u.total = u.input + u.output + u.cacheRead + u.cacheWrite;
  return u;
}

/** Epoch ms of a transcript's first timestamped event, or null. */
function firstEventMs(path: string): number | null {
  let raw;
  try { raw = readFileSync(path, 'utf8'); } catch { return null; }
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const ev = JSON.parse(line) as { timestamp?: string };
      if (ev.timestamp) { const ms = Date.parse(ev.timestamp); if (!Number.isNaN(ms)) return ms; }
    } catch { /* skip */ }
  }
  return null;
}
