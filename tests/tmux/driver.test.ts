import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { RealTmuxDriver } from '../../src/tmux/driver.js';

const hasTmux = (() => { try { execFileSync('tmux', ['-V']); return true; } catch { return false; } })();

describe.runIf(hasTmux)('RealTmuxDriver', () => {
  it('spawn → capture → kill round-trips', async () => {
    const t = new RealTmuxDriver(); const s = `elowen-test-${process.pid}`;
    await t.spawn(s, { cwd: '/tmp', command: 'echo elowen-marker' });
    await new Promise(r => setTimeout(r, 500));
    expect(await t.capturePane(s, 60)).toContain('elowen-marker');
    await t.kill(s);
    expect(await t.list()).not.toContain(s);
  });

  it('resize sets the window to the requested dimensions', async () => {
    const t = new RealTmuxDriver(); const s = `elowen-resize-${process.pid}`;
    await t.spawn(s, { cwd: '/tmp', command: 'sleep 5' });
    await t.resize(s, 132, 40);
    const size = execFileSync('tmux', ['display-message', '-t', s, '-p', '#{window_width}x#{window_height}']).toString().trim();
    await t.kill(s);
    expect(size).toBe('132x40');
  });

  it('capturePane on a vanished session returns empty (mirrors capturePaneAnsi)', async () => {
    const t = new RealTmuxDriver();
    expect(await t.capturePane(`elowen-gone-${process.pid}`, 60)).toBe('');
  });

  it('targets sessions EXACTLY — a gone session never prefix-matches a longer-named live one', async () => {
    // Regression: session names carry numeric suffixes (elowen-advisor-<userId> etc.). With tmux's default
    // prefix matching, an op on the already-exited `-1` would fall through to the live `-10` — killing it,
    // injecting keystrokes, or reading its scrollback across users. Exact `=name:` targeting must prevent it.
    const t = new RealTmuxDriver();
    const base = `elowen-exact-${process.pid}`;
    const short = `${base}-1`, long = `${base}-10`;
    await t.spawn(short, { cwd: '/tmp', command: 'cat' });
    await t.spawn(long, { cwd: '/tmp', command: 'cat' });
    await new Promise((r) => setTimeout(r, 300));
    await t.kill(short);                                    // `-1` is now gone
    await t.sendKeys(short, ['INJECTED', 'Enter']).catch(() => { /* exact target gone → no-op, must not reach -10 */ });
    await t.kill(short);                                   // second kill of the gone `-1` must not hit `-10`
    await new Promise((r) => setTimeout(r, 200));
    expect(await t.list()).toContain(long);               // `-10` survived
    expect(await t.capturePane(long, 60)).not.toContain('INJECTED'); // `-10` received no stray keystrokes
    await t.kill(long);
  });
});

describe.runIf(hasTmux)('RealTmuxDriver.sendRaw', () => {
  it('forwards raw bytes literally into the pane', async () => {
    const t = new RealTmuxDriver(); const s = `elowen-raw-${process.pid}`;
    await t.spawn(s, { cwd: '/tmp', command: 'cat' }); // cat echoes typed input back to the pane
    await new Promise(r => setTimeout(r, 300));
    await t.sendRaw(s, 'elowen-raw-marker\r');            // \r submits, like a real Enter
    await new Promise(r => setTimeout(r, 300));
    expect(await t.capturePane(s, 60)).toContain('elowen-raw-marker');
    await t.kill(s);
  });
  it('an empty string is a no-op (never shells out)', async () => {
    const t = new RealTmuxDriver();
    await expect(t.sendRaw(`elowen-gone-${process.pid}`, '')).resolves.toBeUndefined();
  });
});

describe('RealTmuxDriver.sendKeys validation', () => {
  it('rejects empty, non-string, or flag-shaped keys (defense in depth)', async () => {
    const t = new RealTmuxDriver();
    await expect(t.sendKeys('elowen-x', [])).rejects.toThrow(/non-empty/);
    await expect(t.sendKeys('elowen-x', ['-t', 'other'])).rejects.toThrow(/non-flag/);
    await expect(t.sendKeys('elowen-x', [123 as unknown as string])).rejects.toThrow();
  });
});
