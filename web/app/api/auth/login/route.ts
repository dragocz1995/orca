import { daemonUrl, sessionCookie } from '../../../../lib/proxy';

// Proxy-owned login: forward credentials to the daemon, and on success mint the httpOnly session
// cookie here. The daemon token is placed in the cookie and never returned to the browser body, so
// page JS (and any XSS) can't read it.
export async function POST(req: Request): Promise<Response> {
  const body = await req.text();
  const upstream = await fetch(`${daemonUrl()}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
  if (!upstream.ok) {
    // Pass the daemon's status/body through (e.g. 401 bad credentials) without minting a cookie.
    return new Response(await upstream.text(), { status: upstream.status, headers: { 'content-type': 'application/json' } });
  }
  const { token } = (await upstream.json()) as { token: string };
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'content-type': 'application/json', 'set-cookie': sessionCookie(token) },
  });
}
