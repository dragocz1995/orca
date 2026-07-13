'use client';
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { X, TerminalSquare } from 'lucide-react';
import { useTranslation } from '../../lib/i18n';
import { useBrainProcesses } from '../../lib/queries';
import { elowenClient } from '../../lib/elowenClient';
import { Modal } from '../../components/ui/Modal';
import type { ProcessInfo } from '../../lib/types';

/** Live output of one background process, polled while it runs. Mirrors the terminal plugin's rolling
 *  buffer (read via GET /brain/processes/:id/output). */
function ProcessOutputModal({ proc, onClose }: { proc: ProcessInfo; onClose: () => void }) {
  const { t } = useTranslation();
  const [output, setOutput] = useState('');
  const preRef = useRef<HTMLPreElement>(null);
  useEffect(() => {
    let stale = false;
    const pull = async () => {
      const r = await elowenClient.brainProcessOutput(proc.id).catch(() => null);
      if (!stale && r) setOutput(r.output);
    };
    void pull();
    const timer = proc.running ? setInterval(() => void pull(), 1500) : null;
    return () => { stale = true; if (timer) clearInterval(timer); };
  }, [proc.id, proc.running]);
  useEffect(() => { preRef.current?.scrollTo({ top: preRef.current.scrollHeight }); }, [output]);
  return (
    <Modal title={proc.command} description={proc.running ? t.processes.running : t.processes.exited} onClose={onClose} size="xl" icon={TerminalSquare}>
      <pre ref={preRef} className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap bg-bg p-4 font-mono text-tiny leading-relaxed text-text-muted">
        {output || t.processes.noOutput}
      </pre>
    </Modal>
  );
}

/** Where a process came from, when that is NOT the conversation currently on screen: a delegated sub-agent
 *  (`brain-ch-subagent-…`), another channel session (Discord/WhatsApp…), or one of the user's OTHER chats.
 *  The list spans every session the user owns (that is what makes an orphaned service findable at all), so
 *  every foreign row MUST be badged — an unbadged row is one this conversation started, and only that. */
function originLabel(
  sessionId: string | null,
  activeSessionId: string | null,
  t: ReturnType<typeof useTranslation>['t'],
): string | null {
  if (sessionId && sessionId === activeSessionId) return null;
  if (sessionId?.startsWith('brain-ch-subagent-')) return t.processes.subagent;
  if (sessionId?.startsWith('brain-ch-')) return t.processes.channel;
  // A plain `brain-N` that is not the open conversation (or a handle whose origin we cannot resolve).
  return t.processes.otherChat;
}

/** A panel next to the todos listing the background shell processes the agent started. Each row opens a
 *  live-output modal on click and carries an ✕ to kill it. Hidden when there are none. The list is
 *  owner-wide, not conversation-wide, so `activeSessionId` is what tells a local row from a foreign one. */
export function ProcessPanel({ activeSessionId = null }: { activeSessionId?: string | null }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data: procs = [] } = useBrainProcesses();
  // Track the open modal by id, not a click-time snapshot, so `proc.running` reflects the LIVE state from
  // the polled list — the modal stops polling once the process exits (and closes if it's pruned away).
  const [openId, setOpenId] = useState<string | null>(null);
  const openProc = procs.find((p) => p.id === openId) ?? null;
  if (procs.length === 0) return null;

  const kill = async (id: string) => {
    await elowenClient.brainKillProcess(id).catch(() => undefined);
    await qc.invalidateQueries({ queryKey: ['brain-processes'] });
  };
  const runningCount = procs.filter((p) => p.running).length;

  return (
    <div className="rounded-md border border-border bg-elevated p-2 text-tiny">
      <div className="mb-1 flex items-center gap-1.5 font-medium text-text-muted">
        <TerminalSquare size={11} aria-hidden /> {t.processes.title}
        <span className="tabular-nums opacity-70">{runningCount}</span>
      </div>
      <ul className="flex flex-col gap-0.5">
        {procs.map((p) => {
          const origin = originLabel(p.sessionId, activeSessionId, t);
          return (
          <li key={p.id} className="group flex items-center gap-1.5">
            <span className={`shrink-0 ${p.running ? 'text-success' : 'text-text-muted'}`} title={p.running ? t.processes.running : t.processes.exited}>●</span>
            <button
              type="button"
              onClick={() => setOpenId(p.id)}
              className="min-w-0 flex-1 truncate text-left font-mono text-text hover:underline"
              title={p.command}
            >
              {p.command}
            </button>
            {origin ? (
              <span className="shrink-0 rounded bg-bg px-1 text-[10px] text-text-muted" title={p.sessionId ?? undefined}>{origin}</span>
            ) : null}
            <button
              type="button"
              onClick={() => void kill(p.id)}
              aria-label={t.processes.kill}
              title={t.processes.kill}
              className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-text-muted opacity-0 transition-all hover:text-danger group-hover:opacity-100"
            >
              <X size={11} aria-hidden />
            </button>
          </li>
          );
        })}
      </ul>
      {openProc ? <ProcessOutputModal proc={openProc} onClose={() => setOpenId(null)} /> : null}
    </div>
  );
}
