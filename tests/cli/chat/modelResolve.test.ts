import { describe, it, expect } from 'vitest';
import { fuzzyScore, resolveModelQuery, type ModelOption } from '../../../src/cli/chat/fuzzy.js';

describe('fuzzyScore', () => {
  it('ranks exact > prefix > substring > description > subsequence > none', () => {
    expect(fuzzyScore('model', 'model')).toBe(100);
    expect(fuzzyScore('mod', 'model')).toBe(80);
    expect(fuzzyScore('ode', 'model')).toBe(60);
    expect(fuzzyScore('xyz', 'model', 'a model xyz thing')).toBe(35);
    expect(fuzzyScore('mdl', 'model')).toBe(20);
    expect(fuzzyScore('zzz', 'model')).toBe(0);
  });
  it('is case-insensitive and ignores surrounding whitespace', () => {
    expect(fuzzyScore('  GPT ', 'gpt-5.5')).toBe(80);
  });
  it('an empty query matches everything weakly', () => {
    expect(fuzzyScore('', 'anything')).toBe(1);
  });
});

const M = (provider: string, model: string): ModelOption => ({ provider, providerLabel: provider, model });

describe('resolveModelQuery', () => {
  const models: ModelOption[] = [
    M('anthropic', 'claude-opus-4-8'),
    M('openai', 'gpt-5.5-turbo'),
  ];

  it('fuzzy-fixes a partial name to the best model', () => {
    expect(resolveModelQuery(models, 'gpt-5.5')).toEqual({ provider: 'openai', model: 'gpt-5.5-turbo' });
  });
  it('matches a substring anywhere in the id', () => {
    expect(resolveModelQuery(models, 'opus')).toEqual({ provider: 'anthropic', model: 'claude-opus-4-8' });
  });
  it('returns null for a query too weak to auto-apply (opens the picker instead)', () => {
    expect(resolveModelQuery(models, 'zzz')).toBeNull();
  });
  it('returns null when there are no models', () => {
    expect(resolveModelQuery([], 'gpt')).toBeNull();
  });
});
