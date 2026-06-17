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
    const { session } = await svc.launch({ projectId: 1, projectPath: '/o', taskId: 'orca-1', agentName: 'SwiftLake', spec: { program: 'opencode', model: 'ollama/deepseek-v4-flash' } });
    expect(session).toBe('orca-SwiftLake');
    expect(await tmux.list()).toContain('orca-SwiftLake');
    expect(agents.programFor('SwiftLake')).toBe('opencode');
  });
});
