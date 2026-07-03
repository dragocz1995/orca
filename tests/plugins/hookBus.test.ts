import { describe, it, expect, beforeEach } from 'vitest';
import { PluginHookBus, type HookBusLogger } from '../../src/plugins/hookBus.js';
import type { PluginHook, PluginHookName } from '../../src/plugins/api.js';

/** A logger that records every warning so tests can assert isolation happened. */
function makeLogger(): HookBusLogger & { warnings: string[] } {
  const warnings: string[] = [];
  return { warnings, warn: (m) => { warnings.push(m); } };
}

/** Small deterministic async delay — no timers-of-doom, no Date.now/Math.random. */
const tick = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe('PluginHookBus', () => {
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => { logger = makeLogger(); });

  it('runs every hook for the emitted name and none for other names', async () => {
    const calls: string[] = [];
    const hooks: PluginHook[] = [
      { name: 'brain.turn.beforeSend', run: () => { calls.push('a'); } },
      { name: 'brain.turn.beforeSend', run: async () => { await tick(1); calls.push('b'); } },
      { name: 'brain.turn.afterResponse', run: () => { calls.push('other'); } },
    ];
    const bus = new PluginHookBus({ hooks, logger });

    await bus.emit('brain.turn.beforeSend', { foo: 1 });

    expect(calls.sort()).toEqual(['a', 'b']);
    expect(logger.warnings).toHaveLength(0);
  });

  it('passes the payload through to each hook', async () => {
    const seen: unknown[] = [];
    const hooks: PluginHook[] = [
      { name: 'tools.call.before', run: (p) => { seen.push(p); } },
    ];
    const bus = new PluginHookBus({ hooks, logger });

    const payload = { tool: 'read', args: [1, 2] };
    await bus.emit('tools.call.before', payload);

    expect(seen).toEqual([payload]);
  });

  it('emits to no hooks (and resolves) when nothing matches', async () => {
    const bus = new PluginHookBus({ hooks: [], logger });
    await expect(bus.emit('memory.write.after', null)).resolves.toBeUndefined();
    expect(logger.warnings).toHaveLength(0);
  });

  it('isolates a throwing hook: siblings still run, emit resolves, logger.warn fires', async () => {
    const calls: string[] = [];
    const hooks: PluginHook[] = [
      { name: 'brain.session.beforeSpawn', run: () => { throw new Error('boom'); } },
      { name: 'brain.session.beforeSpawn', run: () => { calls.push('survivor'); } },
    ];
    const bus = new PluginHookBus({ hooks, logger });

    await expect(bus.emit('brain.session.beforeSpawn', {})).resolves.toBeUndefined();

    expect(calls).toEqual(['survivor']);
    expect(logger.warnings).toHaveLength(1);
    expect(logger.warnings[0]).toContain('threw');
    expect(logger.warnings[0]).toContain('boom');
  });

  it('isolates a rejecting async hook the same way', async () => {
    const calls: string[] = [];
    const hooks: PluginHook[] = [
      { name: 'memory.retrieve.before', run: async () => { await tick(1); return Promise.reject(new Error('nope')); } },
      { name: 'memory.retrieve.before', run: () => { calls.push('ok'); } },
    ];
    const bus = new PluginHookBus({ hooks, logger });

    await bus.emit('memory.retrieve.before', {});

    expect(calls).toEqual(['ok']);
    expect(logger.warnings).toHaveLength(1);
    expect(logger.warnings[0]).toContain('nope');
  });

  it('bounds a hanging hook by the timeout: emit still resolves and warns', async () => {
    const calls: string[] = [];
    const hooks: PluginHook[] = [
      { name: 'plugin.reload.after', run: () => new Promise<void>(() => { /* never resolves */ }) },
      { name: 'plugin.reload.after', run: () => { calls.push('fast'); } },
    ];
    const bus = new PluginHookBus({ hooks, logger, timeoutMs: 10 });

    await expect(bus.emit('plugin.reload.after', {})).resolves.toBeUndefined();

    expect(calls).toEqual(['fast']);
    expect(logger.warnings).toHaveLength(1);
    expect(logger.warnings[0]).toContain('timed out');
  });

  it('works without a logger (silent fail-open)', async () => {
    const calls: string[] = [];
    const hooks: PluginHook[] = [
      { name: 'tools.registry.build', run: () => { throw new Error('x'); } },
      { name: 'tools.registry.build', run: () => { calls.push('y'); } },
    ];
    const bus = new PluginHookBus({ hooks });

    await expect(bus.emit('tools.registry.build', {})).resolves.toBeUndefined();
    expect(calls).toEqual(['y']);
  });

  it('listFor returns only the hooks matching a name', () => {
    const a: PluginHook = { name: 'brain.turn.beforeContext', run: () => {} };
    const b: PluginHook = { name: 'brain.turn.beforeContext', run: () => {} };
    const c: PluginHook = { name: 'brain.turn.contextBuilt', run: () => {} };
    const bus = new PluginHookBus({ hooks: [a, b, c] });

    expect(bus.listFor('brain.turn.beforeContext')).toEqual([a, b]);
    expect(bus.listFor('brain.turn.contextBuilt')).toEqual([c]);
    const empty: PluginHookName = 'platform.message.received';
    expect(bus.listFor(empty)).toEqual([]);
  });
});
