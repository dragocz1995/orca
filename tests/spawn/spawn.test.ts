import { describe, it, expect } from 'vitest';
import { SpawnService } from '../../src/spawn/spawn.js';
import { FakeTmuxDriver } from '../../src/tmux/fakeDriver.js';
import { openDb } from '../../src/store/db.js';
import { AgentStore } from '../../src/store/agentStore.js';

describe('SpawnService', () => {
  it('registers the agent and spawns an orca- session', async () => {
    const db = openDb(':memory:'); db.prepare("INSERT INTO projects (id,slug,path) VALUES (1,'orca','/o')").run();
    const agents = new AgentStore(db); const tmux = new FakeTmuxDriver();
    const svc = new SpawnService({ tmux, agents });
    const { session } = await svc.launch({ projectId: 1, projectPath: '/o', taskId: 'orca-1', agentName: 'SwiftLake', spec: { program: 'opencode', model: 'ollama-cloud/deepseek-v4-flash' } });
    expect(session).toBe('orca-SwiftLake');
    expect(await tmux.list()).toContain('orca-SwiftLake');
    expect(agents.programFor('SwiftLake')).toBe('opencode');
  });

  it('exports ORCA_TASK so a worker can run `orca ask` without passing its own id', async () => {
    const db = openDb(':memory:'); db.prepare("INSERT INTO projects (id,slug,path) VALUES (1,'orca','/o')").run();
    const agents = new AgentStore(db); const tmux = new FakeTmuxDriver();
    const svc = new SpawnService({ tmux, agents, orca: { cli: 'orca', url: 'http://localhost:4400', token: 'tok' } });
    await svc.launch({ projectId: 1, projectPath: '/o', taskId: 'orca-7', agentName: 'Nova', spec: { program: 'opencode', model: 'm' } });
    expect(tmux.commandFor('orca-Nova')).toContain("export ORCA_TASK='orca-7'");
  });

  it('applies the provider resolver binary + args to the spawned command', async () => {
    const db = openDb(':memory:'); db.prepare("INSERT INTO projects (id,slug,path) VALUES (1,'orca','/o')").run();
    const agents = new AgentStore(db); const tmux = new FakeTmuxDriver();
    const svc = new SpawnService({ tmux, agents, providers: (program) => program === 'opencode' ? { bin: '/usr/bin/oc', args: '--pure' } : undefined });
    await svc.launch({ projectId: 1, projectPath: '/o', taskId: 'orca-1', agentName: 'Nova', spec: { program: 'opencode', model: 'm' } });
    expect(tmux.commandFor('orca-Nova')).toContain("/usr/bin/oc --model 'm' --pure --prompt");
  });

  it('resumes the prior session when its program matches the spawn', async () => {
    const db = openDb(':memory:'); db.prepare("INSERT INTO projects (id,slug,path) VALUES (1,'orca','/o')").run();
    const agents = new AgentStore(db); const tmux = new FakeTmuxDriver();
    const svc = new SpawnService({ tmux, agents });
    await svc.launch({ projectId: 1, projectPath: '/o', taskId: 'orca-1', agentName: 'Nova', spec: { program: 'claude-code', model: 'sonnet' }, resume: { program: 'claude-code', sessionId: 'sess-7' } });
    expect(tmux.commandFor('orca-Nova')).toContain("--resume 'sess-7'");
  });

  it('ignores a resume whose program no longer matches the task exec (cold start)', async () => {
    const db = openDb(':memory:'); db.prepare("INSERT INTO projects (id,slug,path) VALUES (1,'orca','/o')").run();
    const agents = new AgentStore(db); const tmux = new FakeTmuxDriver();
    const svc = new SpawnService({ tmux, agents });
    // recorded a claude session, but the operator switched the task's exec to codex since
    await svc.launch({ projectId: 1, projectPath: '/o', taskId: 'orca-1', agentName: 'Nova', spec: { program: 'codex', model: 'gpt-5.5' }, resume: { program: 'claude-code', sessionId: 'sess-7' } });
    expect(tmux.commandFor('orca-Nova')).not.toContain('resume');
  });

  it('ignores resume when the provider has it disabled', async () => {
    const db = openDb(':memory:'); db.prepare("INSERT INTO projects (id,slug,path) VALUES (1,'orca','/o')").run();
    const agents = new AgentStore(db); const tmux = new FakeTmuxDriver();
    const svc = new SpawnService({ tmux, agents, providers: () => ({ resume: false }) });
    await svc.launch({ projectId: 1, projectPath: '/o', taskId: 'orca-1', agentName: 'Nova', spec: { program: 'claude-code', model: 'sonnet' }, resume: { program: 'claude-code', sessionId: 'sess-7' } });
    expect(tmux.commandFor('orca-Nova')).not.toContain('--resume');
  });
});
