import { describe, it, expect } from 'vitest';
import { reduce, pushUser, beginAssistant, emptyView } from '../../src/brain/transcript.js';
import type { ChatView } from '../../src/brain/transcript.js';

describe('transcript fold: session (idle rollover)', () => {
  it('restarts the transcript at the turn that triggered the rollover', () => {
    // Old conversation on screen, then the user sends (optimistic push + streaming turn, the CLI shape).
    let view: ChatView = {
      turns: [
        { role: 'you', text: 'yesterday' },
        { role: 'orca', segments: [{ kind: 'text', text: 'old answer' }], streaming: false },
      ],
      thinking: false,
    };
    view = beginAssistant(pushUser(view, 'today'));
    view = reduce(view, { type: 'session', sessionId: 'brain-1-x' });
    expect(view.turns).toEqual([
      { role: 'you', text: 'today' },
      { role: 'orca', segments: [], streaming: true },
    ]);
    expect(view.thinking).toBe(true); // the turn keeps streaming in the fresh session
    // The reply then folds into the kept streaming turn as usual.
    view = reduce(view, { type: 'text', delta: 'fresh answer' });
    expect(view.turns).toHaveLength(2);
  });

  it('clears everything when no user turn is present (defensive)', () => {
    const view = reduce({ turns: [{ role: 'orca', segments: [{ kind: 'text', text: 'x' }], streaming: false }], thinking: false }, { type: 'session', sessionId: 's' });
    expect(view.turns).toEqual([]);
  });

  it('is a no-op on an empty view', () => {
    expect(reduce(emptyView(), { type: 'session', sessionId: 's' }).turns).toEqual([]);
  });
});
