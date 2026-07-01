import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from '../../src/store/db.js';
import { BrainStore } from '../../src/store/brainStore.js';
import { projectEvent, projectUserTurn, rehydrate } from '../../src/brain/persistence.js';

describe('brain persistence', () => {
  let store: BrainStore;
  beforeEach(() => {
    store = new BrainStore(openDb(':memory:'));
    store.createSession({ id: 's1', userId: 1, model: 'm' });
  });

  it('projectUserTurn persists the user prompt', () => {
    projectUserTurn(store, 's1', 'hi there');
    const msgs = store.getMessages('s1');
    expect(msgs.at(-1)!.role).toBe('user');
    expect(JSON.parse(msgs.at(-1)!.content)).toMatchObject({ content: 'hi there' });
  });

  it('projectEvent persists assistant messages from agent_end', () => {
    projectEvent(store, 's1', { type: 'agent_end', willRetry: false, messages: [{ role: 'assistant', content: 'hello' }] } as never);
    const msgs = store.getMessages('s1');
    expect(msgs.at(-1)!.role).toBe('assistant');
    expect(JSON.parse(msgs.at(-1)!.content)).toMatchObject({ content: 'hello' });
  });

  it('projectEvent ignores non-terminal events', () => {
    projectEvent(store, 's1', { type: 'queue_update', steering: [], followUp: [] } as never);
    expect(store.getMessages('s1')).toHaveLength(0);
  });

  it('rehydrate replays stored messages into an in-memory SessionManager', () => {
    projectUserTurn(store, 's1', 'earlier q');
    const sm = rehydrate(store, 's1', process.cwd());
    expect(sm.isPersisted()).toBe(false);
    expect(sm.getEntries().length).toBeGreaterThanOrEqual(1);
  });
});
