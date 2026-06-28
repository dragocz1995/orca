import type { OrcaEvent } from './sse.js';

/** Lookups needed to resolve an event's owning project. Each returns the project id or null when the
 *  referenced row is gone (events outlive their tasks/jobs), so resolution always fails safe. */
export interface EventProjectDeps {
  /** project_id of a task/epic by its id */
  taskProject(taskId: string): number | null;
  /** project of the task a live session runs (agent:<name> label / mission epic) */
  sessionProject(session: string): number | null;
  /** project of a planning job by its id */
  jobProject(jobId: string): number | null;
}

/** The project an event belongs to, or null when it has no project (or its row is gone). Single source
 *  of truth shared by the activity-log stamping (persisted rows) and the live SSE per-subscriber gate,
 *  so both scope identically. A null result is treated as "admin-only" by callers — fail closed. */
export function eventProjectId(e: OrcaEvent, d: EventProjectDeps): number | null {
  switch (e.type) {
    case 'task':
    case 'review':
    case 'decision':
    case 'change':
      return d.taskProject(e.taskId);
    case 'mission': {
      // A mission id is `m-<epicId>`; the epic carries the project. Strip the prefix to reach it.
      const epicId = e.missionId.startsWith('m-') ? e.missionId.slice(2) : e.missionId;
      return d.taskProject(epicId);
    }
    case 'signal':
      return d.sessionProject(e.session);
    case 'plan':
      // A plan job knows its target project up front; once the epic exists, resolve via it directly.
      return e.epicId ? d.taskProject(e.epicId) : d.jobProject(e.jobId);
  }
}
