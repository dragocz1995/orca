import type { GoalView } from './brainClient.js';
import { parseDbTs } from '../../shared/time.js';

/** Immediate local projection used while POST /brain/goal waits for the long kickoff turn. The daemon's
 * streamed `goal` snapshot replaces this object as soon as the durable row exists. */
export function createOptimisticGoal(goal: string, sessionId = '', now = Date.now()): GoalView {
  const timestamp = new Date(now).toISOString();
  return {
    session_id: sessionId,
    user_id: 0,
    status: 'active',
    goal,
    draft: '',
    subgoals: '[]',
    turns_used: 0,
    turn_budget: 0,
    last_verdict: '',
    last_evidence: '',
    paused_reason: '',
    created_at: timestamp,
    updated_at: timestamp,
  };
}

/** SQLite timestamps are UTC but omit the zone suffix. Parse that storage form explicitly instead of
 * letting JavaScript reinterpret it as the terminal's local timezone. */
export function goalElapsedSeconds(goal: GoalView, now = Date.now()): number {
  const startedAt = parseDbTs(goal.created_at.trim()); // shared SQLite/ISO parser: UTC-tags the zone-less DB form
  if (!startedAt) return 0;
  return Math.max(0, Math.floor((now - startedAt) / 1_000));
}
