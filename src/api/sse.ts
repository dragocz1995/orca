import type { SignalSink, DerivedSignal } from '../deriver/types.js';
import type { PlanJobStatus } from '../overseer/planJob.js';
import type { Phase } from '../overseer/planner.js';

export type OrcaEvent =
  | { type: 'signal'; session: string; signal: DerivedSignal }
  | { type: 'mission'; missionId: string; state: string }
  | { type: 'task'; taskId: string; status: string }
  | { type: 'plan'; jobId: string; status: PlanJobStatus; epicId?: string; phases?: Phase[]; error?: string };

export class EventBus implements SignalSink {
  private subs = new Set<(e: OrcaEvent) => void>();
  subscribe(fn: (e: OrcaEvent) => void): () => void { this.subs.add(fn); return () => this.subs.delete(fn); }
  publish(e: OrcaEvent): void { for (const fn of this.subs) fn(e); }
  emit(session: string, signal: DerivedSignal): void { this.publish({ type: 'signal', session, signal }); }
}
