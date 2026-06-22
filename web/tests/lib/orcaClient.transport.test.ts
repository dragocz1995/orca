import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { orcaClient, BASE } from '../../lib/orcaClient';

const fetchMock = vi.fn();
beforeEach(() => { vi.stubGlobal('fetch', fetchMock); fetchMock.mockReset(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('orcaClient transport', () => {
  it('targets the same-origin /api base with same-origin credentials and no Authorization header', async () => {
    fetchMock.mockResolvedValue(new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }));
    await orcaClient.tasks();
    const [url, init] = fetchMock.mock.calls[0];
    expect(BASE).toBe('/api');
    expect(url).toBe('/api/tasks');
    expect(init.credentials).toBe('same-origin');
    expect(new Headers(init.headers).get('authorization')).toBeNull();
  });

  it('login posts credentials and resolves to {ok:true} (no token surfaced)', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const r = await orcaClient.login('admin', 'x');
    expect(r).toEqual({ ok: true });
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/auth/login');
  });
});
