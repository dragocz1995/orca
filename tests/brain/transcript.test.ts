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

describe('transcript fold: subagent progress', () => {
  const delegateCall = (): ChatView => {
    let v = pushUser(emptyView(), 'do it');
    v = beginAssistant(v);
    return reduce(v, { type: 'tool', name: 'delegate', detail: 'research the config', id: 'call-1' });
  };

  it('attaches live progress to the matching delegate tool item by call id', () => {
    const v = reduce(delegateCall(), {
      type: 'subagent', id: 'call-1', sessionId: 'brain-ch-subagent-sub-x', status: 'running',
      task: 'research the config', detail: 'read_file src/a.ts', tools: 2, tokens: 1500, seconds: 7,
    });
    const turn = v.turns[v.turns.length - 1]!;
    if (turn.role !== 'orca') throw new Error('expected orca turn');
    const seg = turn.segments.find((s) => s.kind === 'tools');
    if (seg?.kind !== 'tools') throw new Error('expected tools segment');
    expect(seg.items[0]!.sub).toMatchObject({
      sessionId: 'brain-ch-subagent-sub-x', status: 'running', detail: 'read_file src/a.ts', tools: 2, tokens: 1500, seconds: 7,
    });
  });

  it('a later update replaces the previous state (done settles the row)', () => {
    let v = reduce(delegateCall(), { type: 'subagent', id: 'call-1', sessionId: 's', status: 'running', task: 't', tools: 1, seconds: 2 });
    v = reduce(v, { type: 'subagent', id: 'call-1', sessionId: 's', status: 'done', task: 't', tools: 5, tokens: 9000, seconds: 31 });
    const turn = v.turns[v.turns.length - 1]!;
    if (turn.role !== 'orca') throw new Error('expected orca turn');
    const seg = turn.segments.find((s) => s.kind === 'tools');
    if (seg?.kind !== 'tools') throw new Error('expected tools segment');
    expect(seg.items[0]!.sub).toMatchObject({ status: 'done', tools: 5, tokens: 9000, seconds: 31 });
  });

  it('an update with an unknown call id is a safe no-op', () => {
    const before = delegateCall();
    const after = reduce(before, { type: 'subagent', id: 'other', sessionId: 's', status: 'running', task: 't', tools: 0, seconds: 0 });
    const turn = after.turns[after.turns.length - 1]!;
    if (turn.role !== 'orca') throw new Error('expected orca turn');
    const seg = turn.segments.find((s) => s.kind === 'tools');
    if (seg?.kind !== 'tools') throw new Error('expected tools segment');
    expect(seg.items[0]!.sub).toBeUndefined();
  });
});
