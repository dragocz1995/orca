import type { WizardCtx } from './types.js';

/** One authenticated JSON call to the daemon API using the wizard's bearer token when present. Returns
 *  the parsed body (or null when there's none) plus `ok`/`status`, so callers branch on failures without
 *  a throw. Mirrors the fetch shape in setup.ts (`saveConfig`) — the daemon HTTP API is the one source
 *  of truth; the wizard never writes the DB directly. */
export async function apiJson<T = unknown>(
  ctx: WizardCtx, method: string, path: string, body?: unknown,
): Promise<{ ok: boolean; status: number; data: T | null }> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (ctx.token) headers.authorization = `Bearer ${ctx.token}`;
  const r = await ctx.fetchFn(`${ctx.base}${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data: T | null = null;
  try { data = await r.json() as T; } catch { /* empty or non-JSON body */ }
  return { ok: r.ok, status: r.status, data };
}
