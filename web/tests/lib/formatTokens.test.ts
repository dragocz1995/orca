import { describe, it, expect } from 'vitest';
import { formatTokens } from '../../lib/formatTokens';

describe('formatTokens', () => {
  it('shows raw counts below 1k', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(950)).toBe('950');
  });
  it('shows one decimal k below 10k, whole k below 1M', () => {
    expect(formatTokens(1234)).toBe('1.2k');
    expect(formatTokens(12345)).toBe('12k');
    expect(formatTokens(999_000)).toBe('999k');
  });
  it('shows M above a million', () => {
    expect(formatTokens(1_250_000)).toBe('1.3M');
  });
  it('guards non-finite and negative inputs', () => {
    expect(formatTokens(NaN)).toBe('0');
    expect(formatTokens(-5)).toBe('0');
  });
});
