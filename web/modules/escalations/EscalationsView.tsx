'use client';
import { ShieldAlert, ShieldCheck, Rocket, Play, RotateCcw, Link2, Clock } from 'lucide-react';
import type { Escalation } from '../../lib/escalations';
import { useEscalations } from '../../lib/queries';
import { useSetTaskStatus, useResumeMission } from '../../lib/mutations';
import { apiErrorMessage } from '../../lib/orcaClient';
import { formatTaskTime } from '../../lib/formatTime';
import { ModuleHeader } from '../../components/ui/ModuleHeader';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/states';
import { useToast } from '../../components/ui/Toast';
import { useTranslation } from '../../lib/i18n';

/** Escalations inbox: every overseer rejection still awaiting a human, with the full rationale (which
 *  used to be crammed into a toast) and the two resolutions — accept the result and let the mission
 *  continue, or re-run the rejected phase. Items self-clear once their gated phases are released. */
export function EscalationsView() {
  const { t, locale } = useTranslation();
  const escalations = useEscalations();
  const setStatus = useSetTaskStatus();
  const resume = useResumeMission();
  const { toast } = useToast();

  // Accept the rejection: release every phase the engine gated behind it, then nudge the mission so
  // the engine picks them up now instead of waiting out the 90s tick.
  const approve = (e: Escalation) => {
    if (e.blocked.length === 0) return;
    e.blocked.forEach((b) => setStatus.mutate({ id: b.id, status: 'open' }));
    if (e.epicId) resume.mutate(`m-${e.epicId}`, { onError: () => { /* mission may be idle — open phases still get picked up on a later tick */ } });
    toast(t.escalations.approved);
  };
  // Re-run the rejected phase itself: re-open it so the engine re-spawns its agent.
  const rerun = (e: Escalation) => {
    setStatus.mutate({ id: e.taskId, status: 'open' }, {
      onSuccess: () => {
        if (e.epicId) resume.mutate(`m-${e.epicId}`, { onError: () => { /* idle mission — a later tick re-spawns it */ } });
        toast(t.escalations.rerunning);
      },
      onError: (err) => toast(apiErrorMessage(err) || t.escalations.actionError, 'error'),
    });
  };

  return (
    <>
      <ModuleHeader title={t.escalations.title} count={escalations.length} icon={ShieldAlert} />

      {escalations.length === 0 ? (
        <EmptyState title={t.escalations.empty} description={t.escalations.emptyDesc} icon={ShieldCheck} />
      ) : (
        <div className="flex flex-col gap-3">
          {escalations.map((e) => {
            const when = formatTaskTime(e.ts, Date.now(), locale);
            return (
              <article key={`${e.taskId}-${e.ts}`} className="flex flex-col gap-3 rounded-lg border border-warning/40 bg-warning/[0.05] p-4" style={{ boxShadow: 'var(--shadow-card)' }}>
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-warning/40 bg-warning/10">
                    <ShieldAlert size={20} className="text-warning" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate text-sm font-semibold text-text">{e.title}</h2>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[11px] text-text-muted">
                      {e.epicId ? <><Rocket size={11} className="shrink-0" aria-hidden /><span className="truncate">{e.epicId}</span></> : null}
                      {when.label ? <><span aria-hidden className="opacity-50">·</span><Clock size={11} className="shrink-0" aria-hidden /><span title={when.title}>{when.label}</span></> : null}
                    </div>
                  </div>
                </div>

                {/* The overseer's verdict — the long text that used to be a toast, now readable. */}
                <div className="rounded-md border border-border bg-elevated p-3">
                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-text-muted">{t.escalations.rationale}</div>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-text">{e.rationale || t.escalations.noReason}</p>
                </div>

                {e.blocked.length > 0 ? (
                  <div className="flex flex-col gap-1">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">{t.escalations.blockedBy}</span>
                    <ul className="flex flex-col gap-1">
                      {e.blocked.map((b) => (
                        <li key={b.id} className="flex items-center gap-2 text-xs text-text">
                          <Link2 size={12} className="shrink-0 text-text-muted" aria-hidden />
                          <span className="min-w-0 flex-1 truncate">{b.title}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <div className="flex flex-wrap items-center justify-end gap-2">
                  <Button variant="ghost" icon={RotateCcw} onClick={() => rerun(e)} disabled={setStatus.isPending}>{t.escalations.rerun}</Button>
                  <Button variant="accent" icon={Play} onClick={() => approve(e)} disabled={e.blocked.length === 0 || setStatus.isPending}>{t.escalations.approve}</Button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
