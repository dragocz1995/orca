import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

const skillMd = (name: string, description: string) => `---\nname: ${name}\ndescription: ${description}\n---\n\nBody of ${name}.\n`;

function setup() {
  const dataRoot = mkdtempSync(join(tmpdir(), 'orca-skills-data-'));
  // A plugin scan root shaped like the real one: <root>/skills is the plugin folder, its bundled
  // .md skills live one level deeper in <root>/skills/skills.
  const pluginsRoot = mkdtempSync(join(tmpdir(), 'orca-skills-plugins-'));
  const bundledDir = join(pluginsRoot, 'skills', 'skills');
  mkdirSync(bundledDir, { recursive: true });
  writeFileSync(join(bundledDir, 'greeting.md'), skillMd('greeting', 'How to greet.'));
  const db = openDb(':memory:');
  db.prepare("INSERT INTO projects (id,slug,path) VALUES (1,'orca','/o')").run();
  const users = new UserStore(db);
  const admin = users.create('admin', 'pw');
  const amy = users.create('amy', 'pw');
  const app = createServer({
    tasks: new TaskStore(db), readiness: new Readiness(db), missions: new MissionStore(db), bus: new EventBus(),
    engine: null as never, spawn: null as never, tmux: null as never,
    project: { id: 1, path: '/o' }, fallback: { program: 'claude-code', model: 'sonnet' },
    clock: new FakeClock(0), config: new ConfigStore(db), users, projects: new ProjectStore(db), userProjects: new UserProjectStore(db),
    pluginDirs: [pluginsRoot], pluginDataRoot: dataRoot,
  });
  return { app, userDir: join(dataRoot, 'skills'), adminTok: users.issueToken(admin.id), amyTok: users.issueToken(amy.id) };
}
const auth = (t: string) => ({ headers: { authorization: `Bearer ${t}` } });
const post = (t: string, body: unknown) => ({ method: 'POST', headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
const del = (t: string) => ({ method: 'DELETE', headers: { authorization: `Bearer ${t}` } });

const skill = (extra: Record<string, unknown> = {}) => ({ name: 'deploy-checklist', description: 'When deploying.', content: 'Check twice.', ...extra });

describe('skills routes', () => {
  it('GET /plugins/skills/list returns bundled + user skills with parsed descriptions', async () => {
    const { app, userDir, adminTok } = setup();
    mkdirSync(userDir, { recursive: true });
    writeFileSync(join(userDir, 'my-skill.md'), skillMd('my-skill', 'A user skill.'));
    const res = await app.request('/plugins/skills/list', auth(adminTok));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      { name: 'greeting', description: 'How to greet.', source: 'bundled' },
      { name: 'my-skill', description: 'A user skill.', source: 'user' },
    ]);
  });

  it('GET lists bundled skills even when the user dir does not exist yet', async () => {
    const { app, adminTok } = setup();
    const res = await app.request('/plugins/skills/list', auth(adminTok));
    expect(await res.json()).toEqual([{ name: 'greeting', description: 'How to greet.', source: 'bundled' }]);
  });

  it('POST creates the user skill file in the create_skill format and GET lists it', async () => {
    const { app, userDir, adminTok } = setup();
    const res = await app.request('/plugins/skills', post(adminTok, skill()));
    expect(res.status).toBe(201);
    expect(readFileSync(join(userDir, 'deploy-checklist.md'), 'utf-8'))
      .toBe('---\nname: deploy-checklist\ndescription: When deploying.\n---\n\nCheck twice.\n');
    const list = (await (await app.request('/plugins/skills/list', auth(adminTok))).json()) as { name: string; source: string }[];
    expect(list).toContainEqual({ name: 'deploy-checklist', description: 'When deploying.', source: 'user' });
  });

  it('POST flattens newlines in the description (frontmatter stays one line)', async () => {
    const { app, userDir, adminTok } = setup();
    await app.request('/plugins/skills', post(adminTok, skill({ description: 'line one\nline two' })));
    expect(readFileSync(join(userDir, 'deploy-checklist.md'), 'utf-8')).toContain('description: line one line two\n');
  });

  it('POST rejects a bad name, empty description/content and a non-JSON body (400)', async () => {
    const { app, adminTok } = setup();
    for (const bad of [skill({ name: 'Bad Name' }), skill({ name: 'x' }), skill({ description: '' }), skill({ content: '  ' }), skill({ content: undefined })]) {
      expect((await app.request('/plugins/skills', post(adminTok, bad))).status, JSON.stringify(bad)).toBe(400);
    }
    const raw = await app.request('/plugins/skills', { method: 'POST', headers: { authorization: `Bearer ${adminTok}`, 'content-type': 'application/json' }, body: '{not json' });
    expect(raw.status).toBe(400);
  });

  it('POST refuses a name colliding with a bundled skill (400) but overwrites a user skill', async () => {
    const { app, adminTok } = setup();
    expect((await app.request('/plugins/skills', post(adminTok, skill({ name: 'greeting' })))).status).toBe(400);
    expect((await app.request('/plugins/skills', post(adminTok, skill()))).status).toBe(201);
    expect((await app.request('/plugins/skills', post(adminTok, skill({ content: 'v2' })))).status).toBe(201);
  });

  it('DELETE removes a user skill; bundled → 400, missing → 404, bad name → 400', async () => {
    const { app, userDir, adminTok } = setup();
    await app.request('/plugins/skills', post(adminTok, skill()));
    expect((await app.request('/plugins/skills/greeting', del(adminTok))).status).toBe(400);
    expect((await app.request('/plugins/skills/nope', del(adminTok))).status).toBe(404);
    expect((await app.request('/plugins/skills/Bad%20Name', del(adminTok))).status).toBe(400);
    const res = await app.request('/plugins/skills/deploy-checklist', del(adminTok));
    expect(res.status).toBe(200);
    expect(existsSync(join(userDir, 'deploy-checklist.md'))).toBe(false);
  });

  it('rejects a non-admin (403) on list, create and delete', async () => {
    const { app, amyTok } = setup();
    expect((await app.request('/plugins/skills/list', auth(amyTok))).status).toBe(403);
    expect((await app.request('/plugins/skills', post(amyTok, skill()))).status).toBe(403);
    expect((await app.request('/plugins/skills/x', del(amyTok))).status).toBe(403);
  });
});
