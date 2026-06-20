import { describe, it, expect } from 'vitest';
import { makeTestApp } from '../helpers/testApp.js';

describe('async plan jobs (relay path)', () => {
  it('POST /tasks/plan (autopilot, relay) returns 202 with a job that resolves done', async () => {
    const { app, token } = await makeTestApp({ fakePlan: '[{"title":"Phase A","type":"task"}]', apiKey: 'k' });
    const res = await app.request('/tasks/plan', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ goal: 'do X' }) });
    expect(res.status).toBe(202);
    const { jobId, epicId } = await res.json() as { jobId: string; epicId: string };
    expect(jobId).toMatch(/^pj-/);
    const job = await (await app.request(`/plan/${jobId}`, { headers: { authorization: `Bearer ${token}` } })).json() as { status: string; phases: unknown[] };
    expect(job.status).toBe('done');
    expect(job.phases).toHaveLength(1);
    expect(epicId).toBeTruthy();
  });

  it('POST /tasks/plan agent mode (pilotExec set) returns 202 with a planning job', async () => {
    const { app, token } = await makeTestApp({ apiKey: '' });
    await app.request('/config', { method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ autopilot: { pilotExec: 'claude:opus' } }) });
    const planRes = await app.request('/tasks/plan', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ goal: 'agent plan' }) });
    expect(planRes.status).toBe(202);
    const { jobId } = await planRes.json() as { jobId: string };
    const job = await (await app.request(`/plan/${jobId}`, { headers: { authorization: `Bearer ${token}` } })).json() as { status: string };
    expect(job.status).toBe('planning');
  });

  it('POST /plan/:id/submit validates phases and creates the epic children', async () => {
    const { app, token } = await makeTestApp({ apiKey: '' });
    await app.request('/config', { method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ autopilot: { pilotExec: 'claude:opus' } }) });
    const { jobId } = await (await app.request('/tasks/plan', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ goal: 'agent plan' }) })).json() as { jobId: string };
    const submit = await app.request(`/plan/${jobId}/submit`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ phases: [{ title: 'Build', type: 'feature' }] }) });
    expect(submit.status).toBe(200);
    const tasks = await (await app.request('/tasks', { headers: { authorization: `Bearer ${token}` } })).json() as { title: string }[];
    expect(tasks.some((t) => t.title === 'Build')).toBe(true);
  });

  it('POST /plan/:id/submit rejects empty/invalid phases', async () => {
    const { app, token } = await makeTestApp({ apiKey: '' });
    await app.request('/config', { method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ autopilot: { pilotExec: 'claude:opus' } }) });
    const { jobId } = await (await app.request('/tasks/plan', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ goal: 'g' }) })).json() as { jobId: string };
    const submit = await app.request(`/plan/${jobId}/submit`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ phases: [] }) });
    expect(submit.status).toBe(400);
  });

  it('POST /tasks/plan dryRun (autopilot) returns 202; job resolves done with phases, nothing persisted', async () => {
    const { app, token } = await makeTestApp({ fakePlan: '[{"title":"A","type":"task"},{"title":"B"}]', apiKey: 'k' });
    const { jobId } = await (await app.request('/tasks/plan', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ goal: 'preview', dryRun: true }) })).json() as { jobId: string };
    const job = await (await app.request(`/plan/${jobId}`, { headers: { authorization: `Bearer ${token}` } })).json() as { status: string; phases: { title: string }[] };
    expect(job.status).toBe('done');
    expect(job.phases.map((p) => p.title)).toEqual(['A', 'B']);
    expect(await (await app.request('/tasks', { headers: { authorization: `Bearer ${token}` } })).json()).toEqual([]);
  });
});
