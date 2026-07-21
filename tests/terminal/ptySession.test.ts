import { describe, it, expect } from 'vitest';
import { attachPty } from '../../src/terminal/ptySession.js';
import type { PtyModule } from '../../src/terminal/ptyLoader.js';

function fakePty() {
  const calls = { spawn: [] as unknown[][], write: [] as string[], resize: 0, killed: false, onData: null as null | ((d: string) => void) };
  const ipty = {
    onData: (cb: (d: string) => void) => { calls.onData = cb; },
    write: (d: string) => { calls.write.push(d); },
    resize: () => { calls.resize++; },
    kill: () => { calls.killed = true; },
  };
  const mod: PtyModule = { spawn: (f, a, o) => { calls.spawn.push([f, a, o]); return ipty; } };
  return { mod, calls };
}

describe('attachPty', () => {
  it('attaches to the named tmux session', () => {
    const { mod, calls } = fakePty();
    attachPty(mod, { session: 'elowen-advisor-1', cols: 80, rows: 24 });
    expect(calls.spawn[0][0]).toBe('tmux');
    expect(calls.spawn[0][1]).toEqual(['attach', '-t', '=elowen-advisor-1']); // '=' pins an exact session match (no prefix fallback to another user's pane)
    expect(calls.spawn[0][2]).toMatchObject({ cols: 80, rows: 24, name: 'xterm-256color' });
  });

  it('forwards writes, resize and kill', () => {
    const { mod, calls } = fakePty();
    const s = attachPty(mod, { session: 'elowen-advisor-1', cols: 80, rows: 24 });
    s.write('ls\n');
    s.resize(100, 40);
    s.kill();
    expect(calls.write).toEqual(['ls\n']);
    expect(calls.resize).toBe(1);
    expect(calls.killed).toBe(true);
  });
});
