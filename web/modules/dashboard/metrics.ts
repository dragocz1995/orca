import type { Task, Mission } from '../../lib/types';

export interface DashboardMetrics {
  totalTasks: number;
  open: number;
  inProgress: number;
  blocked: number;
  closed: number;
  liveSessions: number;
  activeMissions: number;
}

export function deriveDashboardMetrics(
  tasks: Task[] | undefined,
  sessions: string[] | undefined,
  missions: Mission[] | undefined,
): DashboardMetrics {
  const t = tasks ?? [];
  const count = (s: Task['status']) => t.filter((x) => x.status === s).length;
  return {
    totalTasks: t.length,
    open: count('open'),
    inProgress: count('in_progress'),
    blocked: count('blocked'),
    closed: count('closed'),
    liveSessions: (sessions ?? []).length,
    activeMissions: (missions ?? []).filter((m) => m.state !== 'disengaged').length,
  };
}
