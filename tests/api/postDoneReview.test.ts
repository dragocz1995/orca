import { describe, it, expect } from 'vitest';
import { makeTestApp } from '../helpers/testApp.js';

describe('post-done review', () => {
  it('enqueues a review decision when a phase with a downstream dependent closes (reviewOnDone+overseerExec set)', async () => {
    const { app, token, deps } = await makeTestApp({});
    await app.request('/config', { method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ autopilot: { overseerExec: 'claude:opus', reviewOnDone: true } }) });
    const { missionId, childId } = deps.seedMissionWithChain(); // P1 gates P2 — there is something to hold back
    const poll = deps.decisionQueue.next(missionId, 2000);
    await app.request(`/tasks/${childId}`, { method: 'PATCH', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ status: 'closed', outcome: 'ok', result_summary: 'done' }) });
    const req = await poll;
    expect(req?.kind).toBe('review');
  });

  it('blocks the dependent phase immediately at close, before the overseer answers (hard gate)', async () => {
    const { app, token, deps } = await makeTestApp({});
    await app.request('/config', { method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ autopilot: { overseerExec: 'claude:opus', reviewOnDone: true } }) });
    const { childId, nextId } = deps.seedMissionWithChain();
    await app.request(`/tasks/${childId}`, { method: 'PATCH', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ status: 'closed', outcome: 'ok', result_summary: 'done' }) });
    // Hard gate: P2 must be blocked the instant P1 closes — no race with the 90s tick, no spawn until
    // the review approves. (Before the gate, P2 would sit 'open' and be spawnable on the next tick.)
    expect(deps.tasks.get(nextId)!.status).toBe('blocked');
  });

  it('an approved review releases the gated phase so it spawns next', async () => {
    const { app, token, deps } = await makeTestApp({});
    await app.request('/config', { method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ autopilot: { overseerExec: 'claude:opus', reviewOnDone: true } }) });
    const { missionId, childId, nextId } = deps.seedMissionWithChain();
    const poll = deps.decisionQueue.next(missionId, 2000);
    await app.request(`/tasks/${childId}`, { method: 'PATCH', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ status: 'closed', outcome: 'ok', result_summary: 'done' }) });
    const req = await poll;
    expect(deps.tasks.get(nextId)!.status).toBe('blocked'); // gated while the review is pending
    deps.decisionQueue.resolve(missionId, req!.id, { approve: true, confidence: 0.9, destructive: false, rationale: 'looks good' });
    await new Promise((r) => setTimeout(r, 30)); // let the verdict .then() release + tick spawn P2
    expect(deps.tasks.get(nextId)!.status).toBe('in_progress'); // released and spawned — the gate opened
  });

  it('a rejected review verdict blocks the dependent open phase', async () => {
    const { app, token, deps } = await makeTestApp({});
    await app.request('/config', { method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ autopilot: { overseerExec: 'claude:opus', reviewOnDone: true } }) });
    const { missionId, childId, nextId } = deps.seedMissionWithChain();
    const poll = deps.decisionQueue.next(missionId, 2000);
    await app.request(`/tasks/${childId}`, { method: 'PATCH', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ status: 'closed', outcome: 'ok', result_summary: 'sketchy' }) });
    const req = await poll;
    // Overseer rejects → the next phase (P2, which depends on P1) must be blocked.
    deps.decisionQueue.resolve(missionId, req!.id, { approve: false, confidence: 0, destructive: false, rationale: 'bad result' });
    await new Promise((r) => setTimeout(r, 20)); // let the .then() run
    expect(deps.tasks.get(nextId)!.status).toBe('blocked');
  });

  it('does not enqueue a review when reviewOnDone is false (default)', async () => {
    const { app, token, deps } = await makeTestApp({});
    await app.request('/config', { method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ autopilot: { overseerExec: 'claude:opus' } }) });
    const { missionId, childId } = deps.seedMissionWithChild();
    const poll = deps.decisionQueue.next(missionId, 300);
    await app.request(`/tasks/${childId}`, { method: 'PATCH', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ status: 'closed', outcome: 'ok' }) });
    expect(await poll).toBeNull();
  });
});
