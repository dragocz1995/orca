import { describe, it, expect, beforeEach } from 'vitest';
import { loadPty, resetPtyLoader } from '../../src/terminal/ptyLoader.js';

describe('loadPty', () => {
  beforeEach(() => resetPtyLoader());

  it('returns null when the module is absent', async () => {
    expect(await loadPty(() => Promise.reject(new Error('Cannot find module')))).toBeNull();
  });

  it('returns null when the import lacks a spawn function', async () => {
    expect(await loadPty(() => Promise.resolve({}))).toBeNull();
  });

  it('returns the module when import resolves to a spawn fn', async () => {
    const fake = { spawn: () => ({}) };
    expect(await loadPty(() => Promise.resolve(fake))).toBe(fake);
  });

  it('caches the first probe', async () => {
    const fake = { spawn: () => ({}) };
    await loadPty(() => Promise.resolve(fake));
    // A later call with a rejecting importer still returns the cached module.
    expect(await loadPty(() => Promise.reject(new Error('nope')))).toBe(fake);
  });
});
