import type { TmuxDriver } from '../tmux/types.js';
import type { AgentStore } from '../store/agentStore.js';
import type { TaskStore } from '../store/taskStore.js';
import type { Clock } from '../shared/clock.js';
import { detectAgentPrompt } from './shellPatterns.js';
import type { SignalSink, DerivedSignal } from './types.js';

const PANE_TAIL = 60;
function hash(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }

export interface DeriverDeps {
  tmux: TmuxDriver; agents: AgentStore; tasks: TaskStore;
  sink: SignalSink; clock?: Clock;
  /** Resolve the task a session is working (signal file / registry); injected for testability. */
  sessionTaskId: (session: string) => string | null;
}

export class Deriver {
  private last = new Map<string, string>();
  constructor(private d: DeriverDeps) {}

  start(): () => void {
    const clock = this.d.clock; if (!clock) throw new Error('Deriver.start requires a clock');
    return clock.setInterval(() => void this.tick(), 5000);
  }

  async tick(): Promise<void> {
    const sessions = (await this.d.tmux.list()).filter(s => s.startsWith('orca-'));
    for (const session of sessions) {
      const program = this.d.agents.programFor(session.replace(/^orca-/, ''));
      if (!program || program.startsWith('claude')) continue;
      const taskId = this.d.sessionTaskId(session); if (!taskId) continue;
      const task = this.d.tasks.get(taskId); if (!task) continue;

      if (task.status === 'closed') { this.emitOnce(session, 'complete', { type: 'complete' }); continue; }
      if (task.status !== 'in_progress' && task.status !== 'open') continue;

      const prompt = detectAgentPrompt(await this.d.tmux.capturePane(session, PANE_TAIL), program);
      if (prompt?.autoApprove) {
        const key = `auto:${hash(prompt.question + prompt.context)}`;
        if (this.last.get(session) === key) continue;
        this.last.set(session, key);
        await this.d.tmux.sendKeys(session, prompt.autoApprove.keys);
        this.d.sink.emit(session, { type: 'working' });
        continue;
      }
      if (prompt) {
        const key = `need:${hash(prompt.question + prompt.context)}`;
        if (this.last.get(session) === key) continue;
        this.last.set(session, key);
        this.d.sink.emit(session, { type: 'needs_input', question: prompt.question, options: prompt.options, context: prompt.context });
        continue;
      }
      this.last.set(session, 'working');
      this.d.sink.emit(session, { type: 'working' });
    }
  }

  private emitOnce(session: string, key: string, sig: DerivedSignal) {
    if (this.last.get(session) === key) return;
    this.last.set(session, key);
    this.d.sink.emit(session, sig);
  }
}
