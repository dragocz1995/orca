import { describe, it, expect } from 'vitest';
import { composeLabel, LONG_COMPOSE_TOOLS } from '../../../src/cli/chat/composeLabels.js';

/** Every label is at most four whitespace-separated words and ends with the ellipsis char. */
const wellFormed = (label: string): void => {
  expect(label.endsWith('…')).toBe(true);
  expect(label.trim().split(/\s+/).length).toBeLessThanOrEqual(4);
};

describe('composeLabel', () => {
  it('localizes a file write with its target in en and cs', () => {
    expect(composeLabel('Write', 'readme.md', 'en')).toBe('Writing file readme.md…');
    expect(composeLabel('Write', 'readme.md', 'cs')).toBe('Píšu soubor readme.md…');
  });

  it('localizes an edit and a command', () => {
    expect(composeLabel('Edit', 'a.ts', 'en')).toBe('Editing file a.ts…');
    expect(composeLabel('Edit', 'a.ts', 'cs')).toBe('Upravuji soubor a.ts…');
    expect(composeLabel('Bash', 'npm test', 'en')).toBe('Running command npm test…');
    expect(composeLabel('Bash', 'npm test', 'cs')).toBe('Spouštím příkaz npm test…');
  });

  it('reduces a WebFetch URL detail to its host', () => {
    expect(composeLabel('WebFetch', 'https://example.com/a/b?q=1', 'en')).toBe('Fetching example.com…');
    expect(composeLabel('WebFetch', 'https://example.com/a/b?q=1', 'cs')).toBe('Načítám example.com…');
  });

  it('returns the name-only phrase when the detail has not streamed yet', () => {
    expect(composeLabel('Write', undefined, 'en')).toBe('Writing file…');
    expect(composeLabel('Write', '', 'cs')).toBe('Píšu soubor…');
    // Detail-less tools (Delegate, workflow, image) are always name-only.
    expect(composeLabel('Delegate', 'agent-0 do the thing', 'cs')).toBe('Spouštím sub-agenta…');
    expect(composeLabel('GenerateImage', undefined, 'cs')).toBe('Generuji obrázek…');
  });

  it('returns undefined for a tool NOT on the long-duration allow-list (caller keeps today\'s output)', () => {
    expect(composeLabel('Read', 'a.ts', 'en')).toBeUndefined();
    expect(composeLabel('Search', 'foo', 'cs')).toBeUndefined();
    expect(composeLabel('ListDir', 'src', 'en')).toBeUndefined();
    expect(composeLabel(undefined, 'x', 'en')).toBeUndefined();
    expect(LONG_COMPOSE_TOOLS.has('Read')).toBe(false);
    expect(LONG_COMPOSE_TOOLS.has('Write')).toBe(true);
  });

  it('keeps every label ≤4 words and ellipsis-terminated, clamping a long detail', () => {
    for (const locale of ['en', 'cs'] as const) {
      wellFormed(composeLabel('Bash', 'git commit --amend --no-edit -m x', locale)!);
      wellFormed(composeLabel('WebSearch', 'how to do a very long query here', locale)!);
      wellFormed(composeLabel('Write', 'src/some/deeply/nested/very/long/path/module.ts', locale)!);
      for (const tool of LONG_COMPOSE_TOOLS) wellFormed(composeLabel(tool, undefined, locale)!);
    }
  });
});
