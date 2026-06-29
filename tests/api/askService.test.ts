import { describe, it, expect, vi } from 'vitest';
import { DecisionQueue } from '../../src/overseer/decisionQueue.js';
import { createAskService, ASK_SENTINEL } from '../../src/api/services/askService.js';

/** Minimal deps for the ask exchange: a task under an active mission, a parked overseer (overseerExec
 *  set), an in-memory event recorder doubling as the message-history source. */
function setup(opts: { overseerExec?: string; mission?: boolean } = {}) {
  const recorded: { type: string; taskId: string; role: string; text: string }[] = [];
  const dq = new DecisionQueue();
  const d = {
    tasks: { get: (id: string) => (id === 't1' ? { id, parent_id: 'e1' } : undefined) },
    missions: { active: () => (opts.mission === false ? [] : [{ id: 'm-e1', epic_id: 'e1' }]) },
    config: { get: () => ({ autopilot: { overseerExec: opts.overseerExec ?? 'sonnet' } }) },
    bus: { publish: (e: { type: string; taskId: string; role: string; text: string }) => { if (e.type === 'message') recorded.push(e); } },
    events: { list: (q: { target: string }) => recorded.filter((e) => e.taskId === q.target).map((e) => ({ detail: JSON.stringify({ role: e.role, text: e.text }) })) },
  } as never;
  return { svc: createAskService({ d, decisionQueue: dq }), dq, recorded };
}

describe('askService', () => {
  it('routes the question to the parked overseer and returns its reply, recording both turns', async () => {
    const { svc, dq, recorded } = setup();
    const { askId } = svc.start('t1', 'A or B?');
    const req = await dq.next('m-e1');
    expect(req!.kind).toBe('message');
    expect(req!.context).toMatchObject({ question: 'A or B?', taskId: 't1' });
    // The overseer is handed the whole thread (its last entry is the just-asked question).
    expect((req!.context.history as { role: string; text: string }[]).at(-1)).toMatchObject({ role: 'agent', text: 'A or B?' });
    dq.resolve('m-e1', req!.id, { approve: false, confidence: 0, rationale: '', message: 'use A' });
    await expect(svc.poll(askId, 1000)).resolves.toBe('use A');
    expect(recorded.map((e) => [e.role, e.text])).toEqual([['agent', 'A or B?'], ['autopilot', 'use A']]);
  });

  it('hands the overseer the MOST RECENT turns (the just-asked question is always included)', async () => {
    const { svc, dq, recorded } = setup();
    // Pre-load a long backlog so a naive oldest-first cap would drop the new question.
    for (let i = 0; i < 40; i++) recorded.push({ type: 'message', taskId: 't1', role: 'agent', text: `old ${i}` });
    const { askId } = svc.start('t1', 'the latest question');
    const req = await dq.next('m-e1');
    const hist = req!.context.history as { role: string; text: string }[];
    expect(hist.length).toBeLessThanOrEqual(30); // bounded
    expect(hist.at(-1)).toMatchObject({ role: 'agent', text: 'the latest question' }); // newest kept, not dropped
    expect(hist.some((h) => h.text === 'old 0')).toBe(false); // the oldest backlog fell out of the window
    dq.resolve('m-e1', req!.id, { approve: false, confidence: 0, rationale: '', message: 'ok' });
    await svc.poll(askId, 1000);
  });

  it('opens a human window when the overseer escalates, and delivers a human reply', async () => {
    const { svc, dq, recorded } = setup();
    const { askId } = svc.start('t1', '?');
    const req = await dq.next('m-e1');
    dq.resolve('m-e1', req!.id, { approve: false, confidence: 0, rationale: 'needs a human' }); // no message ⇒ escalate
    await new Promise((r) => setTimeout(r, 0)); // let resolveExchange open the window
    expect(svc.reply(askId, 'go with A')).toBe(true);
    await expect(svc.poll(askId, 1000)).resolves.toBe('go with A');
    expect(recorded.at(-1)).toMatchObject({ role: 'human', text: 'go with A' });
  });

  it('falls back to the sentinel when no overseer can answer and no human replies in time', async () => {
    vi.useFakeTimers();
    const { svc, recorded } = setup({ mission: false }); // no mission ⇒ straight to the human window
    const { askId } = svc.start('t1', '?');
    await vi.advanceTimersByTimeAsync(5 * 60_000); // window expires with no reply
    await expect(svc.poll(askId, 1000)).resolves.toBe(ASK_SENTINEL);
    expect(recorded.at(-1)).toMatchObject({ role: 'autopilot', text: ASK_SENTINEL });
    vi.useRealTimers();
  });

  it('rejects a reply once the exchange is already answered', async () => {
    const { svc, dq } = setup();
    const { askId } = svc.start('t1', '?');
    const req = await dq.next('m-e1');
    dq.resolve('m-e1', req!.id, { approve: false, confidence: 0, rationale: '', message: 'done' });
    await svc.poll(askId, 1000);
    expect(svc.reply(askId, 'late')).toBe(false);
  });

  it('unblocks with the sentinel when polled with an unknown ask id', async () => {
    await expect(setup().svc.poll('nope', 10)).resolves.toBe(ASK_SENTINEL);
  });
});
