import { logger } from '../../shared/logger.js';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { ElowenApp, RouteContext } from '../context.js';
import type { PluginHttpRequest } from '../../plugins/api.js';

/** External webhooks are small control notifications (a Teams activity is a few KB); anything larger is
 *  not a webhook. Enforced here because the app has no global body cap. */
const MAX_HOOK_BODY_BYTES = 1024 * 1024;

const log = logger('hooks');

/** Plugin webhook mounts: one catch-all dispatcher over `/hooks/<plugin>/<path>`, resolved against the
 *  CURRENT plugin registry on every request (a plugin reload is reflected with no re-mounting). The
 *  bearer layer treats `/hooks/*` as public — each plugin handler owns its authentication (e.g. the
 *  Teams plugin validates Microsoft's JWT), and unknown mounts 404 without revealing what exists. */
export function registerHookRoutes(app: ElowenApp, ctx: RouteContext): void {
  const { d } = ctx;
  app.all('/hooks/*', async (c) => {
    const registry = await d.plugins?.get().catch(() => undefined);
    const match = registry?.httpRoute(c.req.path.slice('/hooks/'.length));
    if (!match) return c.json({ error: 'not found' }, 404);

    const declared = Number(c.req.header('content-length') ?? '0');
    if (declared > MAX_HOOK_BODY_BYTES) return c.json({ error: 'payload too large' }, 413);
    const raw = Buffer.from(await c.req.arrayBuffer());
    if (raw.byteLength > MAX_HOOK_BODY_BYTES) return c.json({ error: 'payload too large' }, 413);

    const headers: Record<string, string> = {};
    c.req.raw.headers.forEach((value, key) => { headers[key.toLowerCase()] = value; });
    const request: PluginHttpRequest = {
      method: c.req.method,
      path: match.remainder,
      query: c.req.query(),
      headers,
      body: () => Promise.resolve(raw),
      json: <T = unknown>() => Promise.resolve(JSON.parse(raw.toString('utf8')) as T),
    };

    try {
      const res = await match.handler(request);
      const status = (res.status ?? 200) as ContentfulStatusCode;
      const body = res.body;
      if (body === undefined || typeof body === 'string') return c.body(body ?? '', status, res.headers ?? {});
      if (body instanceof Uint8Array) return c.body(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer, status, res.headers ?? {});
      return c.json(body, status, res.headers ?? {});
    } catch (error) {
      // The failure detail stays daemon-side: an external caller (or probe) learns nothing about the
      // handler's internals from the response.
      log.warn(`hook handler failed for ${c.req.path}: ${error instanceof Error ? error.message : String(error)}`);
      return c.json({ error: 'hook handler failed' }, 500);
    }
  });
}
