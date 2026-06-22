'use client';
import { TriangleAlert } from 'lucide-react';
import type { Task } from '../../lib/types';
import { useSessions, useSessionSignals, useTasks } from '../../lib/queries';
import { needsInputSessions, taskSessionName } from '../../lib/agentUtils';
import { taskExec } from '../../lib/taskExec';
import { NeedsInputRow } from './NeedsInputRow';
import { useTranslation } from '../../lib/i18n';

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
          return <NeedsInputRow key={name} name={name} question={signal?.type === 'needs_input' ? signal.question : ''} options={signal?.type === 'needs_input' ? signal.options : undefined} exec={taskExec(taskFor(name)?.labels)} />;
        })}
      </div>
    </section>
  );
}
