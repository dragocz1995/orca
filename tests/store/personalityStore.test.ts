import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from '../../src/store/db.js';
import { PersonalityStore } from '../../src/store/personalityStore.js';

describe('PersonalityStore', () => {
  let s: PersonalityStore;
  beforeEach(() => { s = new PersonalityStore(openDb(':memory:')); });

  it('create + get roundtrip returns the full row with boolean enabled and defaults', () => {
    const created = s.create(1, { platform: 'discord', name: 'friendly', prompt: 'be nice' });
    expect(created).toMatchObject({
      user_id: 1, platform: 'discord', name: 'friendly', prompt: 'be nice',
      description: '', tone: '', style: '', enabled: true,
    });
    expect(created.id).toBeGreaterThan(0);
    expect(created.created_at).toBeTruthy();
    expect(s.get(1, created.id)).toEqual(created);
  });

  it('create honors enabled:false and optional fields', () => {
    const p = s.create(1, { platform: 'web', name: 'x', prompt: 'p', description: 'd', tone: 't', style: 'st', enabled: false });
    expect(p).toMatchObject({ description: 'd', tone: 't', style: 'st', enabled: false });
  });

  it('list filters by platform and orders by platform, name', () => {
    s.create(1, { platform: 'web', name: 'zeta', prompt: 'p' });
    s.create(1, { platform: 'discord', name: 'beta', prompt: 'p' });
    s.create(1, { platform: 'web', name: 'alpha', prompt: 'p' });
    expect(s.list(1).map((r) => `${r.platform}/${r.name}`)).toEqual(['discord/beta', 'web/alpha', 'web/zeta']);
    expect(s.list(1, 'web').map((r) => r.name)).toEqual(['alpha', 'zeta']);
    expect(s.list(1, 'nope')).toEqual([]);
  });

  it('enforces UNIQUE(user, platform, name); same name allowed on another platform or user', () => {
    s.create(1, { platform: 'discord', name: 'dup', prompt: 'p' });
    expect(() => s.create(1, { platform: 'discord', name: 'dup', prompt: 'q' })).toThrow();
    expect(() => s.create(1, { platform: 'web', name: 'dup', prompt: 'q' })).not.toThrow();
    expect(() => s.create(2, { platform: 'discord', name: 'dup', prompt: 'q' })).not.toThrow();
  });

  it('update applies a partial patch and bumps updated_at', async () => {
    const p = s.create(1, { platform: 'web', name: 'n', prompt: 'orig', tone: 'warm' });
    // Force a later wall-clock second so datetime('now') differs.
    s['db'].prepare(`UPDATE personality_profiles SET updated_at = datetime('now','-5 seconds') WHERE id = ?`).run(p.id);
    const updated = s.update(1, p.id, { prompt: 'new' });
    expect(updated).toMatchObject({ prompt: 'new', tone: 'warm', name: 'n' });
    expect(updated!.updated_at > p.created_at || updated!.updated_at >= p.updated_at).toBe(true);
    expect(s.get(1, p.id)!.prompt).toBe('new');
  });

  it('update returns undefined for a missing id', () => {
    expect(s.update(1, 999, { prompt: 'x' })).toBeUndefined();
  });

  it('setActive + getActive returns the active profile, only when enabled', () => {
    const p = s.create(1, { platform: 'discord', name: 'a', prompt: 'p' });
    expect(s.getActive(1, 'discord')).toBeUndefined();
    s.setActive(1, 'discord', p.id);
    expect(s.getActive(1, 'discord')!.id).toBe(p.id);
    // Disable it → active pointer stays but getActive hides it.
    s.update(1, p.id, { enabled: false });
    expect(s.getActive(1, 'discord')).toBeUndefined();
  });

  it('getActive ignores a stale active pointer whose platform no longer matches the profile', () => {
    // Defensive join guard: even if an active row and its target profile drift apart on platform,
    // getActive must never resolve a cross-platform profile.
    const p = s.create(1, { platform: 'web', name: 'a', prompt: 'p' });
    s['db'].prepare('INSERT INTO personality_active_profiles (user_id, platform, profile_id) VALUES (?, ?, ?)')
      .run(1, 'discord', p.id); // stale pointer: 'discord' slot pointing at a 'web' profile
    expect(s.getActive(1, 'discord')).toBeUndefined();
  });

  it('list marks the active profile per platform, derived from getActive (respects enabled)', () => {
    const alpha = s.create(1, { platform: 'web', name: 'alpha', prompt: 'p' });
    const zeta = s.create(1, { platform: 'web', name: 'zeta', prompt: 'p' });
    const beta = s.create(1, { platform: 'discord', name: 'beta', prompt: 'p' });
    void alpha;
    // Nothing pinned yet → no row is active.
    expect(s.list(1).every((r) => r.active === false)).toBe(true);
    s.setActive(1, 'web', zeta.id);
    s.setActive(1, 'discord', beta.id);
    const marked = Object.fromEntries(s.list(1).map((r) => [`${r.platform}/${r.name}`, r.active]));
    expect(marked).toEqual({ 'discord/beta': true, 'web/alpha': false, 'web/zeta': true });
    // A pinned-but-disabled profile is not marked active (getActive hides it).
    s.update(1, zeta.id, { enabled: false });
    expect(s.list(1, 'web').find((r) => r.name === 'zeta')!.active).toBe(false);
  });

  it('setActive throws for a foreign or platform-mismatched profile', () => {
    const p = s.create(1, { platform: 'web', name: 'a', prompt: 'p' });
    expect(() => s.setActive(1, 'discord', p.id)).toThrow();
    const other = s.create(2, { platform: 'web', name: 'a', prompt: 'p' });
    expect(() => s.setActive(1, 'web', other.id)).toThrow();
  });

  it('clearActive unpins the active profile', () => {
    const p = s.create(1, { platform: 'web', name: 'a', prompt: 'p' });
    s.setActive(1, 'web', p.id);
    s.clearActive(1, 'web');
    expect(s.getActive(1, 'web')).toBeUndefined();
  });

  it('remove deletes the profile and clears any active pointer to it', () => {
    const p = s.create(1, { platform: 'web', name: 'a', prompt: 'p' });
    s.setActive(1, 'web', p.id);
    s.remove(1, p.id);
    expect(s.get(1, p.id)).toBeUndefined();
    expect(s.getActive(1, 'web')).toBeUndefined();
  });

  it('removeForUser wipes both profiles and active rows for that user only', () => {
    const a = s.create(1, { platform: 'web', name: 'a', prompt: 'p' });
    s.setActive(1, 'web', a.id);
    const b = s.create(2, { platform: 'web', name: 'a', prompt: 'p' });
    s.setActive(2, 'web', b.id);
    s.removeForUser(1);
    expect(s.list(1)).toEqual([]);
    expect(s.getActive(1, 'web')).toBeUndefined();
    // User 2 untouched.
    expect(s.list(2)).toHaveLength(1);
    expect(s.getActive(2, 'web')!.id).toBe(b.id);
  });

  it('isolates users: B cannot get/update/remove A\'s profile', () => {
    const a = s.create(1, { platform: 'web', name: 'secret', prompt: 'p' });
    expect(s.get(2, a.id)).toBeUndefined();
    expect(s.update(2, a.id, { prompt: 'hacked' })).toBeUndefined();
    s.remove(2, a.id);
    // A's profile survives B's attempts, unchanged.
    expect(s.get(1, a.id)).toMatchObject({ prompt: 'p' });
  });
});
