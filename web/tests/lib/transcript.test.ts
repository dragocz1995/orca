import { describe, expect, it } from 'vitest';
import { emptyView, reduce } from '../../lib/transcript';

describe('web transcript reducer', () => {
  it('attaches diff and tool output by tool call id', () => {
    let view = emptyView();
    view = reduce(view, { type: 'tool', name: 'first', id: 'a' });
    view = reduce(view, { type: 'tool', name: 'second', id: 'b' });
    view = reduce(view, { type: 'tool_output', id: 'a', output: { title: 'console output', kind: 'console', text: 'A done' } });
    view = reduce(view, { type: 'diff', id: 'b', diff: '-old\n+new' });

    const turn = view.turns.at(-1);
    expect(turn?.role === 'orca' && turn.segments).toEqual([
      { kind: 'tools', items: [
        { name: 'first', detail: undefined, icon: undefined, id: 'a', output: { title: 'console output', kind: 'console', text: 'A done' } },
        { name: 'second', detail: undefined, icon: undefined, id: 'b', diff: '-old\n+new' },
      ] },
    ]);
  });
});
