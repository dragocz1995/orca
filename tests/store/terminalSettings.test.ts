import { describe, it, expect } from 'vitest';
import { sanitizeTerminalSettings, mergeTerminalSettings, TERMINAL_DEFAULTS, DARK_PALETTE } from '../../src/store/terminalSettings.js';

describe('terminalSettings — sanitize (untrusted → valid)', () => {
  it('an empty/garbage input yields the full defaults', () => {
    expect(sanitizeTerminalSettings({})).toEqual(TERMINAL_DEFAULTS);
    expect(sanitizeTerminalSettings(null)).toEqual(TERMINAL_DEFAULTS);
    expect(sanitizeTerminalSettings('nope' as unknown)).toEqual(TERMINAL_DEFAULTS);
  });

  it('clamps fontSize and scrollback into their bands', () => {
    expect(sanitizeTerminalSettings({ fontSize: 4 }).fontSize).toBe(10);
    expect(sanitizeTerminalSettings({ fontSize: 99 }).fontSize).toBe(20);
    expect(sanitizeTerminalSettings({ fontSize: 'x' }).fontSize).toBe(12); // non-number → default
    expect(sanitizeTerminalSettings({ scrollback: 1 }).scrollback).toBe(500);
    expect(sanitizeTerminalSettings({ scrollback: 9_999_999 }).scrollback).toBe(50_000);
  });

  it('falls back on unknown enum values', () => {
    const s = sanitizeTerminalSettings({ fontFamily: 'comic-sans', cursorStyle: 'wiggle', theme: 'neon' });
    expect(s.fontFamily).toBe('system');
    expect(s.cursorStyle).toBe('block');
    expect(s.theme).toBe('auto');
  });

  it('keeps valid hex palette colours (lowercased) and drops invalid ones to the default', () => {
    const s = sanitizeTerminalSettings({ palette: { background: '#AABBCC', red: 'red', foreground: 'not-a-hex' } });
    expect(s.palette.background).toBe('#aabbcc');           // valid → kept, lowercased
    expect(s.palette.red).toBe(DARK_PALETTE.red);           // invalid → default
    expect(s.palette.foreground).toBe(DARK_PALETTE.foreground);
    expect(s.palette.brightWhite).toBe(DARK_PALETTE.brightWhite); // absent → default
  });
});

describe('terminalSettings — merge (partial patch onto current)', () => {
  it('merges the palette key-by-key and preserves untouched fields', () => {
    const current = sanitizeTerminalSettings({ theme: 'custom', fontSize: 16, palette: { background: '#111111' } });
    const next = mergeTerminalSettings(current, { palette: { foreground: '#eeeeee' } });
    expect(next.fontSize).toBe(16);                 // untouched
    expect(next.theme).toBe('custom');              // untouched
    expect(next.palette.background).toBe('#111111'); // kept from current
    expect(next.palette.foreground).toBe('#eeeeee'); // applied from patch
  });

  it('re-validates the merged result (bad patch value ignored)', () => {
    const next = mergeTerminalSettings(TERMINAL_DEFAULTS, { fontSize: 999, cursorStyle: 'nope' });
    expect(next.fontSize).toBe(20);
    expect(next.cursorStyle).toBe('block');
  });
});
