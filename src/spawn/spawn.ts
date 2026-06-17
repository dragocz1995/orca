import type { TmuxDriver } from '../tmux/types.js';
import type { AgentStore } from '../store/agentStore.js';
import { buildAgentCommand, type AgentSpec } from './commandBuilder.js';

export class SpawnService {
  constructor(private d: { tmux: TmuxDriver; agents: AgentStore }) {}
  async launch(input: { projectId: number; projectPath: string; taskId: string; agentName: string; spec: AgentSpec }): Promise<{ session: string }> {
    this.d.agents.upsert({ project_id: input.projectId, name: input.agentName, program: input.spec.program, model: input.spec.model });
    const session = `orca-${input.agentName}`;
    const command = buildAgentCommand(input.spec, { projectPath: input.projectPath, taskId: input.taskId, agentName: input.agentName });
    await this.d.tmux.spawn(session, { cwd: input.projectPath, command });
    return { session };
  }
}
