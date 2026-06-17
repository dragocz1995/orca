import { describe, it, expect } from 'vitest';
import { detectGuardrails, isCleared } from '../../src/overseer/guardrails.js';

describe('guardrails', () => {
  it('detects categories from task text', () => {
    expect(detectGuardrails('Add a DB migration for the auth table')).toEqual(expect.arrayContaining(['migration', 'auth']));
  });
  it('isCleared requires every triggered guardrail to be cleared', () => {
    expect(isCleared(['auth'], ['auth', 'schema'])).toBe(true);
    expect(isCleared(['auth', 'payments'], ['auth'])).toBe(false);
    expect(isCleared([], [])).toBe(true);
  });
});
