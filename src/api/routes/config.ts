import { streamSSE } from 'hono/streaming';
import { isNewer } from '../../cli/version.js';
import { handleMcpRequest } from '../../mcp/server.js';
import { eventProjectId } from '../eventProject.js';
import { ORCA_VERSION, ORCA_PORT, defaultLatestVersion, defaultStartUpdate } from '../version.js';
import { parseBody } from '../validation.js';
import { pushSubscribeSchema, pushUnsubscribeSchema } from '../schemas/config.js';
import type { OrcaEvent } from '../sse.js';
import type { OrcaApp, RouteContext } from '../context.js';

/** Daemon-wide surface: the stateless MCP endpoint, web-push key + per-user subscribe/unsubscribe,
 *  config read/write (admin-gated write), the System panel (version/update-available) and the live
 *  SSE event stream (per-subscriber tenancy gate). */
export function registerConfigRoutes(app: OrcaApp, ctx: RouteContext): void {
  const { d, accessibleProjects, eventDeps } = ctx;
  // MCP endpoint: the advisor agent connects here to control Orca with native tools. Each request is
  // handled statelessly with the toolset bound to the caller's token, and every tool delegates to the
  // same `callOrcaApi` core as the `orca api` CLI verb — so a new REST endpoint needs zero edits here.
  app.all('/mcp', async c => {
    const token = c.get('token');
    return handleMcpRequest(c.req.raw, { url: `http://localhost:${ORCA_PORT}`, token });
  });

  // --- Web push: the browser's VAPID public key, plus per-user device subscribe/unsubscribe. The
  // public key is safe pre-auth (it's public); subscribe/unsubscribe are scoped to the authed user.
  app.get('/push/vapid-public-key', (c) => c.json({ publicKey: d.config.get().webPush.publicKey }));
  app.post('/push/subscribe', async (c) => {
    const u = c.get('user');
    if (!u) return c.json({ error: 'unauthorized' }, 401);
    const b = await parseBody(c, pushSubscribeSchema);
    d.pushSubscriptions?.upsert(u.id, { endpoint: b.endpoint, keys: { p256dh: b.keys.p256dh, auth: b.keys.auth } });
    return c.json({ ok: true }, 201);
  });
  app.post('/push/unsubscribe', async (c) => {
    const u = c.get('user');
    if (!u) return c.json({ error: 'unauthorized' }, 401);
    const b = await parseBody(c, pushUnsubscribeSchema);
    d.pushSubscriptions?.removeForUser(u.id, b.endpoint); // scoped: can only remove your own device
    return c.json({ ok: true });
  });

  app.get('/config', (c) => c.json(d.config.get()));
  app.put('/config', async (c) => {
    // Editing the daemon config is admin-only (the Administration surface); reads stay open so the
    // app can populate model pickers etc. During setup (no users yet) it's open so onboarding can
    // save providers/the API key before the first admin exists.
    if (d.users && d.users.count() > 0) { const u = c.get('user'); if (!u || !d.users.isAdmin(u.id)) return c.json({ error: 'forbidden' }, 403); }
    const patch = await c.req.json();
    return c.json(d.config.update(patch));
  });

  // System panel: the running version, the latest published one, whether an update is available, and
  // the auto-update opt-in. Read-only and cheap (the registry lookup is cached), so any authed user
  // may see it (non-admins still can't trigger the update below).
  app.get('/system', async (c) => {
    const latest = await (d.latestVersion ?? defaultLatestVersion)();
    return c.json({
      version: ORCA_VERSION,
      latest,
      updateAvailable: latest ? isNewer(latest, ORCA_VERSION) : false,
      autoUpdate: d.config.get().autoUpdate,
    });
  });

  // Trigger a manual in-place update. Admin-only (mirrors /config) and refused while a mission is live
  // — the update restarts the services, which would kill the running agent sessions.
  app.post('/system/update', (c) => {
    if (d.users && d.users.count() > 0) { const u = c.get('user'); if (!u || !d.users.isAdmin(u.id)) return c.json({ error: 'forbidden' }, 403); }
    if (d.missions.live().length > 0) return c.json({ error: 'mission_running' }, 409);
    (d.startUpdate ?? defaultStartUpdate)();
    return c.json({ started: true });
  });

  app.get('/events', c => streamSSE(c, async stream => {
    // Per-subscriber tenancy gate: admin/open mode (null) streams everything; a tenant receives only
    // events in its projects. An event with no resolvable project is withheld from tenants — fail closed.
    const allowed = accessibleProjects(c);
    const visible = (e: OrcaEvent): boolean => {
      if (!allowed) return true;
      const pid = eventProjectId(e, eventDeps);
      return pid !== null && allowed.has(pid);
    };
    const off = d.bus.subscribe(e => { if (visible(e)) void stream.writeSSE({ data: JSON.stringify(e), event: e.type }); });
    c.req.raw.signal.addEventListener('abort', off);
    // Flush an immediate comment: a streamed response sends no HTTP headers until the first body byte,
    // so through the web BFF proxy the live channel would never connect on a quiet system. Comments
    // (lines starting with ':') are ignored by EventSource. The periodic ping doubles as a keep-alive
    // that stops reverse proxies from idle-closing the stream.
    await stream.write(': connected\n\n');
    while (!c.req.raw.signal.aborted) {
      await stream.sleep(30000);
      if (c.req.raw.signal.aborted) break;
      await stream.write(': ping\n\n');
    }
  }));
}
