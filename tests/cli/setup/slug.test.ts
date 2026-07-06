import { describe, it, expect } from 'vitest';
import { deriveSlug, uniqueSlug } from '../../../src/cli/setup/slug.js';

describe('cli/setup.deriveSlug', () => {
  it('kebab-cases a folder basename', () => {
    expect(deriveSlug('/home/u/My App')).toBe('my-app');
  });
  it('strips accents (NFKD)', () => {
    expect(deriveSlug('/home/u/Můj-Projekt')).toBe('muj-projekt');
  });
  it('ignores trailing slashes', () => {
    expect(deriveSlug('/home/u/foo/')).toBe('foo');
  });
  it('collapses runs and trims edge dashes', () => {
    expect(deriveSlug('/x/__weird...name__')).toBe('weird-name');
  });
  it('falls back to "project" when nothing usable remains', () => {
    expect(deriveSlug('/x/!!!')).toBe('project');
    expect(deriveSlug('/')).toBe('project');
  });
});

describe('cli/setup.uniqueSlug', () => {
  it('returns the base when free', () => {
    expect(uniqueSlug('app', new Set())).toBe('app');
  });
  it('bumps a numeric suffix on clash', () => {
    expect(uniqueSlug('app', new Set(['app']))).toBe('app-2');
    expect(uniqueSlug('app', new Set(['app', 'app-2', 'app-3']))).toBe('app-4');
  });
});
