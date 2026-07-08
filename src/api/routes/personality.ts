import { parseBody } from '../validation.js';
import { personalityCreateSchema, personalityPatchSchema } from '../schemas/personality.js';
import type { ElowenApp, RouteContext } from '../context.js';

/** Per-user personality profiles: named prompt bodies a user pins active per platform. Self-service —
 *  identity is ALWAYS the caller (`c.get('user')`), never a body/param field, so a user can only read or
 *  mutate their own profiles (the store is user_id-scoped and no-ops on a foreign id). Agent-scoped
 *  tokens never reach here (the middleware allow-list omits `/personality`). Degrades to 400 when the
 *  store isn't wired. */
export function registerPersonalityRoutes(app: ElowenApp, ctx: RouteContext): void {
  const { d } = ctx;
  const store = d.personalityStore;

  // List the caller's profiles, optionally narrowed to one platform (?platform=discord).
  app.get('/personality/profiles', (c) => {
    if (!store) return c.json({ error: 'personality unavailable' }, 400);
    const platform = c.req.query('platform');
    return c.json(store.list(c.get('user').id, platform || undefined));
  });

  // Create a profile for the caller.
  app.post('/personality/profiles', async (c) => {
    if (!store) return c.json({ error: 'personality unavailable' }, 400);
    const b = await parseBody(c, personalityCreateSchema);
    return c.json(store.create(c.get('user').id, b), 201);
  });

  // Partial update. The store scopes to the owner, so a patch aimed at a foreign id matches nothing and
  // returns undefined → 404 (the ownership boundary).
  app.patch('/personality/profiles/:id', async (c) => {
    if (!store) return c.json({ error: 'personality unavailable' }, 400);
    const b = await parseBody(c, personalityPatchSchema);
    const updated = store.update(c.get('user').id, Number(c.req.param('id')), b);
    if (!updated) return c.json({ error: 'not found' }, 404);
    return c.json(updated);
  });

  // Delete a profile (also clears any active pointer to it). Owner-scoped no-op on a foreign id.
  app.delete('/personality/profiles/:id', (c) => {
    if (!store) return c.json({ error: 'personality unavailable' }, 400);
    store.remove(c.get('user').id, Number(c.req.param('id')));
    return c.json({ ok: true });
  });

  // Pin a profile active for its own platform, then apply it to live sessions: the caller's owner-chat
  // session restarts and channel sessions are dropped so a Discord room respawns on the owner's fresh
  // 'discord' persona (handled by the brain hook). The profile's OWN platform is used — never a
  // body/param value — so the active pointer can never be set for a platform the profile isn't on.
  app.post('/personality/profiles/:id/activate', async (c) => {
    if (!store) return c.json({ error: 'personality unavailable' }, 400);
    const userId = c.get('user').id;
    const profile = store.get(userId, Number(c.req.param('id')));
    if (!profile) return c.json({ error: 'not found' }, 404);
    store.setActive(userId, profile.platform, profile.id);
    await d.brain?.applyPersonalityChange(userId);
    return c.json(profile);
  });
}
