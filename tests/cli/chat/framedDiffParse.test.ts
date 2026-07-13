import { describe, it, expect, vi, beforeAll } from 'vitest';
import { initTheme } from '@earendil-works/pi-coding-agent';

// Wrap the terminal-text sanitizer with a spy so we can count how many times a diff is parsed. The whole
// framed-diff path must scan a diff exactly once (it used to run terminalPlainText over it 4×: two
// hasHiddenDiffLines probes, a `total` count and diffBlock's own pass).
const { parseSpy } = vi.hoisted(() => ({ parseSpy: vi.fn() }));
vi.mock('../../../src/cli/ui/text.js', async (importActual) => {
  const actual = await importActual<typeof import('../../../src/cli/ui/text.js')>();
  return {
    ...actual,
    terminalPlainText: (input: string): string => { parseSpy(input); return actual.terminalPlainText(input); },
  };
});

const { framedDiffBlock } = await import('../../../src/cli/chat/components.js');

describe('framedDiffBlock single-parse', () => {
  beforeAll(() => initTheme());

  it('sanitizes the raw diff exactly once for a collapsed render', () => {
    const diff = Array.from({ length: 25 }, (_, i) => `+    ${i + 1} line ${i + 1}`).join('\n');
    parseSpy.mockClear();
    framedDiffBlock(diff, 80, 'diff', false);
    const diffParses = parseSpy.mock.calls.filter(([arg]) => arg === diff);
    expect(diffParses).toHaveLength(1);
  });

  it('sanitizes the raw diff exactly once for an expanded render', () => {
    const diff = Array.from({ length: 25 }, (_, i) => `+    ${i + 1} line ${i + 1}`).join('\n');
    parseSpy.mockClear();
    framedDiffBlock(diff, 80, 'diff', true);
    const diffParses = parseSpy.mock.calls.filter(([arg]) => arg === diff);
    expect(diffParses).toHaveLength(1);
  });
});
