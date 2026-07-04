'use client';
import { useState } from 'react';
import { Brain, CheckCircle2, History, RefreshCw, type LucideIcon } from 'lucide-react';
import type { Memory } from '../../lib/types';
import { useMemoryEvents, useEmbeddingSettings } from '../../lib/queries';
import { useReindexMemories } from '../../lib/mutations';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useToast } from '../../components/ui/Toast';
import { apiErrorMessage } from '../../lib/orcaClient';
import { useTranslation } from '../../lib/i18n';

/** Sticky sidebar overview: headline counts + the self-service reindex action. The per-kind/per-status
 *  breakdowns were intentionally dropped from here — that shape belongs in Statistics, not this column. */
export function MemoryOverview({ memories }: { memories: Memory[] }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const events = useMemoryEvents(null);
  const embedding = useEmbeddingSettings();
  const reindex = useReindexMemories();
  const [confirmReindex, setConfirmReindex] = useState(false);

  const active = memories.filter((m) => m.status === 'active').length;
  const recentAudit = events.data?.length ?? 0;
  const configured = embedding.data?.configured ?? false;

  const doReindex = () => {
    setConfirmReindex(false);
    reindex.mutate(undefined, {
      onSuccess: (r) => toast(t.memory.reindexDone.replace('{n}', String(r.embedded))),
      onError: (e) => toast(apiErrorMessage(e), 'error'),
    });
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Compact stat rows — icon beside the value (not stacked above), sized to match the memory rows
          on the left. Lives in the sticky right column, so they flow top-to-bottom. */}
      <div className="flex flex-col gap-2.5">
        <CompactStat value={memories.length} label={t.page.memory} icon={Brain} />
        <CompactStat value={active} label={t.memory.statusActive} icon={CheckCircle2} />
        <CompactStat value={recentAudit} label={t.memory.auditHeading} icon={History} />
      </div>

      {/* Re-embed the caller's own memories (self-service — no admin config needed). Disabled until an
          embedding provider is configured in Settings → Embedding. */}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="default"
          icon={RefreshCw}
          disabled={!configured || reindex.isPending}
          onClick={() => setConfirmReindex(true)}
        >
          {t.memory.reindex}
        </Button>
        {!configured ? <span className="text-xs italic text-text-muted">{t.memory.reindexUnconfigured}</span> : null}
      </div>

      <ConfirmDialog
        open={confirmReindex}
        title={t.memory.reindexConfirmTitle}
        description={t.memory.reindexConfirmBody}
        confirmLabel={t.memory.reindexConfirm}
        onClose={() => setConfirmReindex(false)}
        onConfirm={doReindex}
      />
    </div>
  );
}

/** A compact stat row for the sticky sidebar: icon beside the value + label, matching the memory-row
 *  density on the left (rounded-lg border, p-3) rather than the tall stacked StatCard. */
function CompactStat({ value, label, icon: Icon }: { value: number; label: string; icon: LucideIcon }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-surface p-3" style={{ boxShadow: 'var(--shadow-card)' }}>
      <Icon size={17} className="shrink-0 text-text-muted" aria-hidden />
      <div className="flex items-baseline gap-2">
        <span className="text-xl font-bold tabular-nums leading-none text-text">{value}</span>
        <span className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">{label}</span>
      </div>
    </div>
  );
}
