import { describe, it, expect } from 'vitest';
import { xtermTheme } from '../../../components/terminal/xtermTheme';
import { DARK_PALETTE } from '../../../components/terminal/palettes';
import type { TerminalSettings } from '../../../lib/types';

const base: TerminalSettings = {
  fontSize: 12, fontFamily: 'system', cursorStyle: 'block', cursorBlink: true, scrollback: 1000, theme: 'auto', palette: DARK_PALETTE,
};

describe('xtermTheme', () => {
  it('auto (no prefs) follows the app light/dark theme', () => {
    expect(xtermTheme('dark').background).toBe('#000000');
    expect(xtermTheme('light').background).toBe('#ffffff');
    // theme:'auto' behaves the same as no prefs
    expect(xtermTheme('light', { ...base, theme: 'auto' }).background).toBe('#ffffff');
  });

  it('custom builds the ITheme from the user palette', () => {
    const theme = xtermTheme('dark', { ...base, theme: 'custom', palette: { ...DARK_PALETTE, background: '#101010', red: '#ff0000' } });
    expect(theme.background).toBe('#101010');
    expect(theme.red).toBe('#ff0000');
    expect(theme.foreground).toBe(DARK_PALETTE.foreground);
  });

  it('drops an invalid hex from a custom palette instead of forwarding it to the renderer', () => {
    const theme = xtermTheme('dark', { ...base, theme: 'custom', palette: { ...DARK_PALETTE, green: 'lime' as string } });
    expect(theme.green).toBeUndefined();     // invalid → omitted
    expect(theme.background).toBe(DARK_PALETTE.background); // valid ones survive
  });
});
