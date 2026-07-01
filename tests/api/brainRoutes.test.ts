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

function fakeBrain() {
  const started = new Set<number>();
  return {
    status: (id: number) => ({ running: started.has(id), sessionId: started.has(id) ? `brain-${id}` : null, model: 'm' }),
    start: async (id: number) => { started.add(id); return { sessionId: `brain-${id}` }; },
    send: async (id: number, _text: string) => { if (!started.has(id)) throw new Error('brain not started for user'); },
    subscribe: () => () => {},
    stop: (id: number) => { started.delete(id); },
  };
}

function setup() {
  const db = openDb(':memory:');
  db.prepare("INSERT INTO projects (id,slug,path) VALUES (1,'orca','/o')").run();
  const users = new UserStore(db);
  users.create('admin', 'pw');
  const amy = users.create('amy', 'pw');
  const config = new ConfigStore(db);
  const app = createServer({
    tasks: new TaskStore(db), readiness: new Readiness(db), missions: new MissionStore(db), bus: new EventBus(),
    engine: null as never, spawn: null as never, tmux: null as never,
    project: { id: 1, path: '/o' }, fallback: { program: 'claude-code', model: 'sonnet' },
    clock: new FakeClock(0), config, users, projects: new ProjectStore(db), userProjects: new UserProjectStore(db),
    brain: fakeBrain() as never,
  });
  return { app, amyTok: users.issueToken(amy.id), agentTok: users.issueToken(amy.id, 'agent') };
}
const auth = (t: string) => ({ headers: { authorization: `Bearer ${t}` } });
const post = (t: string, body: unknown) => ({ method: 'POST', headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('brain routes', () => {
  it('status → start → send happy path', async () => {
    const { app, amyTok } = setup();
    expect((await (await app.request('/brain/status', auth(amyTok))).json() as { running: boolean }).running).toBe(false);
    const start = await app.request('/brain/start', post(amyTok, {}));
    expect(start.status).toBe(201);
    expect((await start.json() as { sessionId: string }).sessionId).toBe('brain-2');
    expect((await (await app.request('/brain/status', auth(amyTok))).json() as { running: boolean }).running).toBe(true);
    expect((await app.request('/brain/send', post(amyTok, { text: 'hi' }))).status).toBe(200);
  });

  it('send before start returns 409', async () => {
    const { app, amyTok } = setup();
    expect((await app.request('/brain/send', post(amyTok, { text: 'hi' }))).status).toBe(409);
  });

  it('send requires the text field (400)', async () => {
    const { app, amyTok } = setup();
    await app.request('/brain/start', post(amyTok, {}));
    expect((await app.request('/brain/send', post(amyTok, {}))).status).toBe(400);
  });

  it('an agent-scoped token cannot use brain routes', async () => {
    const { app, agentTok } = setup();
    expect((await app.request('/brain/status', auth(agentTok))).status).toBe(403);
    expect((await app.request('/brain/start', post(agentTok, {}))).status).toBe(403);
    expect((await app.request('/brain/send', post(agentTok, { text: 'x' }))).status).toBe(403);
  });
});
