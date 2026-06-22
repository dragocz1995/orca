import { describe, it, expect, beforeEach } from 'vitest';
import { daemonUrl, sessionCookie, clearCookie, isSameOrigin, forwardHeaders, COOKIE_NAME } from '../../lib/proxy';

describe('proxy helpers', () => {
  beforeEach(() => { delete process.env.ORCA_DAEMON_URL; });

  it('daemonUrl falls back to localhost:4400', () => {
    expect(daemonUrl()).toBe('http://localhost:4400');
    process.env.ORCA_DAEMON_URL = 'http://localhost:9999';
    expect(daemonUrl()).toBe('http://localhost:9999');
  });

  it('sessionCookie is httpOnly, secure, lax', () => {
    const c = sessionCookie('tok123');
    expect(c).toContain(`${COOKIE_NAME}=tok123`);
    expect(c).toMatch(/HttpOnly/);
    expect(c).toMatch(/Secure/);
    expect(c).toMatch(/SameSite=Lax/);
  });

  it('clearCookie expires the cookie', () => {
    expect(clearCookie()).toMatch(/Max-Age=0/);
    expect(clearCookie()).toContain(`${COOKIE_NAME}=;`);
  });

  it('isSameOrigin: no Origin header is allowed', () => {
    expect(isSameOrigin(new Request('https://web.example/api/tasks'))).toBe(true);
  });

  it('isSameOrigin: matching Origin allowed, foreign rejected', () => {
    const ok = new Request('https://web.example/api/tasks', { headers: { Origin: 'https://web.example' } });
    const bad = new Request('https://web.example/api/tasks', { headers: { Origin: 'https://evil.example' } });
    expect(isSameOrigin(ok)).toBe(true);
    expect(isSameOrigin(bad)).toBe(false);
  });

  it('forwardHeaders strips cookie/host/connection', () => {
    const h = forwardHeaders(new Request('https://web.example/api/x', {
      headers: { cookie: 'orca_session=t', host: 'web.example', 'content-type': 'application/json' },
    }));
    expect(h.get('cookie')).toBeNull();
    expect(h.get('host')).toBeNull();
    expect(h.get('content-type')).toBe('application/json');
  });

  it('forwardHeaders drops client-supplied auth and forwarded-for headers (no smuggling/IP spoofing)', () => {
    const h = forwardHeaders(new Request('https://web.example/api/x', {
      headers: {
        authorization: 'Bearer attacker-token',
        'x-forwarded-for': '1.2.3.4',
        'x-real-ip': '1.2.3.4',
        forwarded: 'for=1.2.3.4',
        'x-forwarded-host': 'evil.example',
        accept: 'application/json',
      },
    }));
    expect(h.get('authorization')).toBeNull();
    expect(h.get('x-forwarded-for')).toBeNull();
    expect(h.get('x-real-ip')).toBeNull();
    expect(h.get('forwarded')).toBeNull();
    expect(h.get('x-forwarded-host')).toBeNull();
    // Legitimate content-negotiation headers still pass through.
    expect(h.get('accept')).toBe('application/json');
  });
});
