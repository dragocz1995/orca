'use client';
import Link from 'next/link';
import { ListChecks, Terminal, Rocket, ArrowRight } from 'lucide-react';
import { useTasks, useSessions, useMissions } from '../../lib/queries';
import { deriveDashboardMetrics } from './metrics';
import { statusTone } from './statusTone';
import { StatCard } from '../../components/ui/StatCard';
import { Section } from '../../components/ui/Section';
import { Table, THead, TR, TH, TD } from '../../components/ui/Table';
import { Badge } from '../../components/ui/Badge';
import { LoadingState, ErrorState, EmptyState } from '../../components/ui/states';
import { ActivityTicker } from './ActivityTicker';
import type { TaskStatus } from '../../lib/types';

const STATUS_BAR_KEYS: Array<{ key: TaskStatus; bg: string }> = [
  { key: 'open', bg: 'bg-accent' },
  { key: 'in_progress', bg: 'bg-accent' },
  { key: 'blocked', bg: 'bg-danger' },
  { key: 'closed', bg: 'bg-elevated' },
  { key: 'cancelled', bg: 'bg-elevated' },
];

function ViewAll({ href }: { href: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-1.5 text-xs font-medium text-accent transition-colors hover:opacity-80">
      View all
      <ArrowRight size={13} aria-hidden />
    </Link>
  );
}

export function DashboardView() {
  const tasks = useTasks();
  const sessions = useSessions();
  const missions = useMissions();

  const metrics = deriveDashboardMetrics(tasks.data, sessions.data, missions.data);

  return (
    <div className="flex w-full flex-col gap-6">
      <ActivityTicker />

      {/* Metrics row */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
        <StatCard label="Open" value={metrics.open} hint={`of ${metrics.totalTasks} total`} />
        <StatCard label="In progress" value={metrics.inProgress} />
        <StatCard
          label="Blocked"
          value={metrics.blocked}
          tone={metrics.blocked > 0 ? 'danger' : 'default'}
        />
        <StatCard label="Live sessions" value={metrics.liveSessions} />
        <StatCard label="Active missions" value={metrics.activeMissions} />
      </div>

      {/* Tasks section */}
      <Section title="Tasks" icon={ListChecks} actions={<ViewAll href="/tasks" />}>
        {tasks.isLoading ? (
          <LoadingState />
        ) : tasks.isError ? (
          <ErrorState message="orca daemon unreachable" onRetry={() => tasks.refetch()} />
        ) : tasks.data && tasks.data.length > 0 ? (
          <div className="flex flex-col gap-3">
            {/* Status breakdown bar */}
            <div className="flex h-2 w-full overflow-hidden rounded-full border border-border">
              {STATUS_BAR_KEYS.map(({ key, bg }) => {
                const count = metrics.byStatus[key];
                if (count === 0) return null;
                return (
                  <div
                    key={key}
                    className={bg}
                    style={{ flexGrow: count }}
                  />
                );
              })}
            </div>
            <Table>
              <THead>
                <TR>
                  <TH>ID</TH>
                  <TH>Title</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <tbody>
                {tasks.data.map((t) => (
                  <TR key={t.id}>
                    <TD mono>{t.id}</TD>
                    <TD>{t.title}</TD>
                    <TD>
                      <Badge tone={statusTone(t.status)}>{t.status}</Badge>
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          </div>
        ) : (
          <EmptyState title="No tasks" />
        )}
      </Section>

      {/* Sessions section */}
      <Section title="Sessions" icon={Terminal} actions={<ViewAll href="/sessions" />}>
        {sessions.isLoading ? (
          <LoadingState />
        ) : sessions.isError ? (
          <ErrorState message="orca daemon unreachable" onRetry={() => sessions.refetch()} />
        ) : sessions.data && sessions.data.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {sessions.data.map((s) => (
              <div key={s} className="flex items-center gap-2.5 rounded-md border border-border bg-bg px-3 py-2.5">
                <Terminal size={14} className="shrink-0 text-text-muted" aria-hidden />
                <span className="truncate font-mono text-xs text-text">{s}</span>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="No live sessions" />
        )}
      </Section>

      {/* Missions section */}
      <Section title="Missions" icon={Rocket} actions={<ViewAll href="/missions" />}>
        {missions.isLoading ? (
          <LoadingState />
        ) : missions.isError ? (
          <ErrorState message="orca daemon unreachable" onRetry={() => missions.refetch()} />
        ) : missions.data && missions.data.length > 0 ? (
          <Table>
            <THead>
              <TR>
                <TH>ID</TH>
                <TH>State</TH>
              </TR>
            </THead>
            <tbody>
              {missions.data.map((m) => (
                <TR key={m.id}>
                  <TD mono>{m.id}</TD>
                  <TD>
                    <Badge tone={m.state === 'disengaged' ? 'muted' : 'accent'}>{m.state}</Badge>
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="No active missions" />
        )}
      </Section>
    </div>
  );
}
