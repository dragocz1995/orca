// Server-side BFF proxy helpers. The browser only ever talks to this web origin; these helpers let
// the route handlers translate the httpOnly session cookie into a daemon bearer token, guard against
// cross-origin (CSRF) writes, and forward request headers cleanly. None of this runs in the browser.
export const COOKIE_NAME = 'orca_session';

export function daemonUrl(): string {
  return process.env.ORCA_DAEMON_URL ?? 'http://localhost:4400';
}

const ATTRS = 'HttpOnly; Secure; SameSite=Lax; Path=/';

export function sessionCookie(token: string): string {
  return `${COOKIE_NAME}=${token}; ${ATTRS}`;
}

export function clearCookie(): string {
  return `${COOKIE_NAME}=; ${ATTRS}; Max-Age=0`;
}

/** Same-origin guard for mutating requests (CSRF defense-in-depth on top of SameSite=Lax).
 *  A missing Origin header (same-origin GET navigations, some same-origin fetches) is allowed;
 *  a present Origin must match our host. We compare host, not the full origin, because a
 *  TLS-terminating reverse proxy makes the app see http:// internally while the browser's Origin
 *  is https:// — the scheme differs but the host (which is what an attacker can't forge) is what
 *  matters. The host the browser targeted comes from the forwarded Host header. */
export function isSameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (origin == null) return true;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false; // malformed Origin
  }
  const host = req.headers.get('host') ?? new URL(req.url).host;
  return originHost === host;
}

/** Headers safe to forward from the browser to the daemon. An allow-list (not a deny-list) so a
 *  client can never smuggle its own `authorization` (the proxy injects the real bearer), spoof its
 *  source IP via `x-forwarded-for`/`x-real-ip`/`forwarded` (defeating daemon rate-limiting/audit),
 *  or inject hop-by-hop headers. Only content-negotiation headers pass through. */
const FORWARD_ALLOW = new Set(['content-type', 'accept', 'accept-encoding', 'accept-language']);

export function forwardHeaders(req: Request): Headers {
  const h = new Headers();
  for (const [key, value] of req.headers) {
    if (FORWARD_ALLOW.has(key.toLowerCase())) h.set(key, value);
  }
  return h;
}
