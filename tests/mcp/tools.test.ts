import { describe, it, expect } from 'vitest';
import { makeElowenTools } from '../../src/mcp/tools.js';
import type { CallResult } from '../../src/shared/apiClient.js';

type Call = { m: string; p: string; b: unknown; url: string; token: string };

function spy(result: CallResult = { status: 200, ok: true, data: { ok: 1 }, text: '' }) {
  const calls: Call[] = [];
  const call = async (m: string, p: string, b: unknown, o: { url: string; token: string }): Promise<CallResult> => {
    calls.push({ m, p, b, url: o.url, token: o.token });
    return result;
  };
  return { calls, call };
}

describe('makeElowenTools', () => {
  it('elowen_request delegates to callElowenApi with the connection url+token', async () => {
    const { calls, call } = spy();
    const tools = makeElowenTools({ url: 'http://d:4400', token: 'usr', call: call as never });
    const out = await tools.elowen_request({ method: 'POST', path: '/tasks', body: { title: 'x' } });
    expect(calls[0]).toEqual({ m: 'POST', p: '/tasks', b: { title: 'x' }, url: 'http://d:4400', token: 'usr' });
    expect(out).toEqual({ ok: 1 });
  });

  it('typed helpers are thin fixed-route wrappers with no own logic', async () => {
    const { calls, call } = spy();
    const tools = makeElowenTools({ url: 'http://d', token: 't', call: call as never });
    await tools.elowen_tasks();
    await tools.elowen_create_task({ title: 'x', project_id: 1 });
    await tools.elowen_plan({ goal: 'g', project_id: 1 });
    await tools.elowen_sessions();
    expect(calls.map((c) => `${c.m} ${c.p}`)).toEqual(['GET /tasks', 'POST /tasks', 'POST /tasks/plan', 'GET /sessions']);
    expect(calls[1].b).toEqual({ title: 'x', project_id: 1 });
  });

  it('elowen_plan forwards all planning options to POST /tasks/plan', async () => {
    const { calls, call } = spy();
    const tools = makeElowenTools({ url: 'http://d', token: 't', call: call as never });
    await tools.elowen_plan({
      goal: 'build feature',
      project_id: 2,
      name: 'my-mission',
      exec: 'sonnet',
      autoModel: true,
      autonomy: 'L2',
      maxSessions: 3,
      engage: true,
      dryRun: false,
      prompt: 'custom prompt',
      prEnabled: true,
    });
    expect(calls[0].m).toBe('POST');
    expect(calls[0].p).toBe('/tasks/plan');
    expect(calls[0].b).toEqual({
      goal: 'build feature',
      project_id: 2,
      name: 'my-mission',
      exec: 'sonnet',
      autoModel: true,
      autonomy: 'L2',
      maxSessions: 3,
      engage: true,
      dryRun: false,
      prompt: 'custom prompt',
      prEnabled: true,
    });
  });

  it('throws on a non-ok response so the agent sees the error', async () => {
    const { call } = spy({ status: 403, ok: false, data: { error: 'forbidden' }, text: 'forbidden' });
    const tools = makeElowenTools({ url: 'http://d', token: 't', call: call as never });
    await expect(tools.elowen_tasks()).rejects.toThrow(/403/);
  });

  // ---- Notes ----
  it('elowen_note_add maps to POST /notes', async () => {
    const { calls, call } = spy();
    const tools = makeElowenTools({ url: 'http://d', token: 't', call: call as never });
    await tools.elowen_note_add({ target: 'epic-1', body: 'hello' });
    expect(calls[0]).toMatchObject({ m: 'POST', p: '/notes', b: { scope: 'mission', target: 'epic-1', body: 'hello' } });
  });

  it('elowen_notes maps to GET /notes with query', async () => {
    const { calls, call } = spy();
    const tools = makeElowenTools({ url: 'http://d', token: 't', call: call as never });
    await tools.elowen_notes({ target: 'epic-1' });
    expect(calls[0]).toMatchObject({ m: 'GET', p: '/notes?scope=mission&target=epic-1' });
  });

  // ---- Mission lifecycle ----
  it('elowen_missions maps to GET /missions', async () => {
    const { calls, call } = spy();
    const tools = makeElowenTools({ url: 'http://d', token: 't', call: call as never });
    await tools.elowen_missions();
    expect(calls[0]).toMatchObject({ m: 'GET', p: '/missions' });
  });

  it('elowen_mission_engage maps to POST /missions', async () => {
    const { calls, call } = spy();
    const tools = makeElowenTools({ url: 'http://d', token: 't', call: call as never });
    await tools.elowen_mission_engage({ epicId: 'e-1', autonomy: 'L2', maxSessions: 3 });
    expect(calls[0]).toMatchObject({ m: 'POST', p: '/missions', b: { epicId: 'e-1', autonomy: 'L2', maxSessions: 3 } });
  });

  it('elowen_mission_pause maps to PATCH /missions/:id with action pause', async () => {
    const { calls, call } = spy();
    const tools = makeElowenTools({ url: 'http://d', token: 't', call: call as never });
    await tools.elowen_mission_pause({ id: 'm-1' });
    expect(calls[0]).toMatchObject({ m: 'PATCH', p: '/missions/m-1', b: { action: 'pause' } });
  });

  it('elowen_mission_resume maps to PATCH /missions/:id with action resume', async () => {
    const { calls, call } = spy();
    const tools = makeElowenTools({ url: 'http://d', token: 't', call: call as never });
    await tools.elowen_mission_resume({ id: 'm-1' });
    expect(calls[0]).toMatchObject({ m: 'PATCH', p: '/missions/m-1', b: { action: 'resume' } });
  });

  it('elowen_mission_disengage maps to DELETE /missions/:id', async () => {
    const { calls, call } = spy();
    const tools = makeElowenTools({ url: 'http://d', token: 't', call: call as never });
    await tools.elowen_mission_disengage({ id: 'm-1' });
    expect(calls[0]).toMatchObject({ m: 'DELETE', p: '/missions/m-1' });
  });

  // ---- Session control ----
  it('elowen_session_spawn maps to POST /sessions', async () => {
    const { calls, call } = spy();
    const tools = makeElowenTools({ url: 'http://d', token: 't', call: call as never });
    await tools.elowen_session_spawn({ taskId: 't-1', exec: 'sonnet' });
    expect(calls[0]).toMatchObject({ m: 'POST', p: '/sessions', b: { taskId: 't-1', exec: 'sonnet' } });
  });

  it('elowen_session_kill maps to DELETE /sessions/:name', async () => {
    const { calls, call } = spy();
    const tools = makeElowenTools({ url: 'http://d', token: 't', call: call as never });
    await tools.elowen_session_kill({ name: 'elowen-t-1' });
    expect(calls[0]).toMatchObject({ m: 'DELETE', p: '/sessions/elowen-t-1' });
  });

  it('elowen_session_send_keys maps to POST /sessions/:name/keys', async () => {
    const { calls, call } = spy();
    const tools = makeElowenTools({ url: 'http://d', token: 't', call: call as never });
    await tools.elowen_session_send_keys({ name: 'elowen-t-1', keys: ['Enter'] });
    expect(calls[0]).toMatchObject({ m: 'POST', p: '/sessions/elowen-t-1/keys', b: { keys: ['Enter'] } });
  });

  it('elowen_session_read_pane maps to GET /sessions/:name/pane', async () => {
    const { calls, call } = spy();
    const tools = makeElowenTools({ url: 'http://d', token: 't', call: call as never });
    await tools.elowen_session_read_pane({ name: 'elowen-t-1' });
    expect(calls[0]).toMatchObject({ m: 'GET', p: '/sessions/elowen-t-1/pane' });
  });

  it('elowen_session_read_pane with ansi=true adds ?ansi=1', async () => {
    const { calls, call } = spy();
    const tools = makeElowenTools({ url: 'http://d', token: 't', call: call as never });
    await tools.elowen_session_read_pane({ name: 'elowen-t-1', ansi: true });
    expect(calls[0]).toMatchObject({ m: 'GET', p: '/sessions/elowen-t-1/pane?ansi=1' });
  });

  // ---- Task lifecycle ----
  it('elowen_task_update maps to PATCH /tasks/:id with only the passed fields', async () => {
    const { calls, call } = spy();
    const tools = makeElowenTools({ url: 'http://d', token: 't', call: call as never });
    await tools.elowen_task_update({ id: 't-1', status: 'in_progress', title: 'new title' });
    expect(calls[0]).toMatchObject({ m: 'PATCH', p: '/tasks/t-1', b: { status: 'in_progress', title: 'new title' } });
  });

  it('elowen_task_close maps to PATCH /tasks/:id with status closed + outcome', async () => {
    const { calls, call } = spy();
    const tools = makeElowenTools({ url: 'http://d', token: 't', call: call as never });
    await tools.elowen_task_close({ id: 't-1', result_summary: 'done', outcome: 'ok' });
    expect(calls[0]).toMatchObject({ m: 'PATCH', p: '/tasks/t-1', b: { status: 'closed', result_summary: 'done', outcome: 'ok' } });
  });

  it('elowen_task_usage maps to GET /tasks/:id/usage', async () => {
    const { calls, call } = spy();
    const tools = makeElowenTools({ url: 'http://d', token: 't', call: call as never });
    await tools.elowen_task_usage({ id: 't-1' });
    expect(calls[0]).toMatchObject({ m: 'GET', p: '/tasks/t-1/usage' });
  });

  // ---- Non-ok throw for every tool ----
  it.each([
    'elowen_note_add', 'elowen_notes', 'elowen_missions', 'elowen_mission_engage',
    'elowen_mission_pause', 'elowen_mission_resume', 'elowen_mission_disengage',
    'elowen_session_spawn', 'elowen_session_kill', 'elowen_session_send_keys',
    'elowen_session_read_pane', 'elowen_task_update', 'elowen_task_close', 'elowen_task_usage',
  ] as const)('%s throws on non-ok response', async (toolName) => {
    const { call } = spy({ status: 500, ok: false, data: { error: 'boom' }, text: 'Internal Server Error' });
    const tools = makeElowenTools({ url: 'http://d', token: 't', call: call as never });
    const args: Record<string, unknown> = {};
    if (toolName.startsWith('elowen_note_') || toolName.startsWith('elowen_mission_')) args.target = 'x';
    if (toolName.startsWith('elowen_mission_')) args.epicId = 'x';
    if (toolName.startsWith('elowen_session_')) args.name = 'x';
    if (toolName.startsWith('elowen_task_')) args.id = 'x';
    if (toolName === 'elowen_note_add') args.body = 'x';
    if (toolName === 'elowen_session_send_keys') args.keys = ['x'];
    if (toolName === 'elowen_session_spawn') args.taskId = 'x';
    if (toolName === 'elowen_mission_engage') { args.epicId = 'x'; }
    await expect((tools as any)[toolName](args)).rejects.toThrow(/500/);
  });
});
