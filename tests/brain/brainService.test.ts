import { describe, it, expect, vi } from 'vitest';
import { BrainService } from '../../src/brain/brainService.js';
import { openDb } from '../../src/store/db.js';
import { BrainStore } from '../../src/store/brainStore.js';

function fakeDeps() {
  const listeners: ((e: unknown) => void)[] = [];
  const session = {
    sessionId: 'sess-1',
    prompt: vi.fn(async (t: string) => {
      listeners.forEach((l) => l({ type: 'agent_end', willRetry: false, messages: [{ role: 'assistant', content: `echo:${t}` }] }));
    }),
    subscribe: (l: (e: unknown) => void) => { listeners.push(l); return () => {}; },
    setModel: vi.fn(), dispose: vi.fn(), messages: [], isStreaming: false,
  };
  const createSession = vi.fn(async () => ({ session }));
  return {
    store: new BrainStore(openDb(':memory:')),
    users: { ensureAdvisorToken: () => 'full-token', get: () => ({ id: 1, name: 'Filip', username: 'filip' }) },
    config: { openai: { baseUrl: 'http://x/v1', apiKey: 'k', model: 'm' }, default: 'openai' as const },
    url: 'http://x',
    createSession,
    session,
  };
}

describe('BrainService', () => {
  it('start creates a session row and reports running', async () => {
    const d = fakeDeps();
    const svc = new BrainService(d as never);
    const { sessionId } = await svc.start(1);
    expect(sessionId).toBe('brain-1');
    expect(svc.status(1).running).toBe(true);
    expect(d.store.getSession('brain-1')).toBeDefined();
    expect(d.createSession).toHaveBeenCalledTimes(1);
  });

  it('send forwards to the PI session, persists the turn, and emits events', async () => {
    const d = fakeDeps();
    const svc = new BrainService(d as never);
    await svc.start(1);
    const seen: { type: string }[] = [];
    svc.subscribe(1, (e) => seen.push(e));
    await svc.send(1, 'hi');
    expect(d.session.prompt).toHaveBeenCalledWith('hi');
    expect(seen.some((e) => e.type === 'idle')).toBe(true);
    const roles = d.store.getMessages('brain-1').map((m) => m.role);
    expect(roles).toContain('user');
    expect(roles).toContain('assistant');
  });

  it('stop disposes the session and reports not running', async () => {
    const d = fakeDeps();
    const svc = new BrainService(d as never);
    await svc.start(1);
    svc.stop(1);
    expect(d.session.dispose).toHaveBeenCalled();
    expect(svc.status(1).running).toBe(false);
  });
});
