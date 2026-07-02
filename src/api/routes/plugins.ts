import { discoverPlugins } from '../../plugins/loader.js';
import { OAUTH_BUILTIN } from '../../brain/providers.js';
import type { OrcaApp, RouteContext } from '../context.js';

/** Admin management of daemon plugins: list what's installed on disk (bundled + user dir) and flip a
 *  plugin on/off. Enabling updates `config.plugins.enabled` and hot-reloads the brain's registry, so the
 *  change applies to chat sessions immediately — no daemon restart. */
export function registerPluginRoutes(app: OrcaApp, ctx: RouteContext): void {
  const { d } = ctx;
  const notAdmin = (c: { get: (k: 'user') => { id: number } | undefined }): boolean => {
    if (!d.users || d.users.count() === 0) return false; // open/single-user mode → no gating
    const u = c.get('user');
    return !u || !d.users.isAdmin(u.id);
  };
  const listing = () => {
    const enabled = new Set(d.config.get().plugins.enabled);
    return discoverPlugins(d.pluginDirs ?? []).map((p) => ({
      name: p.manifest.name,
      version: p.manifest.version,
      description: p.manifest.description,
      provides: p.manifest.provides ?? {},
      source: p.source,
      enabled: enabled.has(p.manifest.name),
      configurable: (p.manifest.configSchema?.length ?? 0) > 0,
    }));
  };
  const manifestOf = (name: string) => discoverPlugins(d.pluginDirs ?? []).find((p) => p.manifest.name === name)?.manifest;

  app.get('/plugins', (c) => {
    if (notAdmin(c)) return c.json({ error: 'forbidden' }, 403);
    return c.json(listing());
  });

  // Detail for the per-plugin settings section: the declared config fields + current values. Secret
  // values never leave the daemon — the UI gets only which secret keys are set.
  app.get('/plugins/:name', (c) => {
    if (notAdmin(c)) return c.json({ error: 'forbidden' }, 403);
    const name = c.req.param('name');
    const manifest = manifestOf(name);
    if (!manifest) return c.json({ error: 'unknown plugin' }, 404);
    const item = listing().find((p) => p.name === name);
    const schema = manifest.configSchema ?? [];
    const stored = d.config.pluginConfig(name);
    const secretKeys = new Set(schema.filter((f) => f.type === 'secret').map((f) => f.key));
    const config: Record<string, unknown> = {};
    for (const f of schema) { if (!secretKeys.has(f.key) && stored[f.key] !== undefined) config[f.key] = stored[f.key]; }
    return c.json({
      ...item,
      configSchema: schema,
      config,
      secretsSet: [...secretKeys].filter((k) => typeof stored[k] === 'string' && stored[k] !== ''),
    });
  });

  // Save a plugin's config values. A secret field arriving empty/absent keeps the stored value (the UI
  // round-trips secrets write-only). Applies live via the brain's plugin hot-reload.
  app.patch('/plugins/:name/config', async (c) => {
    if (notAdmin(c)) return c.json({ error: 'forbidden' }, 403);
    const name = c.req.param('name');
    const manifest = manifestOf(name);
    if (!manifest) return c.json({ error: 'unknown plugin' }, 404);
    const b = (await c.req.json().catch(() => null)) as { values?: Record<string, unknown> } | null;
    if (!b || typeof b.values !== 'object' || b.values === null) return c.json({ error: 'values must be an object' }, 400);
    const schema = manifest.configSchema ?? [];
    const stored = { ...d.config.pluginConfig(name) };
    for (const f of schema) {
      const v = b.values[f.key];
      if (v === undefined) continue;
      if (f.type === 'secret' && (v === '' || v === null)) continue; // keep the stored secret
      stored[f.key] = v;
    }
    d.config.update({ plugins: { config: { [name]: stored as Record<string, never> } } });
    await d.brain?.reloadPlugins();
    return c.json({ ok: true });
  });

  app.patch('/plugins/:name', async (c) => {
    if (notAdmin(c)) return c.json({ error: 'forbidden' }, 403);
    const name = c.req.param('name');
    if (!listing().some((p) => p.name === name)) return c.json({ error: 'unknown plugin' }, 404);
    const b = (await c.req.json().catch(() => ({}))) as { enabled?: unknown };
    if (typeof b.enabled !== 'boolean') return c.json({ error: 'enabled must be a boolean' }, 400);
    const cur = new Set(d.config.get().plugins.enabled);
    if (b.enabled) cur.add(name); else cur.delete(name);
    d.config.update({ plugins: { enabled: [...cur] } });
    // Apply live: drop the brain's memoized registry and restart running sessions with the new set.
    await d.brain?.reloadPlugins();
    return c.json(listing().find((p) => p.name === name));
  });

  // ── Brain provider OAuth (admin): connect an Anthropic / GitHub Copilot / OpenAI account. ──
  // The UI starts a flow, shows authUrl (+ userCode for device flows), polls status, and posts the
  // pasted code when the flow asks for input. Tokens persist in the brain's AuthStorage.
  const oauthProviderOf = (type: string): string | undefined => OAUTH_BUILTIN[type];

  app.get('/brain/oauth/status', (c) => {
    if (notAdmin(c)) return c.json({ error: 'forbidden' }, 403);
    if (!d.brainOauth) return c.json({});
    const out: Record<string, boolean> = {};
    for (const [type, builtin] of Object.entries(OAUTH_BUILTIN)) out[type] = d.brainOauth.connected(builtin);
    return c.json(out);
  });

  app.post('/brain/oauth/:type/start', (c) => {
    if (notAdmin(c)) return c.json({ error: 'forbidden' }, 403);
    if (!d.brainOauth) return c.json({ error: 'oauth unavailable' }, 503);
    const builtin = oauthProviderOf(c.req.param('type'));
    if (!builtin) return c.json({ error: 'unknown oauth provider' }, 404);
    return c.json(d.brainOauth.start(builtin), 201);
  });

  app.get('/brain/oauth/flow/:id', (c) => {
    if (notAdmin(c)) return c.json({ error: 'forbidden' }, 403);
    const flow = d.brainOauth?.get(c.req.param('id'));
    return flow ? c.json(flow) : c.json({ error: 'unknown flow' }, 404);
  });

  app.post('/brain/oauth/flow/:id/input', async (c) => {
    if (notAdmin(c)) return c.json({ error: 'forbidden' }, 403);
    const b = (await c.req.json().catch(() => ({}))) as { value?: unknown };
    if (typeof b.value !== 'string' || !b.value.trim()) return c.json({ error: 'value must be a non-empty string' }, 400);
    if (!d.brainOauth?.submitInput(c.req.param('id'), b.value.trim())) return c.json({ error: 'flow is not waiting for input' }, 409);
    return c.json({ ok: true });
  });

  app.delete('/brain/oauth/:type', (c) => {
    if (notAdmin(c)) return c.json({ error: 'forbidden' }, 403);
    if (!d.brainOauth) return c.json({ error: 'oauth unavailable' }, 503);
    const builtin = oauthProviderOf(c.req.param('type'));
    if (!builtin) return c.json({ error: 'unknown oauth provider' }, 404);
    d.brainOauth.disconnect(builtin);
    return c.json({ ok: true });
  });
}
