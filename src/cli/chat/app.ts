import { TUI, ProcessTerminal, Text, Markdown, Loader, Container, matchesKey } from '@earendil-works/pi-tui';
import { Editor } from '@earendil-works/pi-tui';
import { color, glyph, orcaMarkdownTheme, orcaEditorTheme } from './theme.js';
import { BrainClient } from './brainClient.js';
import { fromHistory, pushUser, beginAssistant, reduce, type ChatView } from './render.js';

/** Plain-text rendering of the view — used for the non-TTY fallback and unit tests (no ANSI, so it's
 *  deterministic to assert on). The rich terminal path uses pi-tui components instead. */
export function viewToPlainText(view: ChatView): string[] {
  const lines: string[] = [];
  for (const turn of view.turns) {
    lines.push(turn.role === 'you' ? 'ty' : `${glyph.whale} orca`);
    for (const t of turn.tools) lines.push(`  ${glyph.tool} ${t}`);
    if (turn.text) lines.push(...turn.text.split('\n').map((l) => `  ${l}`));
    lines.push('');
  }
  return lines;
}

export interface RunChatOpts {
  base: string;
  token: string;
  model?: string;
  /** Injected for tests; defaults to a real BrainClient. */
  client?: BrainClient;
}

/** Launch the interactive Orca chat TUI. Thin client: renders the brain's stream, posts user input. */
export async function runChat(opts: RunChatOpts): Promise<void> {
  if (!process.stdout.isTTY) {
    process.stderr.write('orca chat needs an interactive terminal (a TTY).\n');
    return;
  }
  const client = opts.client ?? new BrainClient({ base: opts.base, token: opts.token });
  await client.start(opts.model === 'anthropic' || opts.model === 'openai' ? opts.model : undefined);

  let view = fromHistory(await client.history().catch(() => []));

  const term = new ProcessTerminal();
  const tui = new TUI(term);
  const header = new Text(color.accent(`${glyph.whale} orca`) + color.dim(opts.model ? `  ·  ${opts.model}` : ''), 1, 0);
  const messages = new Container();
  const loader = new Loader(tui, color.accent, color.dim, 'přemýšlím…');
  const editor = new Editor(tui, orcaEditorTheme, {});

  const render = (): void => {
    for (const c of [...messages.children]) messages.removeChild(c);
    for (const turn of view.turns) {
      messages.addChild(new Text(turn.role === 'you' ? color.accent('ty') : color.accent(`${glyph.whale} orca`), 1, 0));
      for (const t of turn.tools) messages.addChild(new Text(color.dim(`${glyph.tool} ${t}`), 3, 0));
      if (turn.role === 'orca') messages.addChild(new Markdown(turn.text || (turn.streaming ? '…' : ''), 3, 0, orcaMarkdownTheme));
      else if (turn.text) messages.addChild(new Text(turn.text, 3, 0));
      messages.addChild(new Text('', 0, 0));
    }
    if (view.thinking) loader.start(); else loader.stop();
    tui.requestRender();
  };

  editor.onSubmit = (text: string): void => {
    const trimmed = text.trim();
    if (!trimmed) return;
    editor.setText('');
    if (trimmed === '/quit' || trimmed === '/exit') { quit(); return; }
    view = beginAssistant(pushUser(view, trimmed));
    render();
    void client.send(trimmed).catch((e: Error) => { view = reduce(view, { type: 'error', message: e.message }); render(); });
  };

  tui.addChild(header);
  tui.addChild(messages);
  tui.addChild(loader);
  tui.addChild(editor);
  tui.setFocus(editor);

  const ac = new AbortController();
  let done: () => void;
  const finished = new Promise<void>((r) => { done = r; });
  const quit = (): void => { ac.abort(); tui.stop(); done(); };

  // Global ctrl+c → quit (in raw mode SIGINT arrives as a key, not a signal).
  tui.addInputListener((data) => (matchesKey(data, 'ctrl+c') ? (quit(), { consume: true }) : undefined));

  tui.start();
  render();

  // Live event stream in the background; each event folds into the view and re-renders.
  void client.stream((e) => { view = reduce(view, e); render(); }, ac.signal).catch(() => { /* aborted/gone */ });

  await finished;
}
