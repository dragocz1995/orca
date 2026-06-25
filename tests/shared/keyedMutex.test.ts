import { describe, it, expect } from 'vitest';
import { KeyedMutex } from '../../src/shared/keyedMutex.js';

const tick = () => new Promise((r) => setTimeout(r, 5));

describe('KeyedMutex', () => {
  it('runs same-key tasks strictly one at a time, in FIFO order', async () => {
    const m = new KeyedMutex();
    const order: string[] = [];
    const job = (id: string) => async () => { order.push(`${id}:start`); await tick(); order.push(`${id}:end`); };
    await Promise.all([m.run('k', job('a')), m.run('k', job('b')), m.run('k', job('c'))]);
    // No interleaving: each job fully completes before the next same-key job starts.
    expect(order).toEqual(['a:start', 'a:end', 'b:start', 'b:end', 'c:start', 'c:end']);
  });

  it('runs different keys concurrently', async () => {
    const m = new KeyedMutex();
    const order: string[] = [];
    const job = (id: string) => async () => { order.push(`${id}:start`); await tick(); order.push(`${id}:end`); };
    await Promise.all([m.run('x', job('x')), m.run('y', job('y'))]);
    // Both start before either ends — they overlap because the keys differ.
    expect(order.slice(0, 2).sort()).toEqual(['x:start', 'y:start']);
  });

  it('returns the function result and propagates its rejection without wedging the chain', async () => {
    const m = new KeyedMutex();
    await expect(m.run('k', async () => 42)).resolves.toBe(42);
    await expect(m.run('k', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    // A prior throw must not break the key's chain — the next run still executes.
    await expect(m.run('k', async () => 'ok')).resolves.toBe('ok');
  });

  it('serializes a later run that arrives while the first is still holding the key', async () => {
    const m = new KeyedMutex();
    const events: string[] = [];
    const first = m.run('k', async () => { events.push('first:in'); await tick(); events.push('first:out'); });
    const second = m.run('k', async () => { events.push('second:in'); });
    await Promise.all([first, second]);
    expect(events).toEqual(['first:in', 'first:out', 'second:in']); // second waited for first
  });
});
