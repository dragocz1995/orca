import { describe, it, expect, vi } from 'vitest';
import { buildElowenTools } from '../../src/brain/tools/index.js';

function fakeFetch(status: number, body: unknown): typeof fetch {
  return vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
}

describe('buildElowenTools', () => {
  it('exposes the expected tool names (elowen control plane + the owner-chat LSP probe)', () => {
    const names = buildElowenTools({ url: 'http://x', token: 't' }).map((t) => t.name).sort();
    expect(names).toEqual([
      'elowen_create_task', 'elowen_list_missions', 'elowen_list_sessions', 'elowen_list_tasks', 'elowen_plan', 'lsp_diagnostics',
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

  it('surfaces API errors as text instead of throwing', async () => {
    const f = fakeFetch(500, { error: 'boom' });
    const tool = buildElowenTools({ url: 'http://x', token: 't', fetchImpl: f }).find((t) => t.name === 'elowen_list_missions')!;
    const res = await tool.execute('call-3', {});
    expect(res.content[0]!.text).toContain('HTTP 500');
  });
});
