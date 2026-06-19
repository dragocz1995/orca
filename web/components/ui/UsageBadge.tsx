'use client';
import { Coins } from 'lucide-react';
import type { TokenUsage } from '../../lib/types';
import { formatTokens } from '../../lib/formatTokens';
import { useTranslation } from '../../lib/i18n';

/** Compact token/cache/cost readout for an agent run. Renders nothing without usage. The full
 *  breakdown is in the tooltip; the inline form stays tiny so it fits in pills and card footers. */
export function UsageBadge({ usage }: { usage: TokenUsage }) {
  const { t } = useTranslation();
  if (!usage || usage.total === 0) return null;
  const cache = usage.cacheRead + usage.cacheWrite;
  const tip = [
    `${t.usage.input}: ${usage.input.toLocaleString()}`,
    `${t.usage.output}: ${usage.output.toLocaleString()}`,
    `${t.usage.cache}: ${cache.toLocaleString()}`,
    usage.costUsd != null ? `${t.usage.cost}: $${usage.costUsd.toFixed(4)}` : null,
  ].filter(Boolean).join(' · ');
  return (
    <span className="inline-flex items-center gap-1 font-mono text-[11px] text-text-muted" title={tip}>
      <Coins size={11} aria-hidden />
      {formatTokens(usage.total)}
      {usage.cacheRead ? <span className="opacity-70">· {formatTokens(usage.cacheRead)} {t.usage.cache}</span> : null}
      {usage.costUsd != null && usage.costUsd > 0 ? <span>· ${usage.costUsd.toFixed(2)}</span> : null}
    </span>
  );
}
