'use client';
import { useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { useTerminalStream } from '../../lib/useTerminalStream';
import { Terminal } from './Terminal';

/** A real-PTY terminal: raw bytes stream over a WebSocket straight from a `tmux attach`, so the cursor,
 *  scrollback and redraws are native — no snapshot mirror. Fully interactive (keystrokes reach the
 *  pane). When the stream is unavailable (node-pty missing, or no reverse proxy fronting the daemon WS)
 *  it falls back to the interactive snapshot `<Terminal>`. */
export function StreamTerminal({ name }: { name: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const streamRef = useRef<{ send: (d: string) => void; resize: (c: number, r: number) => void } | null>(null);
  const [fallback, setFallback] = useState(false);

  // Push every inbound PTY byte straight into xterm. `termRef` is stable, so the callback identity
  // doesn't matter — the hook holds it in a ref and never reconnects on its account.
  const stream = useTerminalStream(name, !fallback, (bytes) => termRef.current?.write(bytes));
  streamRef.current = stream;

  // An unsupported stream → render the snapshot mirror instead (and stop the hook via `enabled=false`).
  useEffect(() => { if (stream.status === 'unsupported') setFallback(true); }, [stream.status]);

  useEffect(() => {
    if (!ref.current || fallback) return;
    const term = new XTerm({ convertEol: false, cursorBlink: true, fontSize: 12, theme: { background: '#000000' } });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(ref.current);
    termRef.current = term;

    // Forward every keystroke verbatim to the PTY over the socket.
    const dataSub = term.onData((d) => streamRef.current?.send(d));

    // Tell the PTY our size so the attached tmux/agent redraws at our width (SIGWINCH via pty.resize).
    let lastSize = '';
    const pushSize = () => {
      const t = termRef.current;
      if (!t) return;
      const key = `${t.cols}x${t.rows}`;
      if (key === lastSize) return;
      lastSize = key;
      streamRef.current?.resize(t.cols, t.rows);
    };

    const rafId = requestAnimationFrame(() => { if (termRef.current) { fit.fit(); pushSize(); } });
    const ro = new ResizeObserver(() => { if (termRef.current) { fit.fit(); pushSize(); } });
    ro.observe(ref.current);

    return () => {
      cancelAnimationFrame(rafId);
      dataSub.dispose();
      ro.disconnect();
      term.dispose();
      termRef.current = null;
    };
  }, [name, fallback]);

  if (fallback) return <Terminal name={name} interactive />;
  return <div ref={ref} className="h-full w-full border border-border bg-bg" />;
}
