import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readState, writeState, clearState, isAlive, isTrackedService, status, stop, start, type RunState } from '../../src/cli/launcher.js';
import type { spawn as nodeSpawn } from 'node:child_process';

let home: string;
let env: NodeJS.ProcessEnv;
const sample: RunState = { daemon: { pid: 111, port: 4400 }, web: { pid: 222, port: 4500 }, version: '1.1.1', startedAt: '2026-06-22T00:00:00Z' };

beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'elowen-launch-')); env = { HOME: home } as NodeJS.ProcessEnv; });
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe('cli/launcher state', () => {
  it('round-trips run state through the run file', () => {
    writeState(env, sample);
    expect(readState(env)).toEqual(sample);
  });
  it('returns null when the run file is missing', () => {
    expect(readState(env)).toBeNull();
  });
  it('returns null (not throw) when the run file is corrupt', () => {
    mkdirSync(join(home, '.config', 'elowen'), { recursive: true });
    writeFileSync(join(home, '.config', 'elowen', 'run.json'), '{ not json', 'utf8');
    expect(readState(env)).toBeNull();
  });
  it('clearState removes the run file and tolerates a missing one', () => {
    writeState(env, sample);
    clearState(env);
    expect(readState(env)).toBeNull();
    expect(() => clearState(env)).not.toThrow();
  });
});

describe('cli/launcher.isAlive', () => {
  it('is true for the current process and false for a surely-dead pid', () => {
    expect(isAlive(process.pid)).toBe(true);
    expect(isAlive(2147483646)).toBe(false);
  });
});

describe('cli/launcher.isTrackedService', () => {
  it('is false for a dead pid regardless of platform', () => {
    expect(isTrackedService(2147483646, 'daemon')).toBe(false);
  });
  it('rejects a live pid that is not our service (this test runner is not the daemon entry)', () => {
    // On Linux the procfs argv of the vitest process carries no `daemon/index.js`; elsewhere there is no
    // /proc so it falls back to liveness (true). Either way it must never be mistaken for the daemon on
    // the platform we ship to.
    if (process.platform === 'linux') expect(isTrackedService(process.pid, 'daemon')).toBe(false);
  });
});

describe('cli/launcher.status', () => {
  it('reports not-running when there is no run file', async () => {
    const s = await status(env, async () => new Response('', { status: 200 }));
    expect(s.daemon.running).toBe(false);
    expect(s.web.running).toBe(false);
  });
  it('reports running + healthy when the tracked pid is ours and the port answers', async () => {
    writeState(env, { ...sample, daemon: { pid: process.pid, port: 4400 }, web: { pid: process.pid, port: 4500 } });
    const s = await status(env, async () => new Response('ok', { status: 200 }), () => true);
    expect(s.daemon).toMatchObject({ running: true, pid: process.pid, healthy: true });
    expect(s.web).toMatchObject({ running: true, healthy: true });
  });
  it('running but unhealthy when the tracked pid is ours but the port is silent', async () => {
    writeState(env, { ...sample, daemon: { pid: process.pid, port: 4400 }, web: { pid: process.pid, port: 4500 } });
    const s = await status(env, async () => { throw new Error('ECONNREFUSED'); }, () => true);
    expect(s.daemon).toMatchObject({ running: true, healthy: false });
  });
  it('reports not-running for a recycled pid the identity check disowns (never probes its port)', async () => {
    writeState(env, { ...sample, daemon: { pid: process.pid, port: 4400 }, web: { pid: process.pid, port: 4500 } });
    let probed = false;
    const s = await status(env, async () => { probed = true; return new Response('ok', { status: 200 }); }, () => false);
    expect(s.daemon).toMatchObject({ running: false, healthy: false });
    expect(probed).toBe(false);
  });
});

describe('cli/launcher.stop', () => {
  it('signals each tracked pid it confirms is ours and clears the run file', async () => {
    writeState(env, sample);
    const killed: number[] = [];
    await stop(env, (pid) => { killed.push(pid); }, () => true);
    expect(killed.sort((a, b) => a - b)).toEqual([111, 222]);
    expect(readState(env)).toBeNull();
  });
  it('never signals a recycled pid the identity check disowns, but still clears the run file', async () => {
    writeState(env, sample); // daemon 111 (ours), web 222 (recycled → disowned)
    const killed: number[] = [];
    await stop(env, (pid) => { killed.push(pid); }, (pid) => pid === 111);
    expect(killed).toEqual([111]);
    expect(readState(env)).toBeNull();
  });
  it('is a no-op when nothing is running', async () => {
    const killed: number[] = [];
    await stop(env, (pid) => killed.push(pid));
    expect(killed).toEqual([]);
  });
});

describe('cli/launcher.start', () => {
  const fakeSpawn = (() => ({ pid: 4321, unref() { /* detached */ } })) as unknown as typeof nodeSpawn;

  it('records run state and resolves when the daemon answers /health', async () => {
    const fetchFn = (async () => new Response('ok', { status: 200 })) as unknown as typeof fetch;
    const s = await start(env, { version: '9.9.9', spawn: fakeSpawn, fetch: fetchFn, pollMs: 1, attempts: 3 });
    expect(s.daemon.pid).toBe(4321);
    expect(readState(env)).toEqual(s);
  });

  it('throws when the daemon never becomes healthy, but still records pids for cleanup', async () => {
    const fetchFn = (async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch;
    await expect(start(env, { version: '9.9.9', spawn: fakeSpawn, fetch: fetchFn, pollMs: 1, attempts: 2 }))
      .rejects.toThrow(/did not become healthy/);
    expect(readState(env)?.daemon.pid).toBe(4321);
  });

  it('adopts existing pids the identity check confirms are still ours (no re-spawn)', async () => {
    writeState(env, sample); // daemon 111, web 222
    const fetchFn = (async () => new Response('ok', { status: 200 })) as unknown as typeof fetch;
    const s = await start(env, { version: '9.9.9', spawn: fakeSpawn, fetch: fetchFn, pollMs: 1, attempts: 3, isTracked: () => true });
    expect(s.daemon.pid).toBe(111);
    expect(s.web.pid).toBe(222);
  });

  it('re-spawns instead of adopting a stale run.json whose pids the identity check disowns', async () => {
    writeState(env, sample); // pids 111/222 are stale after a reboot that recycled them
    const fetchFn = (async () => new Response('ok', { status: 200 })) as unknown as typeof fetch;
    const s = await start(env, { version: '9.9.9', spawn: fakeSpawn, fetch: fetchFn, pollMs: 1, attempts: 3, isTracked: () => false });
    expect(s.daemon.pid).toBe(4321); // freshly spawned, not the recycled 111
    expect(s.web.pid).toBe(4321);
  });
});
