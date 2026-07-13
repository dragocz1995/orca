import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { LanguageProvider } from '../../../lib/i18n';
import { BrainLimitsModal, BRAIN_LIMIT_DEFAULTS } from '../../../modules/settings/BrainLimitsModal';

/** The modal's own stacking layer, read from the real stylesheet — jsdom loads no CSS, so a computed
 *  z-index would be empty for both elements and prove nothing. Reading the shipped value keeps the test
 *  honest: if the layers are ever renumbered, this follows them instead of pinning a stale literal. */
function modalLayerZ(): number {
  const css = readFileSync(resolve(process.cwd(), 'app/styles/components.css'), 'utf8');
  const z = /\.overlay-layer-modal\s*\{[^}]*z-index:\s*(\d+)/.exec(css)?.[1];
  if (!z) throw new Error('.overlay-layer-modal z-index not found in components.css');
  return Number(z);
}

/** The z-index the tooltip actually carries (a Tailwind arbitrary value, e.g. `z-[130]`). */
function tooltipZ(tooltip: HTMLElement): number {
  const z = /(?:^|\s)z-\[(\d+)\]/.exec(tooltip.className)?.[1];
  if (!z) throw new Error(`the help tooltip carries no z-index class: ${tooltip.className}`);
  return Number(z);
}

describe('BrainLimitsModal', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('opens field help as a floating layer above the limits modal', () => {
    render(
      <LanguageProvider>
        <BrainLimitsModal limits={BRAIN_LIMIT_DEFAULTS} onChange={() => {}} onClose={() => {}} />
      </LanguageProvider>,
    );

    fireEvent.click(screen.getAllByRole('button', { name: 'Help' })[0]!);

    const tooltip = screen.getByRole('tooltip');
    const dialog = screen.getByRole('dialog');
    // "Above the modal" has two halves, and BOTH must hold or the help is unreadable:
    // 1. it escapes the modal's clipping/stacking context (portaled to <body>, painted after it), and
    // 2. it outranks the modal's stacking layer — the half a portal alone does NOT give you.
    expect(tooltip.parentElement).toBe(document.body);
    expect(dialog.compareDocumentPosition(tooltip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(tooltipZ(tooltip)).toBeGreaterThan(modalLayerZ());
  });

  it('flips the help body above the trigger so it stays inside the viewport near the fold', () => {
    // A real 120px help body opened near the bottom of jsdom's 768px viewport would spill past it.
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(120);
    render(
      <LanguageProvider>
        <BrainLimitsModal limits={BRAIN_LIMIT_DEFAULTS} onChange={() => {}} onClose={() => {}} />
      </LanguageProvider>,
    );
    const trigger = screen.getAllByRole('button', { name: 'Help' })[0]!;
    Object.defineProperty(trigger, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ top: 700, bottom: 716, left: 300, right: 316, width: 16, height: 16, x: 300, y: 700, toJSON: () => ({}) }),
    });

    fireEvent.click(trigger);

    const top = Number.parseInt(screen.getByRole('tooltip').style.top, 10);
    const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
    expect(top).toBeLessThanOrEqual(700);
    expect(top + 120).toBeLessThanOrEqual(viewportHeight);
    expect(top).toBeGreaterThanOrEqual(12);
  });
});
