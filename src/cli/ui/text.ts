import { truncateToWidth, visibleWidth } from '@earendil-works/pi-tui';

export function padAnsi(text: string, width: number): string {
  const w = visibleWidth(text);
  return w >= width ? truncateToWidth(text, width) : text + ' '.repeat(width - w);
}

export function formatK(n: number): string {
  return n < 1000 ? String(n) : n < 1_000_000 ? `${Math.round(n / 1000)}k` : `${(n / 1_000_000).toFixed(1)}M`;
}
