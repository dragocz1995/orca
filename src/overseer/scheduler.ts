import type { TaskStore } from '../store/taskStore.js';
import type { SpawnService } from '../spawn/spawn.js';
import type { EventBus } from '../api/sse.js';
import type { AgentSpec } from '../spawn/commandBuilder.js';
import type { Clock } from '../shared/clock.js';
import { KeyedMutex } from '../shared/keyedMutex.js';
import { resolveExecutor } from './routing.js';
import { projectHead } from '../integrations/projectFiles.js';
import { busySharedCheckouts, checkoutOf } from './checkout.js';
import { logger } from '../shared/logger.js';

const log = logger('scheduler');

export interface SchedulerDeps {
  tasks: TaskStore; spawn: SpawnService; bus: EventBus;
  /** Every registered project — the scheduler launches due tasks across all of them. */
  projects: { list(): { id: number; path: string }[]; get(id: number): { id: number; path: string } | null };
  fallback: AgentSpec;
  nameAgent: () => string; clock: Clock;
  /** Serializes the spawn-time baseline read so a shared checkout's HEAD can't shift mid-snapshot.
   *  Must be the SAME instance shared with the mission engine and API server, or cross-component
   *  serialization breaks. Absent → a private lock (fine for isolated unit tests). */
  gitLock?: KeyedMutex;
  /** A PR mission's isolated worktree, used to tell a shared checkout apart from an isolated one when
   *  deciding whether a standalone task must wait for the checkout to free up. */
  worktreeFor?: (missionId: string) => string | null | undefined;
  /** Max autostart tasks to launch per project in a single tick. Caps a burst of co-scheduled tasks
   *  (e.g. 50 due at the same minute) from spawning 50 parallel agents at once and exhausting API
   *  quota/resources; the rest stay due and fire on the next tick. */
  maxPerProjectPerTick?: number;
}

const DEFAULT_MAX_PER_PROJECT_PER_TICK = 5;

/** Launches open, autostart tasks whose scheduled_at has arrived, then clears the schedule.
 *  Scheduled tasks without autostart are due-date markers only — never auto-launched.
 *  Runs across every registered project. */
export class Scheduler {
  private readonly gitLock: KeyedMutex;
  constructor(private d: SchedulerDeps) { this.gitLock = d.gitLock ?? new KeyedMutex(); }

  async tick(): Promise<void> {
    const now = this.d.clock.now();
    const limit = this.d.maxPerProjectPerTick ?? DEFAULT_MAX_PER_PROJECT_PER_TICK;
    // Shared (non-PR) checkouts are single-writer: a task waits for the checkout to free up so its
    // committed delta stays cleanly attributable. Track which are occupied across ALL projects/missions
    // (a non-PR mission phase and a standalone task can target the same project.path) and grow the set
    // as this tick launches more.
    const resolver = { projectPath: (id: number) => this.d.projects.get(id)?.path ?? '', worktreeFor: this.d.worktreeFor };
    const busy = busySharedCheckouts(resolver, this.d.tasks.list({ status: 'in_progress' }));
    for (const project of this.d.projects.list()) {
      // Compare as epochs (#39): `scheduled_at` is stored as the client sent it, which may carry a
      // non-UTC zone (e.g. `+02:00`). A lexical string compare against a UTC ISO `now` would then
      // misjudge the same instant. `Date.parse` collapses both to absolute time.
      const due = this.d.tasks
        .list({ project_id: project.id, status: 'open' })
        .filter((t) => t.autostart && t.scheduled_at != null && Date.parse(t.scheduled_at) <= now);
      let launched = 0;
      for (const task of due) {
        if (launched >= limit) break; // per-project burst cap — the rest stay due for the next tick
        const cwd = checkoutOf(resolver, task); // a standalone task's checkout is the shared project path
        if (busy.has(cwd)) continue; // shared checkout already has a live agent — serialize, retry next tick
        const spec = resolveExecutor(task.labels, this.d.fallback);
        const named = task.labels.find((l) => l.startsWith('agent:'))?.slice('agent:'.length);
        const agentName = named || this.d.nameAgent();
        const originalSchedule = task.scheduled_at;
        this.d.tasks.update(task.id, { scheduled_at: null }); // consume so it fires once
        this.d.tasks.setAgent(task.id, agentName);            // link task → session for run controls
        this.d.tasks.markStarted(task.id, now); // precise spawn time → correct usage attribution under concurrency
        // Read HEAD + stamp the baseline under the checkout lock, so it lands AFTER any in-flight
        // commit on this checkout (a just-closed task still committing) and the snapshot range is exact.
        await this.gitLock.run(cwd, async () => this.d.tasks.markBase(task.id, await projectHead(cwd)));
        this.d.tasks.setStatus(task.id, 'in_progress');
        try {
          await this.d.spawn.launch({
            projectId: project.id, projectPath: cwd, taskId: task.id,
            agentName, spec, taskTitle: task.title, taskDescription: task.description,
            epicId: task.parent_id ?? undefined,
          });
        } catch (e) {
          // Spawn failed (tmux down, bin missing): roll back so the schedule isn't silently lost (O9).
          // Restore status to open and the original scheduled_at so the next tick retries it.
          this.d.tasks.update(task.id, { scheduled_at: originalSchedule });
          this.d.tasks.setStatus(task.id, 'open');
          this.d.bus.publish({ type: 'task', taskId: task.id, status: 'open' });
          log.error(`spawn failed for task ${task.id} — schedule restored`, e);
          continue;
        }
        busy.add(cwd); // this checkout is now occupied — later tasks this tick wait for it
        this.d.bus.publish({ type: 'task', taskId: task.id, status: 'in_progress' });
        launched++;
      }
    }
  }
}
