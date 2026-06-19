import type { MissionTask } from '../../lib/types';

/** A task status is terminal once it can no longer change (closed or cancelled). */
export const isTerminal = (status: string): boolean => status === 'closed' || status === 'cancelled';

/** A dependency edge is a fail-gate when its blocker closed with outcome 'fail' or was cancelled —
 *  downstream work cannot proceed cleanly past it. Single source of truth for the missions UI. */
export function isFailGate(dep: MissionTask): boolean {
  return dep.status === 'cancelled' || (dep.status === 'closed' && dep.outcome === 'fail');
}
