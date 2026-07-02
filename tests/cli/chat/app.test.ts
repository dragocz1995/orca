import { describe, it, expect } from 'vitest';
import { viewToPlainText } from '../../../src/cli/chat/app.js';
import { beginAssistant, pushUser, reduce, emptyView } from '../../../src/cli/chat/render.js';

describe('viewToPlainText', () => {
  it('renders user and orca turns with labels, tools and text', () => {
    let v = beginAssistant(pushUser(emptyView(), 'ahoj'));
    v = reduce(v, { type: 'tool', name: 'orca_create_task' });
    v = reduce(v, { type: 'text', delta: 'hotovo' });
    const lines = viewToPlainText(v);
    expect(lines).toContain('ty');
    expect(lines.some((l) => l.includes('ahoj'))).toBe(true);
    expect(lines.some((l) => l.includes('⚙ orca_create_task'))).toBe(true);
    expect(lines.some((l) => l.includes('hotovo'))).toBe(true);
  });
});

describe('parseCommand', () => {
  it('routes slash commands and passes the resume argument through', async () => {
    const { parseCommand } = await import('../../../src/cli/chat/app.js');
    expect(parseCommand('/new')).toEqual({ cmd: 'new' });
    expect(parseCommand('/sessions')).toEqual({ cmd: 'sessions' });
    expect(parseCommand('/resume 2')).toEqual({ cmd: 'resume', arg: '2' });
    expect(parseCommand('/quit')).toEqual({ cmd: 'quit' });
    expect(parseCommand('/exit')).toEqual({ cmd: 'quit' });
    expect(parseCommand('/help')).toEqual({ cmd: 'help' });
    expect(parseCommand('/unknown')).toBeNull();
    expect(parseCommand('běžná zpráva')).toBeNull();
  });
});
