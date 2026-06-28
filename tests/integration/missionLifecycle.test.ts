import { describe, it, expect } from 'vitest';
import { makeTestApp } from '../helpers/testApp.js';

const post = (t: string, body: unknown) => ({ method: 'POST', headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
const patch = (t: string, body: unknown) => ({ method: 'PATCH', headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });

/** End-to-end through the HTTP layer (plan → engage → spawn → close → advance → disengage), exercising
 *  the wiring between the routes, the plan persistence, the mission engine and the close/review path —
 *  which the engine-level unit tests drive directly, not through the API. */
describe('mission lifecycle via the API', () => {
  it('plans + engages a two-phase mission, spawns the ready head, and advances on close', async () => {
    const { app, token, deps } = await makeTestApp({});
    // Manual mode: explicit phases → synchronous create + engage, no LLM needed. P2 chains after P1.
    const res = await app.request('/tasks/plan', post(token, {
      goal: 'ship it', engage: true, autonomy: 'L3', maxSessions: 1,
      phases: [{ title: 'Phase 1', type: 'task' }, { title: 'Phase 2', type: 'task' }],
    }));
    expect(res.status).toBe(201);
    const { epic, mission } = await res.json() as { epic: { id: string }; mission: { id: string } };
    expect(mission.id).toBe(`m-${epic.id}`);
    expect(deps.missions.get(mission.id)?.state).toBe('active');

    // Engaging ticks the engine, which spawns the ready head (Phase 1) into a live session.
    const phases = deps.tasks.descendants(epic.id);
    const p1 = phases.find((t) => t.title === 'Phase 1')!;
    const p2 = phases.find((t) => t.title === 'Phase 2')!;
    expect(p1.status).toBe('in_progress');
    expect(p2.status).toBe('open'); // still gated behind P1
    expect(await deps.tmux.list()).toContain(`orca-${deps.tasks.get(p1.id)!.labels.find((l) => l.startsWith('agent:'))!.slice('agent:'.length)}`);

    // Close Phase 1 through the API, then tick: the engine advances and spawns Phase 2.
    expect((await app.request(`/tasks/${p1.id}`, patch(token, { status: 'closed', outcome: 'done' }))).status).toBe(200);
    await deps.engine.tick(mission.id);
    expect(deps.tasks.get(p2.id)?.status).toBe('in_progress');

    // Close Phase 2 (the leaf): the mission has no more work and auto-disengages on the next tick.
    expect((await app.request(`/tasks/${p2.id}`, patch(token, { status: 'closed', outcome: 'done' }))).status).toBe(200);
    await deps.engine.tick(mission.id);
    expect(deps.missions.get(mission.id)?.state).toBe('disengaged');
  });

  it('drives a post-done review verdict through the overseer HTTP endpoints to release the gate', async () => {
    const { app, token, deps } = await makeTestApp({});
    // Turn on the review gate (an agent overseer + reviewOnDone), then seed a chained mission.
    await app.request('/config', { method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ autopilot: { overseerExec: 'claude:opus', reviewOnDone: true } }) });
    const { missionId, childId, nextId } = deps.seedMissionWithChain();

    // Start the overseer long-poll, then close P1 — the close enqueues a review and hard-gates P2.
    const nextP = app.request(`/missions/${missionId}/overseer/next?timeoutMs=2000`, { headers: { authorization: `Bearer ${token}` } });
    expect((await app.request(`/tasks/${childId}`, patch(token, { status: 'closed', outcome: 'ok', result_summary: 'done' }))).status).toBe(200);
    const req = await (await nextP).json() as { id: string; kind: string };
    expect(req.kind).toBe('review');
    expect(deps.tasks.get(nextId)!.status).toBe('blocked'); // gated while the verdict is pending

    // Approve through the HTTP decide endpoint; the verdict apply releases the gate.
    const decided = await app.request(`/missions/${missionId}/overseer/decide`, post(token, { id: req.id, approve: true, confidence: 0.9, rationale: 'looks good' }));
    expect(decided.status).toBe(200);
    await new Promise((r) => setTimeout(r, 30)); // let the verdict .then() release + tick spawn P2
    expect(deps.tasks.get(nextId)!.status).toBe('in_progress'); // gate opened, P2 spawned
  });
});
