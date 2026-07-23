// Teams-flavoured formatting: shared splitting/reply-context helpers sized for Teams message limits.
import { splitContent as splitAtChunk, parseModelExec } from '../../_shared/format.mjs';

export { parseModelExec };

/** Teams caps a message payload around 28KB; markdown text well under that keeps every client happy. */
export const CHUNK = 20000;

/** Split a Teams reply into ≤CHUNK pieces without breaking a fenced code block (shared core + our size). */
export const splitContent = (text) => splitAtChunk(text, CHUNK);

/** The quoted-original context line a reply carries into the shared conversation. */
export function buildReplyContext(name, body) {
  const quoted = String(body ?? '').replace(/\s+/g, ' ').trim();
  if (!quoted) return '';
  const clipped = quoted.length > 280 ? `${quoted.slice(0, 279)}…` : quoted;
  return `[In reply to ${name}: "${clipped}"]`;
}

/** The runtime footer under a final reply: `model · context %` from the idle event, or ''. */
export function footerLine(idle) {
  if (!idle?.model) return '';
  const pct = idle.usage?.percent;
  const ctx = typeof pct === 'number' && Number.isFinite(pct) ? ` · context ${Math.round(pct)}%` : '';
  return `${idle.model}${ctx}`;
}
