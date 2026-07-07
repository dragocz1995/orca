import { describe, it, expect } from 'vitest';
import { stripInlineReasoning, extractText, toolOutputView } from '../../src/brain/messageView.js';

describe('stripInlineReasoning', () => {
  it('leaves text without reasoning tags untouched', () => {
    expect(stripInlineReasoning('just a normal answer')).toBe('just a normal answer');
  });

  it('removes a complete <think>…</think> block, keeping the answer', () => {
    expect(stripInlineReasoning('<think>let me reason\nabout this</think>\n\nThe answer is 42.')).toBe('The answer is 42.');
    expect(stripInlineReasoning('<thinking>hmm</thinking>Hello')).toBe('Hello');
  });

  it('removes an unclosed trailing reasoning block (stream cut off before the answer)', () => {
    expect(stripInlineReasoning('<think>still reasoning and never closed')).toBe('');
  });

  it('drops reasoning that streamed before a lone closing tag', () => {
    expect(stripInlineReasoning('reasoning with no open tag</think>\n\nFinal answer.')).toBe('Final answer.');
  });

  it('handles multiple blocks and preserves interleaved answer text', () => {
    expect(stripInlineReasoning('<think>a</think>one<think>b</think>two')).toBe('onetwo');
  });
});

describe('extractText strips leaked reasoning', () => {
  it('sanitizes an array-content assistant message', () => {
    const msg = { content: [{ type: 'text', text: '<think>secret</think>visible' }] };
    expect(extractText(msg)).toBe('visible');
  });
  it('sanitizes a string-content message', () => {
    expect(extractText({ content: '<think>x</think>ok' })).toBe('ok');
  });
});

describe('toolOutputView', () => {
  it('shows isError tool results even when the text lacks error keywords', () => {
    const out = toolOutputView('plugin_call', {}, { isError: true, content: [{ type: 'text', text: 'Unauthorized' }] });
    expect(out).toMatchObject({ tone: 'warning', text: 'Unauthorized', status: 'needs attention' });
  });

  it('keeps only a compact tail of long command output', () => {
    const text = Array.from({ length: 12 }, (_, i) => `line ${i + 1}`).join('\n');
    const out = toolOutputView('run_command', { command: 'printf' }, { content: [{ type: 'text', text }], details: { exitCode: 0 } });
    expect(out?.text).toContain('6 earlier lines hidden');
    expect(out?.fullText).toContain('line 1');
    expect(out?.text).toContain('line 12');
    expect(out?.text).not.toContain('line 1\n');
  });

  it('always surfaces a shell command on the first line, even when it exited silently', () => {
    const out = toolOutputView('run_command', { command: 'mkdir -p build' }, { content: [{ type: 'text', text: '' }], details: { exitCode: 0 } });
    expect(out).toBeDefined();
    expect(out?.command).toBe('mkdir -p build');
    expect(out?.kind).toBe('console');
    expect(out?.status).toBe('exit 0');
  });

  it('marks a silent successful shell command as done when no exit code is reported', () => {
    const out = toolOutputView('bash', { command: 'cd /tmp' }, { content: [{ type: 'text', text: '' }] });
    expect(out?.command).toBe('cd /tmp');
    expect(out?.status).toBe('done');
  });

  it('still hides a non-console tool that produced no useful output', () => {
    const out = toolOutputView('read_file', { path: 'a.ts' }, { content: [{ type: 'text', text: '' }] });
    expect(out).toBeUndefined();
  });
});

describe('toolOutputView — hook-appended notes (details.notes)', () => {
  it('a diff result stays hidden without notes, but yields a notes-only view WITH them', () => {
    const base = { content: [{ type: 'text', text: 'Edited a.ts' }], details: { diff: '+    1 x' } };
    expect(toolOutputView('edit_file', { path: 'a.ts' }, base)).toBeUndefined();
    const out = toolOutputView('edit_file', { path: 'a.ts' }, { ...base, details: { ...base.details, notes: ['formatted a.ts with prettier'] } });
    expect(out).toMatchObject({ kind: 'result', text: '', tone: 'normal', notes: ['formatted a.ts with prettier'] });
  });

  it('notes earn an otherwise-hidden non-console result its block and ride a shown one', () => {
    const hidden = toolOutputView('write_file', { path: 'a.ts' }, { content: [{ type: 'text', text: '' }], details: { notes: ['formatted a.ts with prettier'] } });
    expect(hidden?.notes).toEqual(['formatted a.ts with prettier']);
    const shown = toolOutputView('run_command', { command: 'x' }, { content: [{ type: 'text', text: 'out' }], details: { exitCode: 0, notes: ['note'] } });
    expect(shown).toMatchObject({ text: 'out', notes: ['note'] });
  });

  it('validates the untrusted notes array: non-strings dropped, whitespace collapsed, capped at 5', () => {
    const notes = [' a  note ', 42, '', 'b', 'c', 'd', 'e', 'f'];
    const out = toolOutputView('write_file', { path: 'a.ts' }, { content: [], details: { diff: '+ x', notes } });
    expect(out?.notes).toEqual(['a note', 'b', 'c', 'd', 'e']);
    // A non-array (or all-invalid) notes value contributes nothing — the diff result stays hidden.
    expect(toolOutputView('write_file', {}, { content: [], details: { diff: '+ x', notes: 'nope' } })).toBeUndefined();
    expect(toolOutputView('write_file', {}, { content: [], details: { diff: '+ x', notes: [42, '  '] } })).toBeUndefined();
  });
});

describe('tool output tone (needs attention)', () => {
  it('a clean exit 0 is success even when the output mentions errors/warnings', () => {
    const v = toolOutputView('run_command', { command: 'grep -rn error src' }, {
      content: [{ type: 'text', text: 'src/a.ts: handleError()\nnpm warn deprecated foo@1' }],
      details: { exitCode: 0 },
    });
    expect(v?.tone).toBe('success');
    expect(v?.status).toBe('exit 0');
  });

  it('a non-zero exit stays a warning', () => {
    const v = toolOutputView('run_command', { command: 'false' }, { content: [], details: { exitCode: 2 } });
    expect(v?.tone).toBe('warning');
  });

  it('without an exit code, prose merely mentioning "error" does not flag the row', () => {
    const v = toolOutputView('run_command', { command: 'cat notes.txt' }, {
      content: [{ type: 'text', text: 'the error handling chapter explains retries' }],
    });
    expect(v?.tone).not.toBe('warning');
  });

  it('without an exit code, a line starting with Error still warns', () => {
    const v = toolOutputView('run_command', { command: 'node x' }, {
      content: [{ type: 'text', text: 'Error: connect ECONNREFUSED' }],
    });
    expect(v?.tone).toBe('warning');
  });
});
