import { describe, it, expect } from 'vitest';
import { makeTestApp } from '../helpers/testApp.js';

type App = ReturnType<typeof makeTestApp> extends Promise<infer T> ? T : never;

const approveGate = (t: App, id: string) =>
  t.app.request(`/tasks/${id}/approve-gate`, { method: 'POST', headers: { authorization: `Bearer ${t.token}` } });

/** Seed a predecessor phase `pred` and a dependent `dep` blocked behind it, marked with the review
 *  gate label `gatedby:<pred>`. Extra gating predecessors can be added by the caller. */
function gate(t: App, predId: string, depId: string) {
  t.deps.tasks.create({ id: predId, project_id: 1, title: predId, type: 'task', description: predId });
  if (!t.deps.tasks.get(depId)) t.deps.tasks.create({ id: depId, project_id: 1, title: depId, type: 'task', description: depId });
  t.deps.tasks.addDep(depId, predId);
  t.deps.tasks.setStatus(depId, 'blocked');
  t.deps.tasks.addLabel(depId, `gatedby:${predId}`);
}

describe('POST /tasks/:id/approve-gate (human approval of an escalated phase)', () => {
  it('re-opens a dependent gated solely by the approved phase', async () => {
    const t = await makeTestApp({});
    gate(t, 'orca-A', 'orca-D');
    const res = await approveGate(t, 'orca-A');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ released: ['orca-D'] });
    expect(t.deps.tasks.get('orca-D')!.status).toBe('open');
    expect(t.deps.tasks.get('orca-D')!.labels.some((l) => l === 'gatedby:orca-A')).toBe(false);
  });

  it('does NOT release a dependent still gated by another predecessor (P1)', async () => {
    const t = await makeTestApp({});
    gate(t, 'orca-A', 'orca-D'); // D depends on A…
    gate(t, 'orca-B', 'orca-D'); // …and on B; both reviews gate it

    // Approving A alone must not start D while B is still unresolved.
    const r1 = await approveGate(t, 'orca-A');
    expect(await r1.json()).toEqual({ released: [] });
    expect(t.deps.tasks.get('orca-D')!.status).toBe('blocked');
    expect(t.deps.tasks.get('orca-D')!.labels.some((l) => l === 'gatedby:orca-A')).toBe(false); // A's hold cleared…
    expect(t.deps.tasks.get('orca-D')!.labels.some((l) => l === 'gatedby:orca-B')).toBe(true); // …but B's remains

    // Approving B too finally releases D.
    const r2 = await approveGate(t, 'orca-B');
    expect(await r2.json()).toEqual({ released: ['orca-D'] });
    expect(t.deps.tasks.get('orca-D')!.status).toBe('open');
  });

  it('404s for an unknown task', async () => {
    const t = await makeTestApp({});
    const res = await approveGate(t, 'orca-nope');
    expect(res.status).toBe(404);
  });
});
