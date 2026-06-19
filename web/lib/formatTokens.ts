/** Compact token count: 950 → "950", 12345 → "12.3k", 1_200_000 → "1.2M". Single source of truth. */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}
