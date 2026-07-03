import { describe, it, expect, vi } from 'vitest';
import { openDb } from '../../src/store/db.js';
import { TaskStore } from '../../src/store/taskStore.js';
import { Readiness } from '../../src/store/readiness.js';
import { MissionStore } from '../../src/store/missionStore.js';
import { EventBus } from '../../src/api/sse.js';
import { createServer } from '../../src/api/server.js';
import { FakeClock } from '../../src/shared/clock.js';
import { ConfigStore } from '../../src/store/configStore.js';
import { UserStore } from '../../src/store/userStore.js';
import { ProjectStore } from '../../src/store/projectStore.js';
import { UserProjectStore } from '../../src/store/userProjectStore.js';
import { UserPromptStore } from '../../src/store/userPromptStore.js';
import { PromptService } from '../../src/prompts/promptService.js';
import { PersonalityStore } from '../../src/store/personalityStore.js';

function setup() {
  const db = openDb(':memory:');
  db.prepare("INSERT INTO projects (id,slug,path) VALUES (1,'orca','/o')").run();
  const users = new UserStore(db);
  const amy = users.create('amy', 'pw'); // first user → admin
  const bob = users.create('bob', 'pw');
  const config = new ConfigStore(db);
  const personalityStore = new PersonalityStore(db);
  const restart = vi.fn(async () => {});
  const applyPersonalityChange = vi.fn(async () => {});
  const app = createServer({
    tasks: new TaskStore(db), readiness: new Readiness(db), missions: new MissionStore(db), bus: new EventBus(),
    engine: null as never, spawn: null as never, tmux: null as never,
    project: { id: 1, path: '/o' }, fallback: { program: 'claude-code', model: 'sonnet' },
    clock: new FakeClock(0), config, users, projects: new ProjectStore(db), userProjects: new UserProjectStore(db),
    userPrompts: new UserPromptStore(db), prompts: new PromptService(new UserPromptStore(db)),
    personalityStore,
    brain: { restart, applyPersonalityChange } as never,
  });
  // amy is the admin; assign bob to the daemon project so the project gate lets his /personality through.
  const up = new UserProjectStore(db);
  up.assign(bob.id, 1);
  return { app, personalityStore, applyPersonalityChange, users, amyTok: users.issueToken(amy.id), bobTok: users.issueToken(bob.id), bobId: bob.id };
}

const auth = (t: string) => ({ headers: { authorization: `Bearer ${t}` } });
const post = (t: string, body: unknown) => ({ method: 'POST', headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
const patch = (t: string, body: unknown) => ({ method: 'PATCH', headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
const del = (t: string) => ({ method: 'DELETE', headers: { authorization: `Bearer ${t}` } });

describe('personality routes', () => {
  it('create → list → filter by platform', async () => {
    const { app, amyTok } = setup();
    const created = await app.request('/personality/profiles', post(amyTok, { platform: 'discord', name: 'Snarky', prompt: 'Be witty.', tone: 'dry' }));
    expect(created.status).toBe(201);
    const row = await created.json();
    expect(row).toMatchObject({ platform: 'discord', name: 'Snarky', prompt: 'Be witty.', tone: 'dry', enabled: true });
    expect(typeof row.id).toBe('number');
    await app.request('/personality/profiles', post(amyTok, { platform: 'web', name: 'WebVoice', prompt: 'web' }));

    const all = await (await app.request('/personality/profiles', auth(amyTok))).json();
    expect(all).toHaveLength(2);
    const discordOnly = await (await app.request('/personality/profiles?platform=discord', auth(amyTok))).json();
    expect(discordOnly).toHaveLength(1);
    expect(discordOnly[0].name).toBe('Snarky');
  });

  it('PATCH updates only the given fields', async () => {
    const { app, amyTok } = setup();
    const row = await (await app.request('/personality/profiles', post(amyTok, { platform: 'discord', name: 'A', prompt: 'x' }))).json();
    const res = await app.request(`/personality/profiles/${row.id}`, patch(amyTok, { name: 'B', enabled: false }));
    expect(res.status).toBe(200);
    const updated = await res.json();
    expect(updated).toMatchObject({ name: 'B', prompt: 'x', enabled: false });
  });

  it('PATCH cannot change a profile\'s platform (field is stripped)', async () => {
    const { app, amyTok } = setup();
    const row = await (await app.request('/personality/profiles', post(amyTok, { platform: 'discord', name: 'A', prompt: 'x' }))).json();
    const res = await app.request(`/personality/profiles/${row.id}`, patch(amyTok, { platform: 'web', name: 'B' }));
    expect(res.status).toBe(200);
    const updated = await res.json();
    expect(updated).toMatchObject({ name: 'B', platform: 'discord' });
  });

  it('list response marks the active profile per platform', async () => {
    const { app, amyTok } = setup();
    const a = await (await app.request('/personality/profiles', post(amyTok, { platform: 'discord', name: 'A', prompt: 'x' }))).json();
    await app.request('/personality/profiles', post(amyTok, { platform: 'discord', name: 'B', prompt: 'y' }));
    // Before activation nothing is active.
    let list = await (await app.request('/personality/profiles', auth(amyTok))).json();
    expect(list.every((r: { active: boolean }) => r.active === false)).toBe(true);
    // Activate A → the list marks exactly A.
    await app.request(`/personality/profiles/${a.id}/activate`, post(amyTok, {}));
    list = await (await app.request('/personality/profiles', auth(amyTok))).json();
    expect(Object.fromEntries(list.map((r: { name: string; active: boolean }) => [r.name, r.active]))).toEqual({ A: true, B: false });
  });

  it('DELETE removes the profile and clears the active pointer', async () => {
    const { app, personalityStore, amyTok, users } = setup();
    const amyId = users.verify('amy', 'pw')!.id;
    const row = await (await app.request('/personality/profiles', post(amyTok, { platform: 'discord', name: 'A', prompt: 'x' }))).json();
    personalityStore.setActive(amyId, 'discord', row.id);
    expect(personalityStore.getActive(amyId, 'discord')?.id).toBe(row.id);
    const res = await app.request(`/personality/profiles/${row.id}`, del(amyTok));
    expect(await res.json()).toEqual({ ok: true });
    expect(personalityStore.getActive(amyId, 'discord')).toBeUndefined();
    expect(personalityStore.get(amyId, row.id)).toBeUndefined();
  });

  it('activate pins the profile active and triggers the brain respawn hook', async () => {
    const { app, personalityStore, applyPersonalityChange, amyTok, users } = setup();
    const amyId = users.verify('amy', 'pw')!.id;
    const row = await (await app.request('/personality/profiles', post(amyTok, { platform: 'discord', name: 'A', prompt: 'x' }))).json();
    const res = await app.request(`/personality/profiles/${row.id}/activate`, post(amyTok, {}));
    expect(res.status).toBe(200);
    expect(personalityStore.getActive(amyId, 'discord')?.id).toBe(row.id);
    expect(applyPersonalityChange).toHaveBeenCalledTimes(1);
    expect(applyPersonalityChange).toHaveBeenCalledWith(amyId);
  });

  it('activate on a foreign / missing profile is a 404 and does not touch the brain', async () => {
    const { app, applyPersonalityChange, bobTok } = setup();
    const res = await app.request('/personality/profiles/999/activate', post(bobTok, {}));
    expect(res.status).toBe(404);
    expect(applyPersonalityChange).not.toHaveBeenCalled();
  });

  it('ownership boundary — a user cannot read, patch, delete or activate another user\'s profile', async () => {
    const { app, amyTok, bobTok, bobId, personalityStore } = setup();
    // amy creates a profile; bob must not be able to touch it.
    const row = await (await app.request('/personality/profiles', post(amyTok, { platform: 'discord', name: 'Amys', prompt: 'private' }))).json();

    // bob's list never shows amy's row.
    const bobList = await (await app.request('/personality/profiles', auth(bobTok))).json();
    expect(bobList).toEqual([]);

    // PATCH a foreign id → 404, and the row is unchanged.
    expect((await app.request(`/personality/profiles/${row.id}`, patch(bobTok, { name: 'Hijacked' }))).status).toBe(404);

    // activate a foreign id → 404.
    expect((await app.request(`/personality/profiles/${row.id}/activate`, post(bobTok, {}))).status).toBe(404);

    // DELETE a foreign id is a no-op (owner-scoped) — amy still owns her row.
    expect((await app.request(`/personality/profiles/${row.id}`, del(bobTok))).status).toBe(200);
    expect(personalityStore.get(bobId, row.id)).toBeUndefined(); // never bob's
    const amyOwn = personalityStore.list(row.user_id);
    expect(amyOwn.find((p) => p.id === row.id)?.name).toBe('Amys');
  });
});
