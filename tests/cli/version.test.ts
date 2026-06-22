import { describe, it, expect } from 'vitest';
import { isNewer } from '../../src/cli/version.js';

describe('cli/version.isNewer', () => {
  it('detects a newer patch/minor/major', () => {
    expect(isNewer('1.2.0', '1.1.9')).toBe(true);
    expect(isNewer('2.0.0', '1.9.9')).toBe(true);
  });
  it('is false for equal or older', () => {
    expect(isNewer('1.2.0', '1.2.0')).toBe(false);
    expect(isNewer('1.1.0', '1.2.0')).toBe(false);
  });
  it('compares segments numerically, not lexically', () => {
    expect(isNewer('1.10.0', '1.9.0')).toBe(true);
  });
  it('tolerates a v prefix and differing segment counts', () => {
    expect(isNewer('v1.2.0', '1.2.0')).toBe(false);
    expect(isNewer('1.2', '1.1.5')).toBe(true);
    expect(isNewer('1.2.1', '1.2')).toBe(true);
  });
});
