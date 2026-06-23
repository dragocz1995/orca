'use client';
import { useState } from 'react';
import dynamic from 'next/dynamic';
import { Bot, X, Square, RotateCcw, MoreVertical } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { ActionMenu } from '../../components/ui/ActionMenu';
import { useToast } from '../../components/ui/Toast';
import { useTranslation } from '../../lib/i18n';
import { useAdvisorStatus, useConfig, useMe } from '../../lib/queries';
import { useAdvisorStart, useAdvisorStop } from '../../lib/mutations';
import { allModels } from '../../lib/execPresets';
import { apiErrorMessage } from '../../lib/orcaClient';

// xterm references browser-only `self`; skip SSR so the always-mounted dock doesn't break prerender.
const Terminal = dynamic(() => import('../../components/terminal/Terminal').then((m) => m.Terminal), { ssr: false });

/** Floating per-user advisor dock: a 🐋 button bottom-right opens a panel with the user's persistent
 *  advisor agent in a fully interactive terminal. When no session is live it shows an agent picker
 *  (limited to the user's allowed execs); the choice is remembered and auto-started on next login. */
export function AdvisorDock() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const status = useAdvisorStatus();
  const config = useConfig();
  const me = useMe();
  const start = useAdvisorStart();
  const stop = useAdvisorStop();

  const running = status.data?.running ?? false;
  const session = status.data?.session ?? null;

  // Models the user may run an advisor as: their admin allow-list, or all globally-allowed when they
  // have no per-user restriction — intersected with the global allow-list either way.
  const u = me.data?.user;
  const globalAllowed = config.data?.allowedExecs ?? [];
  const restricted = (u?.allowed_execs.length ?? 0) > 0;
  const allowedSet = new Set(restricted ? u!.allowed_execs : globalAllowed);
  const models = allModels(config.data?.customModels ?? [], config.data?.hiddenPresets ?? []).filter((m) => allowedSet.has(m.exec));
  const [selected, setSelected] = useState('');
  const chosen = selected || status.data?.exec || models[0]?.exec || '';

  const doStart = (exec: string) => start.mutate(exec, {
    onSuccess: () => toast(t.advisor.started),
    onError: (e) => toast(apiErrorMessage(e), 'error'),
  });
  const doStop = () => stop.mutate(undefined, {
    onSuccess: () => toast(t.advisor.stopped),
    onError: (e) => toast(apiErrorMessage(e), 'error'),
  });

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t.advisor.open}
        title={t.advisor.title}
        className="fixed bottom-4 right-4 z-50 flex h-12 w-12 items-center justify-center rounded-full border border-border bg-accent text-white shadow-lg transition-transform hover:scale-105 active:scale-95"
      >
        <Bot size={22} aria-hidden />
        {running ? <span className="absolute right-0 top-0 h-3 w-3 rounded-full border-2 border-bg bg-green-500" aria-hidden /> : null}
      </button>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 flex h-[min(620px,80vh)] w-[min(680px,92vw)] flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-2xl">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <Bot size={16} className="text-accent" aria-hidden />
        <span className="text-sm font-semibold">{t.advisor.title}</span>
        <span className={`ml-1 inline-flex items-center gap-1 text-xs ${running ? 'text-green-500' : 'text-text-muted'}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${running ? 'bg-green-500' : 'bg-text-muted'}`} aria-hidden />
          {running ? t.advisor.running : t.advisor.idle}
        </span>
        <div className="flex-1" />
        {running ? (
          <ActionMenu
            label={t.common.actions}
            align="right"
            triggerClassName="flex h-8 w-8 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-elevated hover:text-text"
            trigger={<MoreVertical size={18} aria-hidden />}
            items={[
              { label: t.advisor.restart, icon: RotateCcw, onSelect: () => { stop.mutate(undefined, { onSuccess: () => doStart(chosen) }); } },
              { label: t.advisor.stop, icon: Square, tone: 'danger', onSelect: doStop },
            ]}
          />
        ) : null}
        <button type="button" onClick={() => setOpen(false)} aria-label={t.advisor.close} className="flex h-8 w-8 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-elevated hover:text-text">
          <X size={18} aria-hidden />
        </button>
      </div>

      <div className="min-h-0 flex-1">
        {running && session ? (
          <Terminal name={session} interactive />
        ) : (
          <div className="flex h-full flex-col gap-4 p-5">
            {models.length === 0 ? (
              <p className="text-sm text-text-muted">{t.advisor.noExecs}</p>
            ) : (
              <>
                <p className="text-sm text-text-muted">{t.advisor.pickAgent}</p>
                <div className="grid grid-cols-2 gap-2">
                  {models.map((m) => {
                    const on = chosen === m.exec;
                    return (
                      <button
                        key={m.exec}
                        type="button"
                        onClick={() => setSelected(m.exec)}
                        aria-pressed={on}
                        className={`rounded-lg border px-3 py-2.5 text-left text-sm transition-colors ${on ? 'border-accent bg-accent/[0.08]' : 'border-border bg-bg hover:border-border-strong hover:bg-elevated'}`}
                      >
                        <span className="block font-medium">{m.label}</span>
                        <span className="block font-mono text-[11px] text-text-muted">{m.exec}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="flex-1" />
                <Button variant="accent" icon={Bot} onClick={() => doStart(chosen)} disabled={!chosen || start.isPending}>
                  {start.isPending ? t.advisor.starting : t.advisor.start}
                </Button>
                <p className="text-center text-[11px] text-text-muted">{t.advisor.hint}</p>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
