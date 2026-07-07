// Subagent plugin: `delegate` spawns a fresh, isolated sub-agent conversation for one self-contained
// task and returns its final answer. It reuses the platform channel path — the host runs the sub-prompt
// as its own brain session (its own context window, its own tools) and hands back the reply. The child
// inherits EXACTLY the caller's access (ctx.currentAccess), so a scoped session can't widen its reach
// by delegating. Each call gets a unique channel id → a clean-slate agent every time.
import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

const ok = (text) => ({ content: [{ type: 'text', text }], details: {} });

export function register(ctx) {
  let run = null; // the host's channel handler, captured on connect

  ctx.registerPlatform({
    name: 'subagent',
    listen: (onMessage) => { run = onMessage; },
    connect: async () => { /* nothing to connect — we only borrow the handler */ },
    send: async () => { /* replies are returned synchronously from the handler */ },
  });

  ctx.registerTool(defineTool({
    name: 'delegate', label: 'Delegate to sub-agent',
    description: 'Hand a self-contained task to a fresh sub-agent with its own clean context, and get back '
      + 'its result. Use for focused side-quests (research a file, draft a section, run a check) so your '
      + 'main conversation stays uncluttered. The sub-agent has the same tools and access as you.',
    parameters: Type.Object({
      task: Type.String({ description: 'The complete, self-contained instruction for the sub-agent — it does not see this conversation.' }),
    }),
    execute: async (id, p) => {
      if (!run) return ok('Error: delegation is not wired up on this server.');
      const access = { ...ctx.currentAccess(), prompt: 'You are a focused sub-agent. Complete the task and report the result concisely — no preamble.' };
      const channelId = `sub-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      // Capture the PARENT turn's progress emitter NOW: the child's event callbacks below run inside the
      // CHILD session's turn scope, where ctx accessors no longer resolve to the delegating conversation.
      const emit = ctx.subagentEmitter();
      const started = Date.now();
      const st = { sessionId: '', tools: 0, detail: undefined, tokens: undefined };
      const push = (status) => {
        if (!emit || !st.sessionId) return;
        emit({ id, sessionId: st.sessionId, status, task: p.task, detail: st.detail, tools: st.tools, tokens: st.tokens, seconds: Math.round((Date.now() - started) / 1000) });
      };
      // Distil the child's live stream into progress updates: which tool it runs, how many so far, its
      // token spend. Low-frequency events only (tool starts + step boundaries) — text deltas are ignored.
      const onEvent = (e) => {
        if (e.type === 'session' && e.sessionId) { st.sessionId = e.sessionId; push('running'); }
        else if (e.type === 'tool' && e.name) { st.tools += 1; st.detail = e.detail ? `${e.name} ${e.detail}` : e.name; push('running'); }
        else if ((e.type === 'step' || e.type === 'idle') && e.usage?.totalTokens) { st.tokens = e.usage.totalTokens; push('running'); }
      };
      const reply = await run({ platform: 'subagent', userId: 'subagent', roleIds: [], channelId, access }, p.task, onEvent)
        .catch((e) => { push('error'); return `Error: ${e?.message ?? e}`; });
      if (!reply?.startsWith('Error:')) push('done');
      return ok(reply || '(the sub-agent returned nothing)');
    },
  }));

  ctx.logger.info('delegate tool registered');
}
