import { describe, it, expect } from 'vitest';
import { Deriver } from '../../src/deriver/deriver.js';
import { FakeTmuxDriver } from '../../src/tmux/fakeDriver.js';
import { openDb } from '../../src/store/db.js';
import { TaskStore } from '../../src/store/taskStore.js';
import { AgentStore } from '../../src/store/agentStore.js';

const OC_DIALOG = `△ Permission required\n Allow once   Allow always   Reject  ⇆ select  enter confirm`;

function setup(autonomy: string | null = null) {
  const db = openDb(':memory:'); db.prepare("INSERT INTO projects (id,slug,path) VALUES (1,'orca','/o')").run();
  const tasks = new TaskStore(db); const agents = new AgentStore(db);
  tasks.create({ id: 'orca-1', project_id: 1, title: 'T' }); tasks.setStatus('orca-1', 'in_progress');
  agents.upsert({ project_id: 1, name: 'TestAgent', program: 'opencode', model: 'ollama-cloud/deepseek-v4-flash' });
  const tmux = new FakeTmuxDriver(); tmux.setPane('orca-TestAgent', OC_DIALOG);
  const emitted: { s: string; sig: { type: string } }[] = [];
  const deriver = new Deriver({
    tmux, agents, tasks,
    sink: { emit: (s, sig) => emitted.push({ s, sig }) },
    sessionTaskId: () => 'orca-1',
    autonomyFor: () => autonomy,
  });
  return { tmux, deriver, emitted };
}

describe('Deriver permission handling', () => {
  it('L3 / manual: sends Enter once and emits working (dedup on repeat)', async () => {
    const { tmux, deriver, emitted } = setup('L3');
    await deriver.tick();
    expect(tmux.sentKeys('orca-TestAgent')).toEqual([['Enter']]);
    expect(emitted.at(-1)!.sig.type).toBe('working');
    await deriver.tick();
    expect(tmux.sentKeys('orca-TestAgent')).toEqual([['Enter']]); // no second Enter
  });

  it('mission-less (autonomy null) also auto-clears', async () => {
    const { tmux, deriver } = setup(null);
    await deriver.tick();
    expect(tmux.sentKeys('orca-TestAgent')).toEqual([['Enter']]);
  });

  it('L1 / L0: does NOT press Enter; escalates as needs_input', async () => {
    const { tmux, deriver, emitted } = setup('L1');
    await deriver.tick();
    expect(tmux.sentKeys('orca-TestAgent')).toEqual([]); // never auto-clears
    expect(emitted.at(-1)!.sig.type).toBe('needs_input');
  });
});
