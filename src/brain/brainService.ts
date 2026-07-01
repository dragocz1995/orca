import { createAgentSession } from '@earendil-works/pi-coding-agent';
import type { AgentSession, AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import type { BrainStore } from '../store/brainStore.js';
import type { BrainProviderConfig } from './providers.js';
import { buildBrainRegistry, resolveBrainModel } from './providers.js';
import { buildOrcaTools } from './tools/index.js';
import { projectEvent, projectUserTurn, rehydrate } from './persistence.js';

/** What a channel (web/terminal, later Discord) receives from the brain. Stable regardless of the
 *  underlying PI event shape — the mapping lives in one place (`toBrainEvent`). */
export type BrainEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool'; name: string }
  | { type: 'idle' }
  | { type: 'error'; message: string };

export interface BrainDeps {
  store: BrainStore;
  users: { ensureAdvisorToken(userId: number): string };
  config: BrainProviderConfig;
  /** Daemon REST base the brain's tools call (ORCA_URL). */
  url: string;
  /** Working dir for the in-memory session (not a repo checkout). Default: process.cwd(). */
  cwd?: string;
  /** Injected for tests; defaults to PI's createAgentSession. */
  createSession?: typeof createAgentSession;
}

interface LiveBrain { session: AgentSession; sessionId: string; model: string; listeners: Set<(e: BrainEvent) => void> }

/** Translate a PI session event into the stable BrainEvent contract. Defensive: unknown event types
 *  are dropped. Streaming shapes are refined by the Task 8 smoke; the contract never changes. */
function toBrainEvent(e: AgentSessionEvent): BrainEvent | null {
  if (e.type === 'agent_end') return { type: 'idle' };
  const anyE = e as { type: string; toolName?: string; delta?: string; assistantMessageEvent?: { type?: string; delta?: string } };
  if (anyE.type === 'message_update') {
    const delta = anyE.assistantMessageEvent?.type === 'text_delta' ? anyE.assistantMessageEvent.delta : undefined;
    return delta ? { type: 'text', delta } : null;
  }
  if (typeof anyE.toolName === 'string') return { type: 'tool', name: anyE.toolName };
  return null;
}

/** Per-user embedded brain lifecycle. Mirrors AdvisorService's shape so daemon wiring is familiar,
 *  but holds an in-process PI AgentSession instead of spawning an external CLI. One conversation per
 *  user for step #1 (session id `brain-<userId>`); multi-conversation is a later sub-project. */
export class BrainService {
  private live = new Map<number, LiveBrain>();
  constructor(private d: BrainDeps) {}

  private sessionIdFor(userId: number): string { return `brain-${userId}`; }

  status(userId: number): { running: boolean; sessionId: string | null; model: string } {
    const b = this.live.get(userId);
    return { running: !!b, sessionId: b?.sessionId ?? null, model: b?.model ?? '' };
  }

  async start(userId: number, opts?: { which?: 'openai' | 'anthropic' }): Promise<{ sessionId: string }> {
    const existing = this.live.get(userId);
    if (existing) return { sessionId: existing.sessionId }; // idempotent
    const sessionId = this.sessionIdFor(userId);
    const which = opts?.which ?? this.d.config.default;

    // Ensure the store row (sole source of truth) exists before rehydration.
    const registry = buildBrainRegistry(this.d.config);
    const model = resolveBrainModel(registry, this.d.config, which);
    if (!this.d.store.getSession(sessionId)) {
      this.d.store.createSession({ id: sessionId, userId, model: model.id });
    } else {
      this.d.store.touchSession(sessionId, model.id);
    }

    const cwd = this.d.cwd ?? process.cwd();
    const sessionManager = rehydrate(this.d.store, sessionId, cwd);
    const token = this.d.users.ensureAdvisorToken(userId);
    const tools = buildOrcaTools({ url: this.d.url, token });

    const create = this.d.createSession ?? createAgentSession;
    const { session } = await create({
      cwd,
      sessionManager,
      modelRegistry: registry,
      model,
      customTools: tools,
      tools: tools.map((t) => t.name),
      noTools: 'builtin',
    });

    const listeners = new Set<(e: BrainEvent) => void>();
    session.subscribe((e: AgentSessionEvent) => {
      projectEvent(this.d.store, sessionId, e); // persist settled turns (agent_end)
      const be = toBrainEvent(e);
      if (be) for (const l of listeners) l(be);
    });

    this.live.set(userId, { session, sessionId, model: model.id, listeners });
    return { sessionId };
  }

  subscribe(userId: number, listener: (e: BrainEvent) => void): () => void {
    const b = this.live.get(userId);
    if (!b) throw new Error('brain not started for user');
    b.listeners.add(listener);
    return () => b.listeners.delete(listener);
  }

  async send(userId: number, text: string): Promise<void> {
    const b = this.live.get(userId);
    if (!b) throw new Error('brain not started for user');
    projectUserTurn(this.d.store, b.sessionId, text);
    await b.session.prompt(text);
  }

  stop(userId: number): void {
    const b = this.live.get(userId);
    if (!b) return;
    b.session.dispose();
    this.live.delete(userId);
  }
}
