import { describe, it, expect } from 'vitest';
import { taskExec } from '../../lib/taskExec';

describe('taskExec', () => {
  it('returns the exec label value', () => {
    expect(taskExec(['area:ui', 'exec:codex:gpt-5.4'])).toBe('codex:gpt-5.4');
  });
  it('returns empty string when absent or undefined', () => {
    expect(taskExec(['area:ui'])).toBe('');
    expect(taskExec(undefined)).toBe('');
  });
});
