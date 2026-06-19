'use client';
import { useTaskUsage } from '../../lib/queries';
import { UsageBadge } from './UsageBadge';

/** Connected UsageBadge: fetches a task's agent token/cost usage (polling while live) and renders
 *  it. Drop it anywhere a task's agent is shown. Renders nothing until usage is available. */
export function TaskUsageBadge({ taskId, live = false }: { taskId: string; live?: boolean }) {
  const { data } = useTaskUsage(taskId, live);
  if (!data) return null;
  return <UsageBadge usage={data} />;
}
