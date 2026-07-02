// Web plugin: search (Tavily) + page fetch as readable text — the Hermes `web` toolset shape, sized
// for the embedded brain. web_fetch needs no API key; web_search politely explains when none is set.
import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const FETCH_TIMEOUT_MS = 20_000;
const MAX_PAGE_CHARS = 20_000;
const ok = (text) => ({ content: [{ type: 'text', text }], details: {} });
const fail = (e) => ok(`Error: ${e instanceof Error ? e.message : String(e)}`);

/** Private/loopback/link-local guard: the brain must not be a proxy into the host's internal network. */
function isPrivate(ip) {
  return /^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip)
    || ip === '::1' || ip.startsWith('fe80:') || ip.startsWith('fc') || ip.startsWith('fd');
}

async function assertPublicHttpUrl(raw) {
  const url = new URL(raw);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('only http(s) URLs are allowed');
  const host = url.hostname;
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (addresses.some((a) => isPrivate(a.address))) throw new Error('URL resolves to a private address');
  return url;
}

/** Very small readable-text extraction: drop script/style/nav noise, strip tags, decode the common
 *  entities, collapse whitespace. Not a DOM parser by design — no dependencies, good enough for LLMs. */
export function htmlToText(html) {
  return html
    .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>(?=.)/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

export function register(ctx) {
  const maxResults = Number(ctx.config.maxResults) >= 1 ? Math.min(Number(ctx.config.maxResults), 10) : 5;

  ctx.registerTool(defineTool({
    name: 'web_search', label: 'Web search',
    description: 'Search the web and get titles, URLs and content snippets. Follow up with web_fetch for a full page.',
    parameters: Type.Object({ query: Type.String({ description: 'Search query' }) }),
    execute: async (_id, p) => {
      const apiKey = typeof ctx.config.tavilyApiKey === 'string' ? ctx.config.tavilyApiKey.trim() : '';
      if (!apiKey) return ok('web_search is not configured (no Tavily API key set in the web plugin settings). Use web_fetch with a known URL instead.');
      try {
        const res = await fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ api_key: apiKey, query: p.query, max_results: maxResults, include_answer: true }),
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        if (!res.ok) throw new Error(`tavily HTTP ${res.status}`);
        const data = await res.json();
        const lines = [];
        if (data.answer) lines.push(`Answer: ${data.answer}`, '');
        for (const r of data.results ?? []) lines.push(`- ${r.title}\n  ${r.url}\n  ${String(r.content ?? '').slice(0, 300)}`);
        return ok(lines.join('\n') || 'No results.');
      } catch (e) { return fail(e); }
    },
  }));

  ctx.registerTool(defineTool({
    name: 'web_fetch', label: 'Fetch web page',
    description: 'Fetch a public http(s) URL and return its readable text content.',
    parameters: Type.Object({ url: Type.String({ description: 'Absolute http(s) URL' }) }),
    execute: async (_id, p) => {
      try {
        const url = await assertPublicHttpUrl(p.url);
        const res = await fetch(url, {
          headers: { 'user-agent': 'orca-brain/1.0 (+web plugin)', accept: 'text/html,text/plain,application/json;q=0.9,*/*;q=0.5' },
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
          redirect: 'follow',
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const type = res.headers.get('content-type') ?? '';
        const body = await res.text();
        const text = type.includes('html') ? htmlToText(body) : body;
        return ok(text.length > MAX_PAGE_CHARS ? `${text.slice(0, MAX_PAGE_CHARS)}\n…[truncated]` : text);
      } catch (e) { return fail(e); }
    },
  }));

  ctx.logger.info('web tools registered (search + fetch)');
}
