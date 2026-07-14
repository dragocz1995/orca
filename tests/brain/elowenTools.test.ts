import { describe, it, expect, vi } from 'vitest';
import { buildElowenTools } from '../../src/brain/tools/index.js';

function fakeFetch(status: number, body: unknown): typeof fetch {
  return vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
}

describe('buildElowenTools', () => {
  it('exposes the expected tool names (elowen control plane + the owner-chat LSP probe)', () => {
    const names = buildElowenTools({ url: 'http://x', token: 't' }).map((t) => t.name).sort();
    expect(names).toEqual([
      'elowen_create_task', 'elowen_list_missions', 'elowen_list_sessions', 'elowen_list_tasks', 'elowen_plan', 'elowen_update_task', 'lsp_diagnostics',
    ]);
  });

  it('elowen_create_task POSTs to /tasks and returns the created task text', async () => {
    const f = fakeFetch(200, { id: 'elowen-1', title: 'Fix build' });
    const tool = buildElowenTools({ url: 'http://x', token: 't', fetchImpl: f }).find((t) => t.name === 'elowen_create_task')!;
    const res = await tool.execute('call-1', { title: 'Fix build', project_id: 1 });
    expect(f).toHaveBeenCalledWith('http://x/tasks', expect.objectContaining({ method: 'POST' }));
    expect(res.content[0]!.text).toContain('elowen-1');
  });

  it('elowen_list_tasks GETs /tasks', async () => {
    const f = fakeFetch(200, [{ id: 'elowen-1' }]);
    const tool = buildElowenTools({ url: 'http://x', token: 't', fetchImpl: f }).find((t) => t.name === 'elowen_list_tasks')!;
    await tool.execute('call-2', {});
    expect(f).toHaveBeenCalledWith('http://x/tasks', expect.objectContaining({ method: 'GET' }));
  });

  // Without this tool the brain could open a task but never move it: create was write-only.
  describe('elowen_update_task', () => {
    const updateTool = (f: typeof fetch) =>
      buildElowenTools({ url: 'http://x', token: 't', fetchImpl: f }).find((t) => t.name === 'elowen_update_task')!;

    it('PATCHes /tasks/:id with only the fields that were passed', async () => {
      const f = fakeFetch(200, { id: 'elowen-1', status: 'in_progress' });
      const res = await updateTool(f).execute('call-4', { task_id: 'elowen-1', status: 'in_progress' });
      expect(f).toHaveBeenCalledWith('http://x/tasks/elowen-1', expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ status: 'in_progress' }), // title/description absent, not sent as undefined
      }));
      expect(res.content[0]!.text).toContain('in_progress');
    });

    it('carries a rename and a new description together', async () => {
      const f = fakeFetch(200, { id: 'elowen-1' });
      await updateTool(f).execute('call-5', { task_id: 'elowen-1', title: 'New title', description: 'Why' });
      expect(f).toHaveBeenCalledWith('http://x/tasks/elowen-1', expect.objectContaining({
        body: JSON.stringify({ title: 'New title', description: 'Why' }),
      }));
    });

    it('escapes the task id into the path', async () => {
      const f = fakeFetch(200, {});
      await updateTool(f).execute('call-6', { task_id: 'a/b?c', status: 'closed' });
      expect(f).toHaveBeenCalledWith('http://x/tasks/a%2Fb%3Fc', expect.anything());
    });

    it('refuses an empty update instead of firing a no-op PATCH that reads as success', async () => {
      const f = fakeFetch(200, {});
      const res = await updateTool(f).execute('call-7', { task_id: 'elowen-1' });
      expect(f).not.toHaveBeenCalled();
      expect(res.content[0]!.text).toMatch(/nothing to update/i);
    });
  });

  it('surfaces API errors as text instead of throwing', async () => {
    const f = fakeFetch(500, { error: 'boom' });
    const tool = buildElowenTools({ url: 'http://x', token: 't', fetchImpl: f }).find((t) => t.name === 'elowen_list_missions')!;
    const res = await tool.execute('call-3', {});
    expect(res.content[0]!.text).toContain('HTTP 500');
  });
});
