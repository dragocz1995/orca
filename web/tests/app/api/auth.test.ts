import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { POST as login } from '../../../app/api/auth/login/route';
import { POST as logout } from '../../../app/api/auth/logout/route';

const fetchMock = vi.fn();
beforeEach(() => { process.env.ORCA_DAEMON_URL = 'http://daemon.test'; vi.stubGlobal('fetch', fetchMock); fetchMock.mockReset(); });
afterEach(() => { vi.unstubAllGlobals(); });

function post(url: string, body: unknown) {
  return new Request(url, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://web.test' }, body: JSON.stringify(body) });
}

describe('auth login route', () => {
  it('sets an httpOnly session cookie and returns no token in the body', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ token: 'secret-tok' }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const res = await login(post('https://web.test/api/auth/login', { username: 'admin', password: 'x' }));
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('orca_session=secret-tok');
    expect(setCookie).toMatch(/HttpOnly/);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
    expect(JSON.stringify(body)).not.toContain('secret-tok');
  });

  it('propagates a daemon auth failure without setting a cookie', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'bad credentials' }), { status: 401 }));
    const res = await login(post('https://web.test/api/auth/login', { username: 'admin', password: 'wrong' }));
    expect(res.status).toBe(401);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('rejects a cross-origin login (login CSRF) without calling the daemon', async () => {
    const req = new Request('https://web.test/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://evil.test' },
      body: JSON.stringify({ username: 'admin', password: 'x' }),
    });
    const res = await login(req);
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 502 (not a crash) when the daemon returns a non-JSON 200', async () => {
    fetchMock.mockResolvedValue(new Response('<html>gateway</html>', { status: 200 }));
    const res = await login(post('https://web.test/api/auth/login', { username: 'admin', password: 'x' }));
    expect(res.status).toBe(502);
    expect(res.headers.get('set-cookie')).toBeNull();
  });
});

describe('auth logout route', () => {
  it('expires the cookie', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    const req = new Request('https://web.test/api/auth/logout', { method: 'POST', headers: { origin: 'https://web.test', cookie: 'orca_session=secret-tok' } });
    const res = await logout(req);
    expect(res.headers.get('set-cookie')).toMatch(/Max-Age=0/);
  });

  it('rejects a cross-origin logout (logout CSRF)', async () => {
    const req = new Request('https://web.test/api/auth/logout', { method: 'POST', headers: { origin: 'https://evil.test', cookie: 'orca_session=secret-tok' } });
    const res = await logout(req);
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
