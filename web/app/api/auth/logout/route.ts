import { daemonUrl, clearCookie, COOKIE_NAME } from '../../../../lib/proxy';

function tokenFrom(req: Request): string | null {
  const cookie = req.headers.get('cookie') ?? '';
  const m = cookie.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
  return m ? m[1] : null;
}

// Proxy-owned logout: best-effort daemon-side logout with the cookie's token, then expire the cookie
// regardless so the browser session ends even if the daemon is unreachable.
export async function POST(req: Request): Promise<Response> {
  const token = tokenFrom(req);
  if (token) {
    await fetch(`${daemonUrl()}/auth/logout`, { method: 'POST', headers: { authorization: `Bearer ${token}` } }).catch(() => { /* daemon down: still clear locally */ });
  }
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'content-type': 'application/json', 'set-cookie': clearCookie() },
  });
}
