import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'app', 'globals.css'), 'utf-8');

describe('design tokens', () => {
  it('defines the depth tokens', () => {
    for (const t of ['--text-display', '--text-h1', '--text-h2', '--text-body', '--text-caption', '--shadow-card', '--shadow-raised', '--motion-fast', '--motion-base', '--ease-out']) {
      expect(css).toContain(t);
    }
  });
});
