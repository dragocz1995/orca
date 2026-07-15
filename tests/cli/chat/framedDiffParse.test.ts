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

const stripAnsi = (s: string): string => s.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '').replace(/\x1b\[[0-9;]*m/g, '');

describe('framedDiffBlock wraps over-wide lines instead of truncating them', () => {
  beforeAll(() => initTheme());

  it('preserves the full content of a long line across wrapped rows (no ellipsis)', () => {
    const long = 'x'.repeat(200);
    const { lines } = framedDiffBlock(`+    1 ${long}`, 80, 'diff', false);
    const plain = lines.map(stripAnsi).join('\n');
    expect(plain).not.toContain('…');
    expect((plain.match(/x/g) ?? []).length).toBe(200);
    // the single logical row must now span more than one visual body row
    const bodyRows = lines.filter((l) => stripAnsi(l).includes('x'));
    expect(bodyRows.length).toBeGreaterThan(1);
  });

  it('keeps every wrapped row within the block width', () => {
    const { lines } = framedDiffBlock(`-    7 ${'abcdefgh '.repeat(30)}`, 80, 'diff', false);
    for (const line of lines) expect(stripAnsi(line).length).toBeLessThanOrEqual(80);
  });
});
