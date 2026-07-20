import { describe, it, expect } from 'vitest';
import { queryInt } from '../../src/api/validation.js';

describe('queryInt', () => {
  it('falls back when the param is absent, empty, or non-numeric (never NaN to a store)', () => {
    expect(queryInt(undefined, { fallback: 7 })).toBe(7);
    expect(queryInt('', { fallback: 7 })).toBe(7);
    expect(queryInt('abc', { fallback: 7 })).toBe(7);
    expect(queryInt('abc', { fallback: undefined })).toBeUndefined();
    expect(queryInt(undefined, { fallback: undefined })).toBeUndefined();
  });

  it('floors and clamps a present value to [min, max]', () => {
    expect(queryInt('12.9', { fallback: 0 })).toBe(12);
    expect(queryInt('1000', { min: 1, max: 500, fallback: 30 })).toBe(500);
    expect(queryInt('0', { min: 1, max: 500, fallback: 30 })).toBe(1);
    expect(queryInt('50', { min: 1, max: 500, fallback: 30 })).toBe(50);
    expect(queryInt('-5', { min: 0, fallback: undefined })).toBe(0);
  });
});
