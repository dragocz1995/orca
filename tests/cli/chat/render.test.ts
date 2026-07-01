import { describe, it, expect } from 'vitest';
import { emptyView, fromHistory, pushUser, beginAssistant, reduce } from '../../../src/cli/chat/render.js';

describe('chat render reducer', () => {
  it('builds a view from history, dropping empty turns', () => {
    const v = fromHistory([{ role: 'user', text: 'hi' }, { role: 'assistant', text: '' }, { role: 'assistant', text: 'yo' }]);
    expect(v.turns).toEqual([
      { role: 'you', text: 'hi', tools: [], streaming: false },
      { role: 'orca', text: 'yo', tools: [], streaming: false },
    ]);
  });

  it('streams text deltas into one assistant turn', () => {
    let v = beginAssistant(pushUser(emptyView(), 'ahoj'));
    v = reduce(v, { type: 'text', delta: 'a' });
    v = reduce(v, { type: 'text', delta: 'hoj' });
    expect(v.turns.at(-1)).toMatchObject({ role: 'orca', text: 'ahoj', streaming: true });
    expect(v.thinking).toBe(true);
  });

  it('records tool calls on the assistant turn', () => {
    let v = beginAssistant(emptyView());
    v = reduce(v, { type: 'tool', name: 'orca_create_task' });
    expect(v.turns.at(-1)!.tools).toEqual(['orca_create_task']);
  });

  it('idle finalizes the turn and stops thinking', () => {
    let v = beginAssistant(emptyView());
    v = reduce(v, { type: 'text', delta: 'done' });
    v = reduce(v, { type: 'idle' });
    expect(v.turns.at(-1)).toMatchObject({ streaming: false });
    expect(v.thinking).toBe(false);
  });

  it('creates an assistant turn if a text event arrives with none open', () => {
    const v = reduce(emptyView(), { type: 'text', delta: 'hi' });
    expect(v.turns).toHaveLength(1);
    expect(v.turns[0]).toMatchObject({ role: 'orca', text: 'hi' });
  });

  it('error appends a note and stops', () => {
    const v = reduce(beginAssistant(emptyView()), { type: 'error', message: 'boom' });
    expect(v.turns.at(-1)!.text).toContain('boom');
    expect(v.thinking).toBe(false);
  });
});
