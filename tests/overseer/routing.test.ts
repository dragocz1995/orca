import { describe, it, expect } from 'vitest';
import { resolveExecutor } from '../../src/overseer/routing.js';

const FB = { program: 'claude-code', model: 'sonnet' };
describe('resolveExecutor', () => {
  it('routes exec:provider/model to opencode', () => {
    expect(resolveExecutor(['exec:ollama/deepseek-v4-flash'], FB)).toEqual({ program: 'opencode', model: 'ollama/deepseek-v4-flash' });
  });
  it('routes bare exec:sonnet to claude', () => {
    expect(resolveExecutor(['exec:sonnet'], FB)).toEqual({ program: 'claude-code', model: 'sonnet' });
  });
  it('routes explicit exec:codex:<model> to codex', () => {
    expect(resolveExecutor(['exec:codex:gpt-5.4'], FB)).toEqual({ program: 'codex', model: 'gpt-5.4' });
  });
  it('falls back when no exec label', () => {
    expect(resolveExecutor(['type:bug'], FB)).toEqual(FB);
  });
});
