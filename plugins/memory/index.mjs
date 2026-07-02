// Memory plugin: durable cross-conversation memory on a self-hosted mem0 REST server (the same
// shape Hermes uses). The brain decides WHAT to remember; this plugin only ferries it.
import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

const TIMEOUT_MS = 30_000;
const ok = (text) => ({ content: [{ type: 'text', text }], details: {} });
const fail = (e) => ok(`Error: ${e instanceof Error ? e.message : String(e)}`);

export function register(ctx) {
  const endpoint = typeof ctx.config.endpoint === 'string' ? ctx.config.endpoint.replace(/\/$/, '') : '';
  if (!endpoint) { ctx.logger.warn('enabled but no endpoint configured — tools not registered'); return; }
  const apiKey = typeof ctx.config.apiKey === 'string' ? ctx.config.apiKey.trim() : '';
  const userId = (typeof ctx.config.userId === 'string' && ctx.config.userId.trim()) || 'orca';

  const call = async (path, body) => {
    const res = await fetch(`${endpoint}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(apiKey ? { 'x-api-key': apiKey } : {}) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`mem0 HTTP ${res.status} on ${path}`);
    return res.json();
  };

  ctx.registerTool(defineTool({
    name: 'add_memory', label: 'Remember',
    description: 'Save a durable, reusable fact to long-term memory (preferences, decisions, infrastructure details). One self-contained fact per call. Never store secrets.',
    parameters: Type.Object({ text: Type.String({ description: 'The fact to remember, self-contained' }) }),
    execute: async (_id, p) => {
      try {
        await call('/memories', { messages: [{ role: 'user', content: p.text }], user_id: userId, agent_id: 'orca' });
        return ok('Saved to long-term memory.');
      } catch (e) { return fail(e); }
    },
  }));

  ctx.registerTool(defineTool({
    name: 'search_memory', label: 'Recall',
    description: 'Search long-term memory for facts relevant to a query.',
    parameters: Type.Object({ query: Type.String({ description: 'What to look for' }) }),
    execute: async (_id, p) => {
      try {
        const data = await call('/search', { query: p.query, user_id: userId, limit: 8 });
        const hits = (data.results ?? data ?? []).map?.((r) => `- ${r.memory ?? r.text ?? JSON.stringify(r)}`) ?? [];
        return ok(hits.length ? hits.join('\n') : 'No relevant memories.');
      } catch (e) { return fail(e); }
    },
  }));

  ctx.logger.info(`memory tools registered (mem0 @ ${endpoint}, user ${userId})`);
}
