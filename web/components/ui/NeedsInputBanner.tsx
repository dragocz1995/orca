'use client';
import { TriangleAlert } from 'lucide-react';
import type { Task } from '../../lib/types';
import { useSessions, useSessionSignals, useTasks } from '../../lib/queries';
import { useSendInput } from '../../lib/mutations';
import { needsInputSessions, taskSessionName } from '../../lib/agentUtils';
import { taskExec } from '../../lib/taskExec';
import { ModelIcon } from './ModelIcon';
import { useToast } from './Toast';
import { useTranslation } from '../../lib/i18n';

/** One waiting agent row with inline Allow/Reject. Kept separate so the banner can early-return
 *  (and skip the toast/mutation hooks) when nothing needs attention. */
function NeedsInputRow({ name, question, exec }: { name: string; question: string; exec: string }) {
  const { t } = useTranslation();
  const send = useSendInput();
  const { toast } = useToast();
  return (
    <div className="flex items-center gap-2.5 rounded-md border border-border bg-bg px-3 py-2">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border bg-elevated">
        {exec ? <ModelIcon name={exec} size={13} /> : <TriangleAlert size={12} className="text-warning" aria-hidden />}
      </span>
      <span className="shrink-0 font-mono text-[11px] text-text">{name}</span>
      <span className="min-w-0 flex-1 truncate text-xs text-text-muted" title={question}>{question}</span>
      <div className="flex shrink-0 items-center gap-1.5">
        <button type="button" onClick={() => send.mutate({ name, keys: ['Enter'] }, { onSuccess: () => toast(t.sessions.approved.replace('{name}', name)), onError: (e) => toast(String(e), 'error') })} className="rounded-md border border-approve/50 bg-approve/10 px-2.5 py-1 text-xs font-medium text-approve transition-colors hover:bg-approve hover:text-white active:scale-95">{t.sessions.allow}</button>
        <button type="button" onClick={() => send.mutate({ name, keys: ['Escape'] }, { onSuccess: () => toast(t.sessions.rejected.replace('{name}', name)), onError: (e) => toast(String(e), 'error') })} className="rounded-md border border-danger/50 bg-danger/10 px-2.5 py-1 text-xs font-medium text-danger transition-colors hover:bg-danger hover:text-white active:scale-95">{t.sessions.reject}</button>
      </div>
    </div>
  );
}

/** Global attention banner: every agent waiting for human input, with inline Allow/Reject.
 *  Pass `sessions` to scope to a subset (e.g. one mission); omit it to cover all live sessions. */
export function NeedsInputBanner({ sessions: scope }: { sessions?: string[] }) {
  const { t } = useTranslation();
  const allSessions = useSessions();
  const signals = useSessionSignals();
  const tasks = useTasks();

  const waiting = needsInputSessions(scope ?? allSessions.data ?? [], signals);
  if (waiting.length === 0) return null;

  const taskFor = (name: string): Task | undefined => (tasks.data ?? []).find((x) => taskSessionName(x) === name);

  return (
    <section className="flex flex-col gap-2 rounded-lg border border-warning/50 bg-warning/[0.06] p-3">
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-warning">
        <TriangleAlert size={13} aria-hidden />{t.dashboard.needsAttentionTitle}
      </div>
      <div className="flex flex-col gap-1.5">
        {waiting.map((name) => {
          const signal = signals[name];
          return <NeedsInputRow key={name} name={name} question={signal?.type === 'needs_input' ? signal.question : ''} exec={taskExec(taskFor(name)?.labels)} />;
        })}
      </div>
    </section>
  );
}
