import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { kimiOAuthProvider } from '../../src/brain/kimiOAuth.js';
import type { OAuthCredentials, OAuthDeviceCodeInfo, OAuthLoginCallbacks } from '@earendil-works/pi-ai';

/** A device_authorization body Kimi would actually return. `interval: 0` keeps the poller from sleeping
 *  its RFC-mandated seconds between attempts — PI clamps to a 1s floor, which is what the fake timers below
 *  are for. */
const deviceBody = (over: Record<string, unknown> = {}) => ({
  device_code: 'DEV-1', user_code: 'TX0N-8JJ7',
  verification_uri: 'https://www.kimi.com/code/authorize_device',
  verification_uri_complete: 'https://www.kimi.com/code/authorize_device?user_code=TX0N-8JJ7',
  expires_in: 1800, interval: 1, ...over,
});

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Queue one response per call, so a test states the exact device-flow conversation it expects. */
function mockFetch(responses: Response[]) {
  const calls: { url: string; body: string; headers: Record<string, string> }[] = [];
  const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
    calls.push({
      url: String(url),
      body: String(init?.body ?? ''),
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    const next = responses.shift();
    if (!next) throw new Error(`unexpected extra fetch to ${String(url)}`);
    return next;
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

const callbacks = (onDeviceCode: (i: OAuthDeviceCodeInfo) => void = () => {}): OAuthLoginCallbacks => ({
  onDeviceCode,
  onAuth: () => {},
  onPrompt: async () => '',
  onSelect: async () => undefined,
});

describe('Kimi OAuth device flow', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  /** Run a login to completion while letting the poller's sleeps elapse instantly. The outcome is captured
   *  synchronously: a login that rejects while the timers are still draining would otherwise spend a tick
   *  with no handler attached, which Node reports as an unhandled rejection and vitest fails the file for. */
  const login = async (cb: OAuthLoginCallbacks = callbacks()) => {
    const settled = kimiOAuthProvider.login(cb).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    await vi.runAllTimersAsync();
    const result = await settled;
    if (!result.ok) throw result.error;
    return result.value;
  };

  it('polls through authorization_pending and slow_down, then returns credentials', async () => {
    // The 400s are the real contract, not a detail: verified live against auth.kimi.com, the token endpoint
    // answers `400 {"error":"authorization_pending"}` while it waits for the user. An earlier version of
    // this test mocked those as 200 — copied from a comment in the Go client this was modelled on — and so
    // stayed green while every real login died on its first poll. The body decides; the status does not.
    const calls = mockFetch([
      jsonResponse(deviceBody()),
      jsonResponse({ error: 'authorization_pending', error_description: 'Authorization is pending' }, 400),
      jsonResponse({ error: 'slow_down', interval: 1 }, 400),
      jsonResponse({ access_token: 'AT-1', refresh_token: 'RT-1', expires_in: 3600, token_type: 'Bearer' }),
    ]);
    const seen: OAuthDeviceCodeInfo[] = [];
    const creds = await login(callbacks((i) => seen.push(i)));

    expect(creds.access).toBe('AT-1');
    expect(creds.refresh).toBe('RT-1');
    // The user is shown the pre-filled URL and the code exactly once, before any polling.
    expect(seen).toHaveLength(1);
    expect(seen[0]?.userCode).toBe('TX0N-8JJ7');
    expect(seen[0]?.verificationUri).toContain('user_code=TX0N-8JJ7');
    expect(calls[0]?.url).toContain('/device_authorization');
    expect(calls.slice(1).every((c) => c.url.endsWith('/oauth/token'))).toBe(true);
  });

  it('expires five minutes early so a token is never handed out on its last breath', async () => {
    // PI refreshes on a bare `Date.now() >= expires` with no margin of its own, so the margin must be
    // baked into the value we store.
    vi.setSystemTime(new Date('2026-07-16T12:00:00Z'));
    mockFetch([
      jsonResponse(deviceBody()),
      jsonResponse({ access_token: 'AT-1', refresh_token: 'RT-1', expires_in: 3600 }),
    ]);
    const creds = await login();
    // Measured against the clock as it stands once the flow settles, not against the start: the poller
    // sleeps its interval before the first attempt, so the token is minted a beat after login() is called.
    expect(creds.expires).toBe(Date.now() + 3600_000 - 5 * 60_000);
    expect(creds.expires).toBeLessThan(Date.now() + 3600_000);
  });

  it('identifies itself as the Kimi CLI on every auth call', async () => {
    const calls = mockFetch([
      jsonResponse(deviceBody()),
      jsonResponse({ access_token: 'AT-1', refresh_token: 'RT-1', expires_in: 3600 }),
    ]);
    await login();
    for (const call of calls) {
      expect(call.headers['User-Agent']).toBe('KimiCLI/1.5');
      expect(call.headers['X-Msh-Platform']).toBe('kimi_cli');
      expect(call.headers['X-Msh-Device-Id']).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  it('surfaces access_denied and expired_token rather than polling on', async () => {
    // Also 400-carried, like the pending states — only the error code tells them apart.
    for (const error of ['access_denied', 'expired_token']) {
      mockFetch([jsonResponse(deviceBody()), jsonResponse({ error, error_description: 'nope' }, 400)]);
      await expect(login()).rejects.toThrow(new RegExp(error));
      vi.unstubAllGlobals();
    }
  });

  it('refuses a verification_uri that is not http(s)', async () => {
    // The URI reaches a browser opener; anything else could make `open` run a local executable.
    mockFetch([jsonResponse(deviceBody({ verification_uri_complete: 'file:///etc/passwd' }))]);
    await expect(login()).rejects.toThrow(/Untrusted verification_uri/);
  });

  it('reports a rejected device request with the endpoint response', async () => {
    // The device call has no pending state, so here a non-2xx IS a refusal and must abort.
    mockFetch([jsonResponse({ error: 'invalid_client', error_description: 'bad client' }, 401)]);
    await expect(login()).rejects.toThrow(/invalid_client/);
  });
});

describe('Kimi OAuth refresh', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  const stored = (over: Partial<OAuthCredentials> = {}): OAuthCredentials =>
    ({ access: 'OLD', refresh: 'RT-1', expires: 0, deviceId: 'dev-uuid-1', ...over });

  it('replays the device id the account was authorized under', async () => {
    // Kimi's CLI keeps one device id for the life of a credential; minting a fresh one on every refresh
    // would show the account an endless parade of new devices.
    const calls = mockFetch([jsonResponse({ access_token: 'AT-2', refresh_token: 'RT-2', expires_in: 3600 })]);
    const next = await kimiOAuthProvider.refreshToken(stored());
    expect(calls[0]?.headers['X-Msh-Device-Id']).toBe('dev-uuid-1');
    expect(calls[0]?.body).toContain('grant_type=refresh_token');
    expect(next.access).toBe('AT-2');
    expect(next.refresh).toBe('RT-2');
    expect(next.deviceId).toBe('dev-uuid-1');
  });

  it('keeps the current refresh token when the response does not rotate it', async () => {
    mockFetch([jsonResponse({ access_token: 'AT-2', expires_in: 3600 })]);
    expect((await kimiOAuthProvider.refreshToken(stored())).refresh).toBe('RT-1');
  });

  it('surfaces a rejected refresh instead of returning the stale credential', async () => {
    // Returning the old credential here would loop: PI would keep using an access token the endpoint
    // already refuses, and the user would never be told to sign in again.
    mockFetch([jsonResponse({ error: 'invalid_grant', error_description: 'expired' }, 401)]);
    await expect(kimiOAuthProvider.refreshToken(stored())).rejects.toThrow(/invalid_grant/);
  });

  it('refuses an error body even when the endpoint dresses it as a 200', async () => {
    // The mirror of the poller's rule. There the body overrides a 400; here it must override a 200, so a
    // refusal can never be mistaken for a token no matter which status carries it.
    mockFetch([jsonResponse({ error: 'invalid_grant', error_description: 'expired' }, 200)]);
    await expect(kimiOAuthProvider.refreshToken(stored())).rejects.toThrow(/invalid_grant/);
  });

  it('survives a credential stored before device ids were carried', async () => {
    const calls = mockFetch([jsonResponse({ access_token: 'AT-2', refresh_token: 'RT-2', expires_in: 3600 })]);
    const { deviceId, ...legacy } = stored();
    await kimiOAuthProvider.refreshToken(legacy as OAuthCredentials);
    expect(calls[0]?.headers['X-Msh-Device-Id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('reads the access token as the API key', () => {
    expect(kimiOAuthProvider.getApiKey(stored({ access: 'AT-9' }))).toBe('AT-9');
  });
});
