import { describe, it, expect } from 'vitest';
import { visibleWidth } from '@earendil-works/pi-tui';
import { createKeymap } from '../../../src/cli/chat/keys.js';
import {
  bottomHintItems, bottomHints, fitSegments, fitVariants, startScreenHintItems, startScreenHints,
} from '../../../src/cli/chat/chatComposition.js';
import { StatusBar } from '../../../src/cli/chat/components.js';

const seg = (text: string, priority: number): { text: string; priority: number } => ({ text, priority });

describe('fitSegments', () => {
  const items = [seg('send', 100), seg('slash', 80), seg('files', 60), seg('mode', 40), seg('reasoning', 20)];

  it('returns the full joined line when it fits', () => {
    expect(fitSegments(items, 200)).toBe('send   ·   slash   ·   files   ·   mode   ·   reasoning');
  });

  it('drops the lowest-priority segment first as width shrinks', () => {
    const fitted = fitSegments(items, 40);
    expect(fitted).toBe('send   ·   slash   ·   files   ·   mode');
    expect(fitSegments(items, 30)).toBe('send   ·   slash   ·   files');
  });

  it('never exceeds the width once a drop is possible', () => {
    for (let width = 8; width < 60; width++) {
      const fitted = fitSegments(items, width);
      // The single survivor may legitimately overflow; anything with a separator must fit.
      if (fitted.includes('·')) expect(visibleWidth(fitted)).toBeLessThanOrEqual(width);
    }
  });

  it('keeps at least one segment, returned whole', () => {
    expect(fitSegments(items, 3)).toBe('send');
    expect(fitSegments([seg('a-very-long-primary', 100)], 5)).toBe('a-very-long-primary');
  });

  it('breaks priority ties rightmost', () => {
    const tied = [seg('one', 10), seg('two', 10), seg('three', 10)];
    expect(fitSegments(tied, 16)).toBe('one   ·   two');
  });

  it('preserves the original order of survivors', () => {
    const fitted = fitSegments([seg('a', 50), seg('b', 10), seg('c', 90)], 12);
    expect(fitted).toBe('a   ·   c');
  });

  it('skips empty segments and honors a custom separator', () => {
    expect(fitSegments([seg('a', 10), seg('', 100), seg('b', 20)], 200, ' · ')).toBe('a · b');
  });
});

describe('fitVariants', () => {
  it('picks the first candidate that fits', () => {
    expect(fitVariants(['12345678', '12345', '12'], 5)).toBe('12345');
  });

  it('falls back to the most reduced candidate when nothing fits', () => {
    expect(fitVariants(['12345678', '12345'], 2)).toBe('12345');
    expect(fitVariants([], 10)).toBe('');
  });
});

describe('bottomHintItems priorities', () => {
  const keymap = createKeymap();

  it('keeps the primary action at the top priority in every state', () => {
    const top = (state: 'child' | 'thinking' | 'idle'): number =>
      Math.max(...bottomHintItems(keymap, state).map((s) => s.priority));
    expect(bottomHintItems(keymap, 'idle').find((s) => s.text === '⏎ send')?.priority).toBe(top('idle'));
    expect(bottomHintItems(keymap, 'thinking').find((s) => s.text === 'esc interrupt')?.priority).toBe(top('thinking'));
    expect(bottomHintItems(keymap, 'child').find((s) => s.text.startsWith('⏎'))?.priority).toBe(top('child'));
  });

  it('drops secondary idle hints before / slash', () => {
    const items = bottomHintItems(keymap, 'idle');
    const priorityOf = (prefix: string): number => items.find((s) => s.text.startsWith(prefix))!.priority;
    expect(priorityOf('ctrl+p')).toBeLessThan(priorityOf('ctrl+r'));
    expect(priorityOf('ctrl+r')).toBeLessThan(priorityOf('/'));
  });

  it('bottomHints stays the full joined form of the items', () => {
    expect(bottomHints(keymap, 'idle')).toBe(bottomHintItems(keymap, 'idle').map((s) => s.text).join('   ·   '));
    expect(startScreenHints(keymap)).toBe(startScreenHintItems(keymap).map((s) => s.text).join(' · '));
  });
});

describe('StatusBar adaptive left', () => {
  it('drops whole segments instead of cutting text mid-word', () => {
    const bar = new StatusBar('', 'ctrl+c quit');
    bar.setLeftFit((w) => `  ${fitSegments(bottomHintItems(createKeymap(), 'idle'), Math.max(0, w - 2))}`);
    const wide = bar.render(160)[0]!;
    const narrow = bar.render(46)[0]!;
    expect(wide).toContain('⏎ send');
    expect(wide).toContain('telemetry');
    // Narrow: some segments are gone entirely, the survivors are whole words, and the row fits.
    expect(narrow).not.toContain('telemetry');
    expect(narrow).toContain('⏎ send');
    expect(visibleWidth(narrow)).toBeLessThanOrEqual(46);
    expect(narrow).not.toMatch(/[a-z]…/); // no mid-word ellipsis
  });

  it('setLeft overrides and clears the fitter', () => {
    const bar = new StatusBar('', '');
    bar.setLeftFit(() => 'fitted');
    expect(bar.render(20)[0]).toContain('fitted');
    bar.setLeft('static');
    expect(bar.render(20)[0]).toContain('static');
  });
});
