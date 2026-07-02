import { visibleWidth, wrapTextWithAnsi } from '@earendil-works/pi-tui';
import type { Component } from '@earendil-works/pi-tui';

/** opencode-style visual building blocks, hand-rolled on pi-tui's Component contract (render(width)
 *  → lines). Kept separate from app.ts so the layout logic stays readable and these are unit-testable. */

const TEAL = '38;5;44';
const BAR = `\x1b[${TEAL}m▎\x1b[0m`;      // thin teal left rail
const BG_OPEN = '\x1b[48;5;236m';          // subtle raised background for the user block
const BG_CLOSE = '\x1b[0m';
/** Bold that resets ONLY bold (\x1b[22m), so it never clears the surrounding background. */
const bold = (s: string): string => `\x1b[1m${s}\x1b[22m`;

/** A full-width user message: a teal left rail and a raised background with bold text, padded to width. */
export class UserBlock implements Component {
  constructor(private text: string) {}
  invalidate(): void { /* stateless — rebuilt fresh each render */ }
  render(width: number): string[] {
    const railed = (body: string): string => {
      const pad = Math.max(0, width - 1 - visibleWidth(body));
      return `${BAR}${BG_OPEN}${body}${' '.repeat(pad)}${BG_CLOSE}`;
    };
    const wrapped = wrapTextWithAnsi(this.text, Math.max(1, width - 3));
    const rows = wrapped.map((l) => railed(` ${bold(l)}`));
    return [railed(''), ...rows, railed('')];
  }
}

/** A bottom status bar: left text and right text justified to the two edges. */
export class StatusBar implements Component {
  constructor(private left: string, private right: string) {}
  invalidate(): void { /* re-rendered on the next frame */ }
  setLeft(left: string): void { this.left = left; }
  render(width: number): string[] {
    const gap = Math.max(1, width - visibleWidth(this.left) - visibleWidth(this.right));
    return [this.left + ' '.repeat(gap) + this.right];
  }
}

const ACCENT = (t: string): string => `\x1b[${TEAL}m${t}\x1b[0m`;
const DIM = (t: string): string => `\x1b[90m${t}\x1b[0m`;

/** The empty-conversation welcome banner: a rounded box with the brand, model, and a hint line. */
export function banner(model?: string): string[] {
  const inner = [
    `${ACCENT('🐋 Orca')} ${DIM('— tvůj agent nad celou flotilou')}`,
    DIM(model ? `model ${model}` : 'model —'),
    '',
    DIM('Zeptej se na cokoli — tasky, mise, plán, stav agentů…'),
    DIM('/help pro příkazy'),
  ];
  const width = Math.max(...inner.map((l) => visibleWidth(l))) + 4;
  const top = ACCENT(`╭${'─'.repeat(width - 2)}╮`);
  const bottom = ACCENT(`╰${'─'.repeat(width - 2)}╯`);
  const rows = inner.map((l) => `${ACCENT('│')} ${l}${' '.repeat(Math.max(0, width - 4 - visibleWidth(l)))} ${ACCENT('│')}`);
  return ['', top, ...rows, bottom, ''];
}

/** The dim metadata line under an assistant reply: `▪ orca · <model> · <duration>`. */
export function metaLine(model?: string, durationMs?: number): string {
  const parts = ['orca'];
  if (model) parts.push(model);
  if (durationMs != null) parts.push(`${(durationMs / 1000).toFixed(1)}s`);
  return `  \x1b[${TEAL}m▪\x1b[0m \x1b[90m${parts.join('  ·  ')}\x1b[0m`;
}
