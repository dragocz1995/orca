import type { TaskStore } from '../store/taskStore.js';
import type { Readiness } from '../store/readiness.js';
import type { MissionStore, Mission } from '../store/missionStore.js';
import type { SpawnService } from '../spawn/spawn.js';
import type { TmuxDriver } from '../tmux/types.js';
import type { AgentSpec } from '../spawn/commandBuilder.js';
import type { EventBus } from '../api/sse.js';
import { detectGuardrails, isCleared } from './guardrails.js';
import { resolveExecutor } from './routing.js';

export interface MissionEngineDeps {
  tasks: TaskStore; readiness: Readiness; missions: MissionStore;
  spawn: SpawnService; tmux: TmuxDriver; bus: EventBus;
  project: { id: number; path: string }; fallback: AgentSpec;
  nameAgent: () => string;
}

export class MissionEngine {
  constructor(private d: MissionEngineDeps) {}

  async engage(input: { epicId: string; autonomy: string; maxSessions: number; clearedGuardrails: string[] }): Promise<Mission> {
    const id = `m-${input.epicId}`;
    const m = this.d.missions.create({ id, epic_id: input.epicId, autonomy: input.autonomy, max_sessions: input.maxSessions, cleared_guardrails: input.clearedGuardrails });
    this.d.bus.publish({ type: 'mission', missionId: m.id, state: 'active' });
    await this.tick(id);
    return m;
  }

  isActive(id: string): boolean { return this.d.missions.get(id)?.state === 'active'; }

  /** Hard-stop a mission's active work: kill the live tmux session of every in-progress child
   *  and revert it to open. Without this, pausing/disengaging only flips the mission state while
   *  the agent keeps running — so the UI still reads as "running". A later resume re-spawns from
   *  open. Returns the number of agents stopped. */
  async stopRunning(epicId: string): Promise<number> {
    const live = new Set(await this.d.tmux.list());
    let stopped = 0;
    for (const t of this.children(epicId)) {
      if (t.status !== 'in_progress') continue;
      const agent = t.labels.find((l) => l.startsWith('agent:'))?.slice('agent:'.length);
      const session = agent ? `orca-${agent}` : null;
      if (session && live.has(session)) await this.d.tmux.kill(session);
      this.d.tasks.setStatus(t.id, 'open');
      this.d.bus.publish({ type: 'task', taskId: t.id, status: 'open' });
      stopped++;
    }
    return stopped;
  }

  async disengage(id: string): Promise<void> {
    const m = this.d.missions.get(id);
    if (m) await this.stopRunning(m.epic_id);
    this.d.missions.setState(id, 'disengaged');
    this.d.bus.publish({ type: 'mission', missionId: id, state: 'disengaged' });
  }

  async pause(id: string): Promise<void> {
    const m = this.d.missions.get(id);
    if (m) await this.stopRunning(m.epic_id);
    this.d.missions.setState(id, 'paused');
    this.d.bus.publish({ type: 'mission', missionId: id, state: 'paused' });
  }

  private children(epicId: string) {
    return this.d.tasks.list({ project_id: this.d.project.id }).filter(t => t.parent_id === epicId && t.type !== 'epic');
  }

  async tick(id: string): Promise<void> {
    const m = this.d.missions.get(id); if (!m || m.state !== 'active') return;

    const kids = this.children(m.epic_id);
    if (kids.length > 0 && kids.every(t => t.status === 'closed' || t.status === 'cancelled')) {
      this.d.missions.setState(id, 'disengaged'); this.d.bus.publish({ type: 'mission', missionId: id, state: 'disengaged' }); return;
    }

    // Slots in use = this epic's own in-progress children — NOT all global orca- tmux
    // sessions (other projects/missions would otherwise starve this one).
    let running = kids.filter(t => t.status === 'in_progress').length;
    for (const task of this.d.readiness.ready(this.d.project.id)) {
      if (running >= m.max_sessions) break;
      if (task.parent_id !== m.epic_id) continue;
      const triggered = detectGuardrails(`${task.title} ${task.labels.join(' ')}`);
      const permitted = (m.autonomy === 'L3' || m.autonomy === 'L2') && isCleared(triggered, m.cleared_guardrails);
      if (!permitted) continue;
      const spec = resolveExecutor(task.labels, this.d.fallback);
      const named = task.labels.find((l) => l.startsWith('agent:'))?.slice('agent:'.length);
      const agentName = named || this.d.nameAgent();
      // Tag the agent BEFORE marking in_progress, so an in_progress child always carries its
      // agent label — otherwise a crash between the two writes would leave stopRunning unable to
      // find (and kill) the session.
      if (!named) this.d.tasks.setAgent(task.id, agentName);
      this.d.tasks.setStatus(task.id, 'in_progress');
      await this.d.spawn.launch({ projectId: this.d.project.id, projectPath: this.d.project.path, taskId: task.id, agentName, spec, taskTitle: task.title, taskDescription: task.description, epicId: m.epic_id });
      running++;
    }
  }
}
