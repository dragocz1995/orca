import type { PtyModule, IPty } from './ptyLoader.js';

/** A live PTY attached to a tmux session. The browser's xterm bytes flow in via `write`, the pane's
 *  raw output flows out via `onData` — a true terminal, cursor and all, not a capture-pane snapshot. */
export interface PtySession {
  onData(cb: (d: string) => void): void;
  write(d: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}

/** Attach a PTY to an existing tmux session via `tmux attach`. The caller already passed the ownership
 *  gate when minting the ticket, so the attach is fully interactive (keystrokes reach the pane). */
export function attachPty(
  pty: PtyModule,
  opts: { session: string; cols: number; rows: number },
): PtySession {
  const proc: IPty = pty.spawn('tmux', ['attach', '-t', opts.session], {
    name: 'xterm-256color',
    cols: opts.cols,
    rows: opts.rows,
    env: { ...process.env, TERM: 'xterm-256color' },
  });
  return {
    onData: (cb) => proc.onData(cb),
    write: (d) => proc.write(d),
    resize: (cols, rows) => proc.resize(cols, rows),
    kill: () => proc.kill(),
  };
}
