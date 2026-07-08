import { describe, it, expect } from 'vitest';
import { createStreamController } from '../../../src/cli/chat/streamController.js';
import { fromHistory } from '../../../src/brain/transcript.js';
import type { ChatRuntime } from '../../../src/cli/chat/runtime.js';
import type { Flows } from '../../../src/cli/chat/flows.js';
import type { BrainClient } from '../../../src/cli/chat/brainClient.js';
import type { BrainEvent } from '../../../src/brain/events.js';

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

describe('streamController — passive idle rollover', () => {
  it('buffers events after the session frame and replays them onto the refetched view', async () => {
    let onEvent!: (e: BrainEvent) => void;
    const hist = deferred<{ role: string; text: string }[]>();
    const client = {
      stream: (cb: (e: BrainEvent) => void) => { onEvent = cb; return Promise.resolve(); },
      history: () => hist.promise,
      rebind: () => {},
    } as unknown as BrainClient;

    const ac = new AbortController();
    const rt = {
      client,
      // Last turn is an orca reply → passive client (no fresh local `you` turn), the refetch path.
      view: fromHistory([{ role: 'assistant', text: 'old answer' }]),
      childView: null,
      streamAc: ac,
      notice: '',
      conversationTitle: 'seeded',
      workMode: 'build',
      render: () => {},
      refreshMeta: async () => {},
    } as unknown as ChatRuntime;
    const flows = { launchAsk: () => {}, openPlanDecision: () => {} } as unknown as Flows;

    const stream = createStreamController(rt, flows);
    stream.openStream(ac);

    // Idle rollover: the server continued this message in a FRESH conversation, then a text delta
    // arrives in the SAME batch — before the history refetch resolves.
    onEvent({ type: 'session', sessionId: 'fresh-1' });
    onEvent({ type: 'text', delta: 'streamed after rollover' });

    // The buffered text must NOT have folded into the stale pre-rollover view (it would be discarded).
    const hasStreamed = (): boolean => rt.view.turns.some(
      (t) => t.role === 'orca' && t.segments.some((s) => s.kind === 'text' && s.text.includes('streamed')));
    expect(hasStreamed()).toBe(false);

    // The refetched transcript lands (fresh conversation — only the just-sent prompt).
    hist.resolve([{ role: 'user', text: 'q2' }]);
    await new Promise((r) => setTimeout(r, 0));

    // Fresh view = the refetched user turn PLUS the replayed buffered text.
    expect(rt.view.turns[0]).toEqual({ role: 'you', text: 'q2' });
    expect(hasStreamed()).toBe(true);
  });
});
