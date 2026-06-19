import { parseTs } from './agentUtils';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface TaskTimeLabel {
  /** Compact relative label when the timestamp is within the last 24h ('45s','12m','3h'),
    * otherwise a locale-formatted date ('Jun 19, 14:02'). */
  label: string;
  /** Full absolute timestamp in the viewer's LOCAL time, for a title tooltip. DB timestamps
    * are UTC, so this converts them — otherwise the tooltip shows a confusing UTC clock. */
  title: string;
}

/** Render a DB (UTC) timestamp as an absolute local-time string for tooltips. */
function localFull(ms: number, locale?: string): string {
  return new Date(ms).toLocaleString(locale, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

/** Format a task timestamp as a single, unambiguous time label: a compact relative
 *  elapsed when it's within the last 24h, otherwise a locale date. The absolute local
 *  time is returned alongside for a title tooltip so it's always reachable (and never
 *  shows raw UTC). Falls back to the input string when it cannot be parsed. */
export function formatTaskTime(iso: string | null | undefined, nowMs: number, locale?: string): TaskTimeLabel {
  if (!iso) return { label: '', title: '' };
  const ms = parseTs(iso);
  if (ms == null) return { label: iso, title: iso };
  const title = localFull(ms, locale);
  const delta = nowMs - ms;
  if (delta < DAY_MS) {
    if (delta < 0) return { label: '0s', title };
    const secs = Math.floor(delta / 1000);
    if (secs < 60) return { label: `${secs}s`, title };
    const mins = Math.floor(secs / 60);
    if (mins < 60) return { label: `${mins}m`, title };
    const hours = Math.floor(mins / 60);
    return { label: `${hours}h`, title };
  }
  const label = new Date(ms).toLocaleString(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  return { label, title };
}
