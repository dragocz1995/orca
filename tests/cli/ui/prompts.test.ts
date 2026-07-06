import { describe, expect, it } from 'vitest';
import { printableInput } from '../../../src/cli/ui/prompts.js';
import { formatK, padAnsi } from '../../../src/cli/ui/text.js';

describe('cli prompt input helpers', () => {
  it('unwraps bracketed paste chunks and drops control characters', () => {
    expect(printableInput('\x1b[200~sk-live-key\n\t\x00\x1b[201~')).toBe('sk-live-key');
  });

  it('accepts regular multi-character printable input', () => {
    expect(printableInput('hello world')).toBe('hello world');
  });

  it('ignores escape/control sequences that are not paste', () => {
    expect(printableInput('\x1b[A')).toBe('');
  });
});

describe('cli text helpers', () => {
  it('pads ansi text to a visible width', () => {
    expect(padAnsi('\x1b[31mhi\x1b[0m', 4)).toBe('\x1b[31mhi\x1b[0m  ');
  });

  it('formats compact token counts', () => {
    expect(formatK(999)).toBe('999');
    expect(formatK(34_567)).toBe('35k');
    expect(formatK(1_234_567)).toBe('1.2M');
  });
});
