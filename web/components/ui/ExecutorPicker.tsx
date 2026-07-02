'use client';
import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { ModelIcon } from './ModelIcon';
import { PROVIDERS, providerMeta } from '../../modules/settings/providers';
import { execProvider, type ProviderId } from '../../lib/modelProvider';
import { useBrainModels, useConfig } from '../../lib/queries';
import { useTranslation } from '../../lib/i18n';
import type { BrainModelOption } from '../../lib/types';

interface Model { label: string; exec: string }

/** A brain provider group: one tab per CONFIGURED provider (not one lumped "Orca AI" tab), so the
 *  user sees which account/endpoint actually serves the model. `oauth` drives the provenance badge. */
interface BrainGroup { id: string; label: string; oauth: boolean; models: Model[] }

const pillClass = (active: boolean) =>
  `inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${active ? 'border-accent/50 bg-accent/15 text-accent' : 'border-border bg-elevated text-text-muted hover:border-border-strong hover:text-text'}`;

const tabClass = (open: boolean) =>
  `inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${open ? 'border-border-strong bg-elevated text-text' : 'border-border text-text-muted hover:bg-elevated hover:text-text'}`;

/**
 * Two-level executor picker, split into two labelled sections so workers and Orca AI never blur:
 *  - "Workers" — the CLI engines (Claude Code / OpenCode / Codex / Kilo) fed by the `models` prop.
 *  - "Orca AI" — one tab per configured brain provider (OAuth accounts carry a badge), models live
 *    from the brain catalog.
 * `kind="brain"` renders the Orca AI section alone with the FULL catalog (no allow-list filter —
 * the server already scopes non-admins); use it wherever only a brain model makes sense (plugin
 * config, chat model). The default `kind="all"` keeps the allow-list gate on brain models, because
 * there it decides what ordinary users may launch as task executors.
 */
export function ExecutorPicker({ value, onChange, models, defaultLabel, allowDefault = true, kind = 'all' }: {
  value: string;
  onChange: (exec: string) => void;
  models: Model[];
  /** Label for the empty-value pill. Only rendered when `allowDefault` (the default). */
  defaultLabel?: string;
  /** Kept for call-site compatibility; the grouped picker no longer collapses. */
  moreLabel?: string;
  limit?: number;
  /** Whether to offer the empty "default" pill. Off for fields that must resolve to a concrete model. */
  allowDefault?: boolean;
  /** 'all' = workers + Orca AI (task executors); 'brain' = Orca AI only, full catalog. */
  kind?: 'all' | 'brain';
}) {
  const { t } = useTranslation();
  const config = useConfig();
  const brain = useBrainModels();

  // Orca AI models grouped by their real provider. In 'all' mode the global allow-list gates them
  // (what users may run as executors); in 'brain' mode the full catalog shows (the server already
  // filters non-admins per-user, so OAuth models are pickable without an allow-list detour).
  const allowed = config.data?.allowedExecs;
  const brainList: BrainModelOption[] = (brain.data ?? [])
    .filter((m) => kind === 'brain' || !allowed || allowed.includes(m.exec));
  const brainGroups: BrainGroup[] = [];
  for (const m of brainList) {
    let g = brainGroups.find((x) => x.id === m.provider);
    if (!g) { g = { id: m.provider, label: m.providerLabel, oauth: m.source === 'oauth', models: [] }; brainGroups.push(g); }
    g.models.push({ label: m.model, exec: m.exec });
  }

  // Worker CLI models grouped by engine (hidden entirely in 'brain' mode).
  const byWorker = new Map<ProviderId, Model[]>();
  if (kind === 'all') {
    for (const m of [...models].sort((a, b) => a.label.localeCompare(b.label))) {
      const p = execProvider(m.exec);
      if (p === 'orca') continue; // orca execs render in the Orca AI section, never as a worker
      byWorker.set(p, [...(byWorker.get(p) ?? []), m]);
    }
  }
  const workerGroups = PROVIDERS.filter((p) => p.id !== 'orca' && (byWorker.get(p.id as ProviderId) ?? []).length > 0);

  // Which tab is open: a worker engine ('w:<id>') or a brain provider ('b:<id>'). The current
  // selection's home tab opens by default so the picked model is visible on mount.
  const valueTab = value
    ? (value.startsWith('orca:') ? `b:${brainList.find((m) => m.exec === value)?.provider ?? ''}` : `w:${execProvider(value)}`)
    : null;
  const [openTab, setOpenTab] = useState<string | null>(null);
  const firstTab = workerGroups[0] ? `w:${workerGroups[0].id}` : brainGroups[0] ? `b:${brainGroups[0].id}` : null;
  const active = openTab ?? valueTab ?? (allowDefault && value === '' ? null : firstTab);

  const activeModels: Model[] = active?.startsWith('w:')
    ? (byWorker.get(active.slice(2) as ProviderId) ?? [])
    : active?.startsWith('b:')
      ? (brainGroups.find((g) => g.id === active.slice(2))?.models ?? [])
      : [];
  const activeIsBrain = active?.startsWith('b:') ?? false;

  const sectionLabel = (text: string) => (
    <span className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">{text}</span>
  );

  return (
    <div className="flex flex-col gap-2">
      {allowDefault ? (
        <button
          type="button"
          aria-pressed={value === ''}
          onClick={() => { onChange(''); setOpenTab(null); }}
          className={`self-start ${pillClass(value === '')}`}
          style={{ transitionDuration: 'var(--motion-fast)' }}
        >
          <Sparkles size={14} aria-hidden />
          {defaultLabel}
        </button>
      ) : null}

      {/* Workers: the CLI engines that run spawned tasks. */}
      {workerGroups.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          {sectionLabel(t.tasks.sectionWorkers)}
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label={t.tasks.sectionWorkers}>
            {workerGroups.map((p) => {
              const meta = providerMeta(p.id)!;
              const tab = `w:${p.id}`;
              const holdsSelection = valueTab === tab && value !== '';
              return (
                <button key={tab} type="button" role="tab" aria-selected={active === tab} onClick={() => setOpenTab(tab)} className={tabClass(active === tab)} style={{ transitionDuration: 'var(--motion-fast)' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={meta.icon} alt="" width={14} height={14} style={{ objectFit: 'contain' }} aria-hidden />
                  {meta.label}
                  {holdsSelection ? <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden /> : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* Orca AI: the embedded brain's providers — one tab per provider, OAuth accounts badged. */}
      {brainGroups.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          {kind === 'all' ? sectionLabel(t.tasks.sectionOrcaAi) : null}
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label={t.tasks.sectionOrcaAi}>
            {brainGroups.map((g) => {
              const tab = `b:${g.id}`;
              const holdsSelection = valueTab === tab && value !== '';
              return (
                <button key={tab} type="button" role="tab" aria-selected={active === tab} onClick={() => setOpenTab(tab)} className={tabClass(active === tab)} style={{ transitionDuration: 'var(--motion-fast)' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={providerMeta('orca')!.icon} alt="" width={14} height={14} style={{ objectFit: 'contain' }} className="logo-adaptive" aria-hidden />
                  {g.label}
                  {g.oauth ? <span className="rounded-sm border border-border px-1 text-[9px] font-semibold uppercase text-text-muted">OAuth</span> : null}
                  {holdsSelection ? <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden /> : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* Step 2: the open tab's models. */}
      {activeModels.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 border-l-2 border-border pl-2.5">
          {activeModels.map((m) => (
            <button key={m.exec} type="button" onClick={() => onChange(m.exec)} aria-pressed={value === m.exec} className={pillClass(value === m.exec)} style={{ transitionDuration: 'var(--motion-fast)' }}>
              <ModelIcon name={activeIsBrain ? m.label : m.exec} size={15} />
              {m.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
