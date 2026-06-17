import { describe, it, expect } from 'vitest';
import { uniqueName } from '../../src/daemon/uniqueName.js';

describe('uniqueName', () => {
  it('never returns the same name twice in a run', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) seen.add(uniqueName());
    expect(seen.size).toBe(1000);
  });
});
