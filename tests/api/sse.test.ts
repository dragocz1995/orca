import { describe, it, expect } from 'vitest';
import { EventBus } from '../../src/api/sse.js';

describe('EventBus', () => {
  it('fans out emitted signals to subscribers and unsubscribes', () => {
    const bus = new EventBus(); const got: any[] = [];
    const off = bus.subscribe(e => got.push(e));
    bus.emit('orca-A', { type: 'working' });
    off();
    bus.emit('orca-A', { type: 'complete' });
    expect(got).toEqual([{ type: 'signal', session: 'orca-A', signal: { type: 'working' } }]);
  });
  it('delivers a plan event to subscribers', () => {
    const bus = new EventBus();
    const seen: unknown[] = [];
    bus.subscribe((e) => seen.push(e));
    bus.publish({ type: 'plan', jobId: 'pj-1', status: 'done', epicId: 'orca-ep', phases: [{ title: 'A', type: 'task' }] });
    expect(seen).toEqual([{ type: 'plan', jobId: 'pj-1', status: 'done', epicId: 'orca-ep', phases: [{ title: 'A', type: 'task' }] }]);
  });
});
