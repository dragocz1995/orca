'use client';
import { useEffect, useRef } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type { ResolvedTheme } from '../../lib/useTheme';
import type { TerminalSettings } from '../../lib/types';
import { xtermTheme } from './xtermTheme';
import { FONT_STACKS } from './palettes';

// A fixed sample that exercises the whole palette: prompt text (foreground), the 3 status colours, a few
// named colours, and the 8 normal + 8 bright ANSI background swatches.
const SAMPLE = [
  '$ orca run "ship the feature"',
  '\x1b[32m✓ build green\x1b[0m  \x1b[33m⚠ 2 warnings\x1b[0m  \x1b[31m✗ 1 failed\x1b[0m',
  '\x1b[34mblue\x1b[0m \x1b[35mmagenta\x1b[0m \x1b[36mcyan\x1b[0m \x1b[90mdim\x1b[0m',
  '\x1b[40m  \x1b[41m  \x1b[42m  \x1b[43m  \x1b[44m  \x1b[45m  \x1b[46m  \x1b[47m  \x1b[0m',
  '\x1b[100m  \x1b[101m  \x1b[102m  \x1b[103m  \x1b[104m  \x1b[105m  \x1b[106m  \x1b[107m  \x1b[0m',
].join('\r\n');

/** A non-interactive xterm rendering a fixed ANSI sample under the in-progress (unsaved) terminal
 *  settings, so the Account section shows palette/font/cursor changes live before they're saved. */
export function TerminalPreview({ settings, resolvedTheme }: { settings: TerminalSettings; resolvedTheme: ResolvedTheme }) {
  const ref = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  // Initial values for the mount effect, held in a ref so the effect keys on nothing (updates go through
  // the redraw effect below) without tripping exhaustive-deps.
  const initial = useRef({ settings, resolvedTheme });

  useEffect(() => {
    if (!ref.current) return;
    const { settings: s, resolvedTheme: rt } = initial.current;
    const term = new XTerm({
      convertEol: true, disableStdin: true, cursorBlink: false, rows: 7,
      fontSize: s.fontSize, fontFamily: FONT_STACKS[s.fontFamily], cursorStyle: s.cursorStyle,
      theme: xtermTheme(rt, s),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(ref.current);
    termRef.current = term;
    fitRef.current = fit;
    const raf = requestAnimationFrame(() => { fitRef.current?.fit(); term.write(SAMPLE); });
    return () => { cancelAnimationFrame(raf); term.dispose(); termRef.current = null; fitRef.current = null; };
  }, []);

  // Re-apply appearance and redraw the sample on any settings/theme change.
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.theme = xtermTheme(resolvedTheme, settings);
    term.options.fontSize = settings.fontSize;
    term.options.fontFamily = FONT_STACKS[settings.fontFamily];
    term.options.cursorStyle = settings.cursorStyle;
    fitRef.current?.fit();
    term.reset();
    term.write(SAMPLE);
  }, [settings, resolvedTheme]);

  return <div ref={ref} className="h-44 w-full overflow-hidden rounded-lg border border-border bg-bg p-1.5" />;
}
