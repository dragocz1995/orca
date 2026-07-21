/** Launch a session by typing `command` into the pane shell (tmux `send-keys`). `env`, when present, is
 *  injected as tmux session environment (`-e KEY=VAL` on `new-session`) rather than an inline `export …`
 *  in the command — so secrets it may carry (e.g. an agent token) never enter the pane scrollback, while
 *  the login-shell/PATH/prompt behaviour of a typed command is preserved (unlike the shell-less spawnArgv). */
export interface SpawnOpts { cwd: string; command: string; env?: Record<string, string>; width?: number; height?: number }
/** Launch a session by running an argv directly (tmux `-- <argv>`, no shell, no `send-keys`) with an
 *  explicit session environment (tmux `-e KEY=VAL`). Keeps secrets out of the pane scrollback: the
 *  command and its env never appear as typed keystrokes the way `SpawnOpts.command` does. */
export interface ArgvSpawnOpts { cwd: string; argv: string[]; env: Record<string, string>; width?: number; height?: number }
export interface TmuxDriver {
  spawn(session: string, opts: SpawnOpts): Promise<void>;
  /** Launch directly via argv + session env — see {@link ArgvSpawnOpts}. */
  spawnArgv(session: string, opts: ArgvSpawnOpts): Promise<void>;
  resize(session: string, cols: number, rows: number): Promise<void>;
  sendKeys(session: string, keys: string[]): Promise<void>;
  /** Forward raw terminal bytes (xterm onData) to the pane verbatim — powers the interactive advisor. */
  sendRaw(session: string, data: string): Promise<void>;
  capturePane(session: string, tailLines: number): Promise<string>;
  capturePaneAnsi(session: string, tailLines: number): Promise<string>;
  list(): Promise<string[]>;
  kill(session: string): Promise<void>;
}
