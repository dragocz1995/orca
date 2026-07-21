import { describe, it, expect } from 'vitest';
import { SpawnService } from '../../src/spawn/spawn.js';
import { FakeTmuxDriver } from '../../src/tmux/fakeDriver.js';
import { openDb } from '../../src/store/db.js';
import { AgentStore } from '../../src/store/agentStore.js';

describe('SpawnService', () => {
  it('registers the agent and spawns an elowen- session', async () => {
    const db = openDb(':memory:'); db.prepare("INSERT INTO projects (id,slug,path) VALUES (1,'elowen','/o')").run();
    const agents = new AgentStore(db); const tmux = new FakeTmuxDriver();
    const svc = new SpawnService({ tmux, agents });
    const { session } = await svc.launch({ projectId: 1, projectPath: '/o', taskId: 'elowen-1', agentName: 'SwiftLake', spec: { program: 'opencode', model: 'ollama-cloud/deepseek-v4-flash' } });
    expect(session).toBe('elowen-SwiftLake');
    expect(await tmux.list()).toContain('elowen-SwiftLake');
    expect(agents.programFor('SwiftLake')).toBe('opencode');
  });

  it('delivers ELOWEN_URL/TOKEN/TASK as tmux session env, never as an `export` in the pane command', async () => {
    const db = openDb(':memory:'); db.prepare("INSERT INTO projects (id,slug,path) VALUES (1,'elowen','/o')").run();
    const agents = new AgentStore(db); const tmux = new FakeTmuxDriver();
    const svc = new SpawnService({ tmux, agents, elowen: { cli: 'elowen', url: 'http://localhost:4400', token: 's3cr3t-tok' } });
    await svc.launch({ projectId: 1, projectPath: '/o', taskId: 'elowen-7', agentName: 'Nova', spec: { program: 'opencode', model: 'm' } });
    // Env reaches the process out-of-band (tmux -e), so the worker can run `elowen ask`/`close`…
    expect(tmux.spawnEnvFor('elowen-Nova')).toMatchObject({ ELOWEN_URL: 'http://localhost:4400', ELOWEN_TOKEN: 's3cr3t-tok', ELOWEN_TASK: 'elowen-7' });
    // …but the token (and any env) is NEVER typed into the pane, where capturePane could surface it (N1).
    expect(tmux.commandFor('elowen-Nova')).not.toContain('export ELOWEN_');
    expect(tmux.commandFor('elowen-Nova')).not.toContain('s3cr3t-tok');
  });

  it('merges caller extraEnv into the tmux session env (reasoning agents: ELOWEN_PLAN_JOB etc.)', async () => {
    const db = openDb(':memory:'); db.prepare("INSERT INTO projects (id,slug,path) VALUES (1,'elowen','/o')").run();
    const agents = new AgentStore(db); const tmux = new FakeTmuxDriver();
    const svc = new SpawnService({ tmux, agents, elowen: { cli: 'elowen', url: 'http://x', token: 'tok' } });
    await svc.launch({ projectId: 1, projectPath: '/o', taskId: 'pj-1', agentName: 'Pilot', spec: { program: 'claude-code', model: 'opus' }, rawPrompt: 'PLAN', extraEnv: { ELOWEN_PLAN_JOB: 'pj-1' } });
    expect(tmux.spawnEnvFor('elowen-Pilot')?.ELOWEN_PLAN_JOB).toBe('pj-1');
  });

  it('scrubs the token from a tmux spawn failure and re-throws a sanitized error', async () => {
    const db = openDb(':memory:'); db.prepare("INSERT INTO projects (id,slug,path) VALUES (1,'elowen','/o')").run();
    const agents = new AgentStore(db); const tmux = new FakeTmuxDriver();
    tmux.failSpawn = true; // a real tmux failure embeds `-e ELOWEN_TOKEN=<token>` in its error message
    const svc = new SpawnService({ tmux, agents, elowen: { cli: 'elowen', url: 'http://x', token: 'sup3r-s3cret' } });
    await expect(svc.launch({ projectId: 1, projectPath: '/o', taskId: 'elowen-1', agentName: 'Nova', spec: { program: 'opencode', model: 'm' } }))
      .rejects.toThrow(/agent spawn failed/);
    await expect(svc.launch({ projectId: 1, projectPath: '/o', taskId: 'elowen-1', agentName: 'Nova', spec: { program: 'opencode', model: 'm' } }))
      .rejects.not.toThrow(/sup3r-s3cret/); // the raw token never rides out in the thrown error
  });

  it('applies the provider resolver binary + args to the spawned command', async () => {
    const db = openDb(':memory:'); db.prepare("INSERT INTO projects (id,slug,path) VALUES (1,'elowen','/o')").run();
    const agents = new AgentStore(db); const tmux = new FakeTmuxDriver();
    const svc = new SpawnService({ tmux, agents, providers: (program) => program === 'opencode' ? { bin: '/usr/bin/oc', args: '--pure' } : undefined });
    await svc.launch({ projectId: 1, projectPath: '/o', taskId: 'elowen-1', agentName: 'Nova', spec: { program: 'opencode', model: 'm' } });
    expect(tmux.commandFor('elowen-Nova')).toContain("/usr/bin/oc --model 'm' --pure --prompt");
  });

  it('resumes the prior session when its program matches the spawn', async () => {
    const db = openDb(':memory:'); db.prepare("INSERT INTO projects (id,slug,path) VALUES (1,'elowen','/o')").run();
    const agents = new AgentStore(db); const tmux = new FakeTmuxDriver();
    const svc = new SpawnService({ tmux, agents });
    await svc.launch({ projectId: 1, projectPath: '/o', taskId: 'elowen-1', agentName: 'Nova', spec: { program: 'claude-code', model: 'sonnet' }, resume: { program: 'claude-code', sessionId: 'sess-7' } });
    expect(tmux.commandFor('elowen-Nova')).toContain("--resume 'sess-7'");
  });

  it('ignores a resume whose program no longer matches the task exec (cold start)', async () => {
    const db = openDb(':memory:'); db.prepare("INSERT INTO projects (id,slug,path) VALUES (1,'elowen','/o')").run();
    const agents = new AgentStore(db); const tmux = new FakeTmuxDriver();
    const svc = new SpawnService({ tmux, agents });
    // recorded a claude session, but the operator switched the task's exec to codex since
    await svc.launch({ projectId: 1, projectPath: '/o', taskId: 'elowen-1', agentName: 'Nova', spec: { program: 'codex', model: 'gpt-5.5' }, resume: { program: 'claude-code', sessionId: 'sess-7' } });
    expect(tmux.commandFor('elowen-Nova')).not.toContain('resume');
  });

  it('ignores resume when the provider has it disabled', async () => {
    const db = openDb(':memory:'); db.prepare("INSERT INTO projects (id,slug,path) VALUES (1,'elowen','/o')").run();
    const agents = new AgentStore(db); const tmux = new FakeTmuxDriver();
    const svc = new SpawnService({ tmux, agents, providers: () => ({ resume: false }) });
    await svc.launch({ projectId: 1, projectPath: '/o', taskId: 'elowen-1', agentName: 'Nova', spec: { program: 'claude-code', model: 'sonnet' }, resume: { program: 'claude-code', sessionId: 'sess-7' } });
    expect(tmux.commandFor('elowen-Nova')).not.toContain('--resume');
  });
});

describe('SpawnService elowen seam', () => {
  const mk = () => {
    const db = openDb(':memory:'); db.prepare("INSERT INTO projects (id,slug,path) VALUES (1,'elowen','/o')").run();
    return { agents: new AgentStore(db), tmux: new FakeTmuxDriver() };
  };

  it('routes program elowen to the brain worker — tmux never spawns', async () => {
    const { agents, tmux } = mk();
    const launched: unknown[] = [];
    const svc = new SpawnService({ tmux, agents, brainWorker: { launch: async (i) => { launched.push(i); return { session: `elowen-${i.agentName}` }; } } });
    const res = await svc.launch({ projectId: 1, projectPath: '/o', taskId: 'T-1', agentName: 'a9', spec: { program: 'elowen', model: 'relay/kimi' } });
    expect(res.session).toBe('elowen-a9');
    expect(launched).toHaveLength(1);
    expect(await tmux.list()).toEqual([]);
    expect(agents.programFor('a9')).toBe('elowen');
  });

  it('throws clearly when no brain worker is wired or a rawPrompt caller asks for elowen', async () => {
    const { agents, tmux } = mk();
    await expect(new SpawnService({ tmux, agents }).launch({ projectId: 1, projectPath: '/o', taskId: 't', agentName: 'a', spec: { program: 'elowen', model: 'm' } }))
      .rejects.toThrow(/not available/);
    const withWorker = new SpawnService({ tmux, agents, brainWorker: { launch: async () => ({ session: 's' }) } });
    await expect(withWorker.launch({ projectId: 1, projectPath: '/o', taskId: 't', agentName: 'a', spec: { program: 'elowen', model: 'm' }, rawPrompt: 'PILOT' }))
      .rejects.toThrow(/raw prompt/i);
  });

  it('resolves the global tddMode() resolver into a CLI worker preamble', async () => {
    const { agents, tmux } = mk();
    const svc = new SpawnService({ tmux, agents, tddMode: () => true });
    await svc.launch({ projectId: 1, projectPath: '/o', taskId: 'elowen-1', agentName: 'Nova', spec: { program: 'claude-code', model: 'sonnet' } });
    expect(tmux.commandFor('elowen-Nova')).toContain('Test-Driven Development');
  });

  it('omits the TDD directive when the resolver returns false (default)', async () => {
    const { agents, tmux } = mk();
    const svc = new SpawnService({ tmux, agents, tddMode: () => false });
    await svc.launch({ projectId: 1, projectPath: '/o', taskId: 'elowen-1', agentName: 'Nova', spec: { program: 'claude-code', model: 'sonnet' } });
    expect(tmux.commandFor('elowen-Nova')).not.toContain('Test-Driven Development');
  });

  it('threads the resolved tddMode into the brain worker launch input for an elowen: spec', async () => {
    const { agents, tmux } = mk();
    const launched: { tddMode?: boolean }[] = [];
    const svc = new SpawnService({ tmux, agents, tddMode: () => true, brainWorker: { launch: async (i) => { launched.push(i); return { session: `elowen-${i.agentName}` }; } } });
    await svc.launch({ projectId: 1, projectPath: '/o', taskId: 'T-1', agentName: 'a9', spec: { program: 'elowen', model: 'relay/kimi' } });
    expect(launched[0].tddMode).toBe(true);
  });

  it('lets an explicit per-call tddMode override the global resolver', async () => {
    const { agents, tmux } = mk();
    const svc = new SpawnService({ tmux, agents, tddMode: () => false });
    await svc.launch({ projectId: 1, projectPath: '/o', taskId: 'elowen-1', agentName: 'Nova', spec: { program: 'claude-code', model: 'sonnet' }, tddMode: true });
    expect(tmux.commandFor('elowen-Nova')).toContain('Test-Driven Development');
  });
});
