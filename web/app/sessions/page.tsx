'use client';
import { useState } from 'react';
import dynamic from 'next/dynamic';
import { useSessions } from '../../lib/queries';
import { useKillSession, useSendInput } from '../../lib/mutations';
import { SendInput } from '../../components/control/SendInput';
import { useToast } from '../../components/ui/Toast';
import { Panel } from '../../components/ui/Panel';
import { PageHeader } from '../../components/ui/PageHeader';
import { Button } from '../../components/ui/Button';
import { LoadingState, ErrorState, EmptyState } from '../../components/ui/states';

// xterm references browser-only `self`; skip SSR to avoid prerender errors
const Terminal = dynamic(
  () => import('../../components/terminal/Terminal').then((m) => m.Terminal),
  { ssr: false },
);

export default function SessionsPage() {
  const sessions = useSessions();
  const kill = useKillSession();
  const send = useSendInput();
  const { toast } = useToast();
  const [openTerms, setOpenTerms] = useState<Set<string>>(new Set());
  const toggleTerm = (s: string) => setOpenTerms((prev) => { const n = new Set(prev); n.has(s) ? n.delete(s) : n.add(s); return n; });

  return (
    <Panel>
      <PageHeader title="Sessions" count={sessions.data?.length} />
      {sessions.isLoading ? <LoadingState /> : sessions.isError ? <ErrorState message="orca daemon unreachable" onRetry={() => sessions.refetch()} />
        : sessions.data && sessions.data.length > 0 ? (
          <ul className="flex flex-col divide-y divide-border">
            {sessions.data.map((s) => (
              <li key={s} className="flex flex-col">
                <div className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="font-mono text-xs text-text-muted">{s}</span>
                  <div className="flex items-center gap-2">
                    <Button onClick={() => toggleTerm(s)}>Terminal</Button>
                    <SendInput onSend={(keys) => send.mutate({ name: s, keys }, { onSuccess: () => toast(`Sent to ${s}`), onError: (e) => toast(String(e), 'error') })} />
                    <Button onClick={() => send.mutate({ name: s, keys: ['C-c'] }, { onSuccess: () => toast(`Interrupted ${s}`) })}>Interrupt</Button>
                    <Button variant="danger" onClick={() => kill.mutate(s, { onSuccess: () => toast(`Killed ${s}`), onError: (e) => toast(String(e), 'error') })}>Kill</Button>
                  </div>
                </div>
                {openTerms.has(s) && <div className="px-3 pb-3"><Terminal name={s} /></div>}
              </li>
            ))}
          </ul>
        ) : <EmptyState title="No live sessions" />}
    </Panel>
  );
}
