import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { openDb } from '../../src/store/db.js';
import { TaskStore } from '../../src/store/taskStore.js';
import { ProjectStore } from '../../src/store/projectStore.js';
import { ConfigStore } from '../../src/store/configStore.js';
import { MissionStore } from '../../src/store/missionStore.js';
import { MissionPrStore } from '../../src/store/missionPrStore.js';
import { MissionGit } from '../../src/overseer/missionGit.js';
import { sweepPrFeedback } from '../../src/overseer/prFeedback.js';

let base: string, repo: string, binDir: string, origPath: string | undefined;
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
const fakeGh = (script: string) => { const p = join(binDir, 'gh'); writeFileSync(p, `#!/usr/bin/env bash\n${script}\n`); chmodSync(p, 0o755); };

// gh stub that returns a single CHANGES_REQUESTED review submitted at `ts`, with PR state OPEN.
const ghChangesRequested = (ts: string) => fakeGh(`
if [ "$2" = "view" ]; then
  echo '{"state":"OPEN","reviews":[{"state":"CHANGES_REQUESTED","body":"please rename the function","submittedAt":"${ts}","author":{"login":"alice"}}],"comments":[]}'
fi`);

async function build() {
  const db = openDb(':memory:');
  const projects = new ProjectStore(db);
  const project = projects.create({ slug: 'demo', path: repo });
  const tasks = new TaskStore(db);
  tasks.create({ id: 'epic', project_id: project.id, title: 'E', type: 'epic' });
  tasks.create({ id: 'p1', project_id: project.id, title: 'first phase', parent_id: 'epic' });
  const config = new ConfigStore(db);
  config.update({ autopilot: { prEnabled: true, ghToken: 'tok' } });
  const prs = new MissionPrStore(db);
  const missions = new MissionStore(db);
  missions.create({ id: 'm-epic', epic_id: 'epic', autonomy: 'L3', max_sessions: 1 });
  const missionGit = new MissionGit({ prs, config, projects, tasks });
  await missionGit.onEngage('m-epic', 'epic');
  prs.setPr('m-epic', { number: 12, url: 'https://github.com/o/r/pull/12', state: 'open' }); // simulate an opened PR
  return { missionGit, prs, tasks, missions };
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'orca-fb-'));
  repo = join(base, 'project'); mkdirSync(repo);
  binDir = join(base, 'bin'); mkdirSync(binDir);
  origPath = process.env.PATH; process.env.PATH = `${binDir}:${origPath}`;
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.email', 'test@orca.dev'); git(repo, 'config', 'user.name', 'Orca Test');
  writeFileSync(join(repo, 'README.md'), '# repo\n'); git(repo, 'add', '-A'); git(repo, 'commit', '-q', '-m', 'init');
});
afterEach(() => { process.env.PATH = origPath; rmSync(base, { recursive: true, force: true }); });

describe('PR feedback ingest', () => {
  it('turns a changes-requested review into a fix phase depending on the last phase', async () => {
    ghChangesRequested('2026-06-24T10:00:00Z');
    const { missionGit, tasks } = await build();
    const res = await missionGit.ingestReviews('m-epic');
    expect(res.action).toBe('fix-created');
    const fixId = (res as { taskId: string }).taskId;
    const fix = tasks.get(fixId)!;
    expect(fix.parent_id).toBe('epic');
    expect(fix.description).toContain('please rename the function');
    const deps = tasks.allDeps().filter((e) => e.task_id === fixId).map((e) => e.depends_on_id);
    expect(deps).toContain('p1'); // ordered after the last phase
  });

  it('does not create a second fix phase for the same review (dedup via last_review_ts)', async () => {
    ghChangesRequested('2026-06-24T10:00:00Z');
    const { missionGit, tasks } = await build();
    await missionGit.ingestReviews('m-epic');
    const after = await missionGit.ingestReviews('m-epic'); // same review timestamp
    expect(after.action).toBe('none');
    expect(tasks.list({ project_id: 1 }).filter((t) => t.title === 'Address PR review feedback')).toHaveLength(1);
  });

  it('stops watching when the PR is merged', async () => {
    fakeGh(`if [ "$2" = "view" ]; then echo '{"state":"MERGED","reviews":[],"comments":[]}'; fi`);
    const { missionGit, prs } = await build();
    const res = await missionGit.ingestReviews('m-epic');
    expect(res.action).toBe('closed');
    expect(prs.get('m-epic')!.pr_state).toBe('merged');
    expect(prs.withOpenPr()).toHaveLength(0);
  });

  it('sweepPrFeedback re-engages the mission when a fix phase is created', async () => {
    ghChangesRequested('2026-06-24T10:00:00Z');
    const { missionGit, prs, missions } = await build();
    const engage = vi.fn().mockResolvedValue(undefined);
    const ids = await sweepPrFeedback({ prs, missions, missionGit, engage });
    expect(ids).toEqual(['m-epic']);
    expect(engage).toHaveBeenCalledWith({ epicId: 'epic', autonomy: 'L3', maxSessions: 1 });
  });
});
