import { describe, it, expect } from 'vitest';
import { Deriver } from '../../src/deriver/deriver.js';
import { FakeTmuxDriver } from '../../src/tmux/fakeDriver.js';
import { openDb } from '../../src/store/db.js';
import { TaskStore } from '../../src/store/taskStore.js';
import { AgentStore } from '../../src/store/agentStore.js';

const OC_DIALOG = `△ Permission required\n Allow once   Allow always   Reject  ⇆ select  enter confirm`;

function setup() {
  const db = openDb(':memory:'); db.prepare("INSERT INTO projects (id,slug,path) VALUES (1,'orca','/o')").run();
  const tasks = new TaskStore(db); const agents = new AgentStore(db);
  tasks.create({ id: 'orca-1', project_id: 1, title: 'T' }); tasks.setStatus('orca-1', 'in_progress');
  agents.upsert({ project_id: 1, name: 'TestAgent', program: 'opencode', model: 'ollama/deepseek-v4-flash' });
  const tmux = new FakeTmuxDriver(); tmux.setPane('orca-TestAgent', OC_DIALOG);
  const emitted: any[] = [];
  const deriver = new Deriver({
    tmux, agents, tasks,
    sink: { emit: (s, sig) => emitted.push({ s, sig }) },
    sessionTaskId: () => 'orca-1',
  });
  return { tmux, deriver, emitted };
}

describe('Deriver auto-approve', () => {
  it('sends Enter once and emits working, not needs_input', async () => {
    const { tmux, deriver, emitted } = setup();
    await deriver.tick();
    expect(tmux.sentKeys('orca-TestAgent')).toEqual([['Enter']]);
    expect(emitted.at(-1).sig.type).toBe('working');
    // Same dialog next tick → no second Enter (dedup).
    await deriver.tick();
    expect(tmux.sentKeys('orca-TestAgent')).toEqual([['Enter']]);
  });
});
