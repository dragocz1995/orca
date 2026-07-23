import { describe, it, expect, vi } from 'vitest';
import { PluginRegistryProvider } from '../../src/plugins/pluginsProvider.js';
import { PluginRegistry } from '../../src/plugins/registry.js';

describe('PluginRegistryProvider (the daemon-wide shared registry)', () => {
  it('memoizes: repeated get() loads once', async () => {
    const load = vi.fn(async () => new PluginRegistry());
    const p = new PluginRegistryProvider(load);
    const a = await p.get();
    const b = await p.get();
    expect(a).toBe(b);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('sheds a rejected load so the next get() retries (no sticky failure)', async () => {
    let attempt = 0;
    const good = new PluginRegistry();
    const load = vi.fn(async () => { if (attempt++ === 0) throw new Error('transient FS blip'); return good; });
    const p = new PluginRegistryProvider(load);
    await expect(p.get()).rejects.toThrow('transient FS blip');
    expect(await p.get()).toBe(good); // memo was shed on reject → retry succeeds
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('invalidate() makes the next get() reload — the stale-worker-registry fix', async () => {
    // Regression: BrainWorkerService used to keep its OWN memo that reloadPlugins() never touched,
    // so elowen-exec workers ran on a stale registry until a daemon restart. With the shared provider,
    // one invalidate() reaches every consumer.
    const registries = [new PluginRegistry(), new PluginRegistry()];
    let i = 0;
    const load = vi.fn(async () => registries[i++]!);
    const p = new PluginRegistryProvider(load);
    expect(await p.get()).toBe(registries[0]);
    p.invalidate();
    expect(await p.get()).toBe(registries[1]); // fresh load, not the memo
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('serves the LAST GOOD registry while a reload is failing, then retries', async () => {
    // Regression: a reload landing inside an in-place package build (dist/plugins wiped for the tsc run)
    // used to reject and leave consumers spawning sessions against whatever partial state came next. The
    // provider must degrade to the previous registry — never to a partial one — and recover by itself.
    const good = new PluginRegistry();
    const rebuilt = new PluginRegistry();
    const answers: (PluginRegistry | Error)[] = [good, new Error('bundled plugins directory is empty'), rebuilt];
    const load = vi.fn(async () => {
      const next = answers.shift()!;
      if (next instanceof Error) throw next;
      return next;
    });
    const p = new PluginRegistryProvider(load);
    expect(await p.get()).toBe(good);
    p.invalidate();
    expect(await p.get()).toBe(good);    // failed reload → last good, not a rejection
    expect(await p.get()).toBe(rebuilt); // memo was shed → this get() retried and picked up the rebuild
    expect(load).toHaveBeenCalledTimes(3);
  });

  it('a failing FIRST load still rejects — there is no previous registry to fall back to', async () => {
    const load = vi.fn(async () => { throw new Error('no plugins dir'); });
    const p = new PluginRegistryProvider(load);
    await expect(p.get()).rejects.toThrow('no plugins dir');
  });
});
