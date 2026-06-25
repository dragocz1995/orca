import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../src/store/db.js';
import { TaskStore } from '../../src/store/taskStore.js';
import { Readiness } from '../../src/store/readiness.js';
import { MissionStore } from '../../src/store/missionStore.js';
import { AgentStore } from '../../src/store/agentStore.js';
import { SpawnService } from '../../src/spawn/spawn.js';
import { FakeTmuxDriver } from '../../src/tmux/fakeDriver.js';
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
  const tmux = new FakeTmuxDriver();
  const app = createServer({
    tasks: new TaskStore(db), readiness: new Readiness(db), missions: new MissionStore(db), bus: new EventBus(),
    engine: { disengage: async () => {} } as never, spawn: new SpawnService({ tmux, agents: new AgentStore(db) }), tmux,
    project: { id: 1, path: '/o' }, fallback: { program: 'claude-code', model: 'sonnet' },
    clock: new FakeClock(0), config: new ConfigStore(db),
    users, projects: new ProjectStore(db), userProjects: new UserProjectStore(db),
  });
  return { app, tmux, adminTok: users.issueToken(admin.id), bobTok: users.issueToken(bob.id) };
}
const post = (t: string | null) => ({ method: 'POST', headers: { ...(t ? { authorization: `Bearer ${t}` } : {}), 'content-type': 'application/json' }, body: '{}' });

describe('POST /usage/reset', () => {
  it('forbids a non-admin (403)', async () => {
    const { app, bobTok } = setup();
    expect((await app.request('/usage/reset', post(bobTok))).status).toBe(403);
  });

  it('refuses with 409 while an agent session is live', async () => {
    const { app, tmux, adminTok } = setup();
    tmux.setPane('orca-mission-1', ''); // a live agent → list() reports it
    const res = await app.request('/usage/reset', post(adminTok));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'agents_running', sessions: ['orca-mission-1'] });
  });

  it('clears the stores and returns a summary when no agents are live', async () => {
    const { app, adminTok } = setup();
    // Point HOME at a throwaway dir so the destructive clear never touches the real CLI stores.
    const home = mkdtempSync(join(tmpdir(), 'orca-reset-api-'));
    const claudeFile = join(home, '.claude', 'projects', '-o', 's.jsonl');
    mkdirSync(join(home, '.claude', 'projects', '-o'), { recursive: true });
    writeFileSync(claudeFile, '{"message":{"usage":{"input_tokens":1}}}\n');
    const prevHome = process.env.HOME;
    process.env.HOME = home;
    try {
      const res = await app.request('/usage/reset', post(adminTok));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.cleared.claude).toEqual({ cleared: true, removed: 1 });
      expect(existsSync(claudeFile)).toBe(false);
    } finally {
      if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
      rmSync(home, { recursive: true, force: true });
    }
  });
});
