// Atomic terminal repaint: cursor-home + clear-screen, then the full pane snapshot.
// Written to xterm in ONE write() call so the parser renders it as a single frame
// (no blank intermediate paint → no flicker). The backend streams full snapshots.
//
// The trailing `\x1b[?25l` hides xterm's own cursor. This terminal mirrors a tmux
// `capture-pane` snapshot, which carries no cursor position — so xterm would otherwise
// blink a cursor at the end of the written buffer (the bottom of the pane) instead of
// where the mirrored TUI actually draws its input. The app inside (claude/opencode/codex)
// renders its own input line, so a second, misplaced cursor is pure noise.
export function composeFrame(pane: string): string {
  return `\x1b[H\x1b[2J${pane}\x1b[?25l`;
}
