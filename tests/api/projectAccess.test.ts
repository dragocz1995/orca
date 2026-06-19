import { describe, it, expect } from 'vitest';
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

function setup() {
  const db = openDb(':memory:');
  db.prepare("INSERT INTO projects (id,slug,path) VALUES (1,'orca','/o')").run();
  const users = new UserStore(db);
  const admin = users.create('admin', 'pw'); // first user → is_admin
  const bob = users.create('bob', 'pw');
  const adminTok = users.issueToken(admin.id);
  const bobTok = users.issueToken(bob.id);
  const app = createServer({
    tasks: new TaskStore(db), readiness: new Readiness(db), missions: new MissionStore(db), bus: new EventBus(),
    engine: null as never, spawn: null as never, tmux: null as never,
    project: { id: 1, path: '/o' }, fallback: { program: 'claude-code', model: 'sonnet' },
    clock: new FakeClock(0), config: new ConfigStore(db),
    users, projects: new ProjectStore(db), userProjects: new UserProjectStore(db),
  });
  return { app, adminTok, bobTok, bob };
}
const auth = (t: string) => ({ headers: { authorization: `Bearer ${t}` } });
const post = (t: string, body: unknown) => ({ method: 'POST', headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('project access gating', () => {
  it('admin sees all projects; an unassigned non-admin sees none', async () => {
    const { app, adminTok, bobTok } = setup();
    expect(((await (await app.request('/projects', auth(adminTok))).json()) as unknown[]).length).toBe(1);
    expect(((await (await app.request('/projects', auth(bobTok))).json()) as unknown[]).length).toBe(0);
  });

  it('non-admin is 403 on the editor + task surface until the admin assigns them', async () => {
    const { app, adminTok, bobTok, bob } = setup();
    expect((await app.request('/projects/1/files', auth(bobTok))).status).toBe(403);
    expect((await app.request('/tasks', auth(bobTok))).status).toBe(403);
    expect((await app.request('/missions', auth(bobTok))).status).toBe(403);

    expect((await app.request(`/users/${bob.id}/projects`, post(adminTok, { projectId: 1 }))).status).toBe(200);

    expect((await app.request('/projects/1/files', auth(bobTok))).status).toBe(200);
    expect((await app.request('/tasks', auth(bobTok))).status).toBe(200);
  });

  it('a non-admin cannot manage assignments or create projects (no privilege escalation)', async () => {
    const { app, bobTok, bob } = setup();
    expect((await app.request(`/users/${bob.id}/projects`, post(bobTok, { projectId: 1 }))).status).toBe(403);
    expect((await app.request('/projects', post(bobTok, { slug: 'x', path: '/x' }))).status).toBe(403);
  });

  it('the admin passes everywhere', async () => {
    const { app, adminTok } = setup();
    expect((await app.request('/projects/1/files', auth(adminTok))).status).toBe(200);
    expect((await app.request('/tasks', auth(adminTok))).status).toBe(200);
  });

  it('also gates the activity log and the live event stream (no cross-tenant leak)', async () => {
    const { app, adminTok, bobTok } = setup();
    expect((await app.request('/activity', auth(bobTok))).status).toBe(403);
    expect((await app.request('/events', auth(bobTok))).status).toBe(403); // 403 before the SSE stream opens
    expect((await app.request('/activity', auth(adminTok))).status).toBe(200);
  });

  it('refuses to delete the admin user (no adminless lockout / silent re-election)', async () => {
    const { app, adminTok } = setup();
    expect((await app.request('/users/1', { method: 'DELETE', headers: { authorization: `Bearer ${adminTok}` } })).status).toBe(400);
  });
});
