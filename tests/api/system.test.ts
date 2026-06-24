import { describe, it, expect } from 'vitest';
import { openDb } from '../../src/store/db.js';
import { TaskStore } from '../../src/store/taskStore.js';
import { Readiness } from '../../src/store/readiness.js';
import { MissionStore } from '../../src/store/missionStore.js';
import { ProjectStore } from '../../src/store/projectStore.js';
import { EventBus } from '../../src/api/sse.js';
import { createServer } from '../../src/api/server.js';
import { FakeClock } from '../../src/shared/clock.js';
import { ConfigStore } from '../../src/store/configStore.js';

function makeApp(over: { latestVersion?: () => Promise<string | null>; startUpdate?: () => void; autoUpdate?: boolean } = {}) {
  const db = openDb(':memory:'); db.prepare("INSERT INTO projects (id,slug,path) VALUES (1,'orca','/o')").run();
  const config = new ConfigStore(db);
  if (over.autoUpdate) config.update({ autoUpdate: true });
  const missions = new MissionStore(db);
  const app = createServer({
    tasks: new TaskStore(db), readiness: new Readiness(db), missions,
    bus: new EventBus(), engine: null as any, spawn: null as any, tmux: null as any,
    project: { id: 1, path: '/o' }, fallback: { program: 'claude-code', model: 'sonnet' },
    clock: new FakeClock(0), config, projects: new ProjectStore(db), git: null as any,
    latestVersion: over.latestVersion, startUpdate: over.startUpdate,
  });
  return { app, missions };
}

describe('GET /system', () => {
  it('reports an available update when npm has a newer version', async () => {
    const { app } = makeApp({ latestVersion: async () => '99.0.0' });
    const body = await (await app.request('/system')).json();
    expect(body.latest).toBe('99.0.0');
    expect(body.updateAvailable).toBe(true);
    expect(typeof body.version).toBe('string');
    expect(body.autoUpdate).toBe(false);
  });
  it('reports no update when the latest is not newer than the running version', async () => {
    const { app } = makeApp({ latestVersion: async () => '0.0.1' });
    const body = await (await app.request('/system')).json();
    expect(body.updateAvailable).toBe(false);
  });
  it('degrades to no-update when the registry is unreachable (latest null)', async () => {
    const { app } = makeApp({ latestVersion: async () => null });
    const body = await (await app.request('/system')).json();
    expect(body.latest).toBeNull();
    expect(body.updateAvailable).toBe(false);
  });
  it('surfaces the auto-update opt-in', async () => {
    const { app } = makeApp({ latestVersion: async () => null, autoUpdate: true });
    expect((await (await app.request('/system')).json()).autoUpdate).toBe(true);
  });
});

describe('POST /system/update', () => {
  it('starts the update when idle', async () => {
    let started = false;
    const { app } = makeApp({ startUpdate: () => { started = true; } });
    const res = await app.request('/system/update', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ started: true });
    expect(started).toBe(true);
  });
  it('refuses with 409 while a mission is live, without starting an update', async () => {
    let started = false;
    const { app, missions } = makeApp({ startUpdate: () => { started = true; } });
    missions.create({ id: 'm-e1', epic_id: 'e1', autonomy: 'L3', max_sessions: 1 });
    const res = await app.request('/system/update', { method: 'POST' });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'mission_running' });
    expect(started).toBe(false);
  });
});
