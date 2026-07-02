import type { BrainEvent, BrainMessageView } from '../../brain/brainService.js';

/** An assistant turn is an ordered list of segments so text and tool calls render in the sequence they
 *  happened. Consecutive tool calls (no new text between them) collapse into ONE tools segment — the
 *  Claude-Code "grouped" look. Tool OUTPUT is never shown, only the invoked tool names. */
type Segment = { kind: 'text'; text: string } | { kind: 'tools'; names: string[] };
type YouTurn = { role: 'you'; text: string };
type OrcaTurn = { role: 'orca'; segments: Segment[]; streaming: boolean };
type ChatTurn = YouTurn | OrcaTurn;

/** The whole view model the TUI renders. Pure data — the reducer never touches the terminal. */
export interface ChatView { turns: ChatTurn[]; thinking: boolean }

export const emptyView = (): ChatView => ({ turns: [], thinking: false });

/** Build the initial view from stored history (user → you, everything else → orca). */
export function fromHistory(msgs: BrainMessageView[]): ChatView {
  const turns: ChatTurn[] = msgs
    .filter((m) => m.text.trim().length > 0)
    .map((m): ChatTurn => (m.role === 'user'
      ? { role: 'you', text: m.text }
      : { role: 'orca', segments: [{ kind: 'text', text: m.text }], streaming: false }));
  return { turns, thinking: false };
}

/** Append the user's turn (finalized) — called optimistically when they hit enter. */
export function pushUser(view: ChatView, text: string): ChatView {
  return { ...view, turns: [...view.turns, { role: 'you', text }] };
}

/** Open a fresh streaming assistant turn and switch on the thinking indicator. */
export function beginAssistant(view: ChatView): ChatView {
  return { thinking: true, turns: [...view.turns, { role: 'orca', segments: [], streaming: true }] };
}

/** Fold one brain event into the view. Pure: returns a new ChatView, never mutates the input. */
export function reduce(view: ChatView, e: BrainEvent): ChatView {
  const turns = view.turns.slice();
  // Return a live streaming assistant turn, creating one if the last turn isn't it.
  const ensureOrca = (): OrcaTurn => {
    const last = turns[turns.length - 1];
    if (last && last.role === 'orca' && last.streaming) {
      const clone: OrcaTurn = { role: 'orca', segments: [...last.segments], streaming: true };
      turns[turns.length - 1] = clone;
      return clone;
    }
    const fresh: OrcaTurn = { role: 'orca', segments: [], streaming: true };
    turns.push(fresh);
    return fresh;
  };
  const addText = (t: OrcaTurn, delta: string): void => {
    const tail = t.segments[t.segments.length - 1];
    if (tail?.kind === 'text') t.segments[t.segments.length - 1] = { kind: 'text', text: tail.text + delta };
    else t.segments.push({ kind: 'text', text: delta });
  };
  switch (e.type) {
    case 'text': {
      addText(ensureOrca(), e.delta);
      return { turns, thinking: true };
    }
    case 'tool': {
      const t = ensureOrca();
      const tail = t.segments[t.segments.length - 1];
      if (tail?.kind === 'tools') t.segments[t.segments.length - 1] = { kind: 'tools', names: [...tail.names, e.name] };
      else t.segments.push({ kind: 'tools', names: [e.name] });
      return { turns, thinking: true };
    }
    case 'idle': {
      const last = turns[turns.length - 1];
      if (last && last.role === 'orca') turns[turns.length - 1] = { ...last, streaming: false };
      return { turns, thinking: false };
    }
    case 'error': {
      const t = ensureOrca();
      addText(t, `\n[error: ${e.message}]`);
      t.streaming = false;
      return { turns, thinking: false };
    }
    default:
      return view;
  }
}
