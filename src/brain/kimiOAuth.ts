import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { pollOAuthDeviceCodeFlow } from '@earendil-works/pi-ai/oauth';
import type { OAuthCredentials, OAuthLoginCallbacks, OAuthProviderInterface } from '@earendil-works/pi-ai';

/**
 * Kimi Code (Moonshot AI) sign-in: RFC 8628 device authorization.
 *
 * PI owns everything stateful — `AuthStorage` refreshes lazily on read under a file lock and re-checks
 * inside it, so the daemon, CLI and cron can race safely against one `auth.json`. This module is only the
 * three pure-ish operations PI asks a provider for: run a device flow, exchange a refresh token, and say
 * which field is the API key.
 *
 * The client id and the `X-Msh-*` contract are lifted from Kimi's CLI (there is no published OAuth spec);
 * a rotation on their side surfaces as a failed login, never as silent corruption.
 */

/** Kimi Code's OAuth client id. */
const CLIENT_ID = '17e5f671-d194-4dfb-9706-5516cb48c098';
const DEVICE_CODE_URL = 'https://auth.kimi.com/api/oauth/device_authorization';
const TOKEN_URL = 'https://auth.kimi.com/api/oauth/token';

/** Kimi CLI's own identity. Matches the descriptors PI ships for the `kimi-coding` provider, which pin the
 *  same `User-Agent` per model — the endpoint is the coding subscription's, not the generic Moonshot API. */
export const KIMI_CLI_VERSION = '1.5';
const USER_AGENT = `KimiCLI/${KIMI_CLI_VERSION}`;

/** PI compares `Date.now() >= credentials.expires` with no margin of its own, so the margin has to live in
 *  the value we store. Five minutes, the same skew PI's own GitHub Copilot provider bakes in. */
const EXPIRY_SKEW_MS = 5 * 60 * 1000;

/** Kimi credentials carry the device identity the flow was authorized under. `OAuthCredentials` is an open
 *  record precisely so a provider can round-trip its own fields (Copilot carries `enterpriseUrl` this way).
 *  It matters here: Kimi's CLI keeps one device id across refreshes, so a fresh id on every refresh would
 *  present the same account as an endless stream of new devices. */
interface KimiCredentials extends OAuthCredentials {
  deviceId: string;
}

const deviceModel = (): string => `${process.platform} ${process.arch}`;

/** A header value fetch will accept. Header values are Latin-1, and `fetch` throws a TypeError on anything
 *  outside it — so a machine named e.g. "Filip's-Macbook-Přenosný" would fail every Kimi call before it left
 *  the process. The name is only a label in Kimi's device list, so dropping the odd character is a fair
 *  trade for a login that works; an empty result falls back rather than sending a blank header. */
const headerSafe = (value: string, fallback: string): string => {
  const cleaned = value.replace(/[^\x20-\x7E\xA0-\xFF]/g, '').trim();
  return cleaned || fallback;
};

const authHeaders = (deviceId: string): Record<string, string> => ({
  'Accept': 'application/json',
  'Content-Type': 'application/x-www-form-urlencoded',
  'User-Agent': USER_AGENT,
  'X-Msh-Platform': 'kimi_cli',
  'X-Msh-Version': KIMI_CLI_VERSION,
  'X-Msh-Device-Id': deviceId,
  'X-Msh-Device-Name': headerSafe(hostname(), 'unknown'),
  'X-Msh-Device-Model': deviceModel(),
});

interface FormResponse {
  ok: boolean;
  status: number;
  statusText: string;
  data: unknown;
}

/**
 * POST a form and parse the JSON body. The status is REPORTED, never enforced: the token endpoint answers
 * `400 {"error":"authorization_pending"}` while it waits for the user, so a caller that rejects on a
 * non-2xx would abort every login the instant it started. Verified live against auth.kimi.com — and note
 * the Go client this was modelled on gets the same result the same way, by ignoring the status on the token
 * call, whatever its comment claims. Each caller decides what its own statuses mean.
 */
async function postForm(url: string, deviceId: string, body: Record<string, string>, signal?: AbortSignal): Promise<FormResponse> {
  const response = await fetch(url, {
    method: 'POST',
    headers: authHeaders(deviceId),
    body: new URLSearchParams(body),
    signal,
  });
  const text = await response.text();
  let data: unknown;
  try {
    data = JSON.parse(text) as unknown;
  } catch {
    throw new Error(`Kimi ${response.status} returned a non-JSON response: ${text.slice(0, 200)}`);
  }
  return { ok: response.ok, status: response.status, statusText: response.statusText, data };
}

/** The OAuth error code in a response body, whatever the status carrying it. */
const errorCode = (data: unknown): string | undefined =>
  isRecord(data) && typeof data.error === 'string' ? data.error : undefined;

const errorText = (r: FormResponse): string => {
  const code = errorCode(r.data);
  const description = isRecord(r.data) && typeof r.data.error_description === 'string' ? r.data.error_description : '';
  if (code) return description ? `${code}: ${description}` : code;
  return `${r.status} ${r.statusText}`;
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

interface DeviceCode {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  intervalSeconds?: number;
  expiresInSeconds: number;
}

async function startDeviceFlow(deviceId: string, signal?: AbortSignal): Promise<DeviceCode> {
  const response = await postForm(DEVICE_CODE_URL, deviceId, { client_id: CLIENT_ID }, signal);
  // Unlike the token call, there is no pending state here: a non-2xx is a real refusal.
  if (!response.ok) throw new Error(`Kimi refused the device request (${errorText(response)})`);
  const raw = response.data;
  if (!isRecord(raw)) throw new Error('Invalid Kimi device code response');
  const { device_code: deviceCode, user_code: userCode, interval, expires_in: expiresIn } = raw;
  // Kimi returns both; the pre-filled one is what the user actually wants to open.
  const uri = raw.verification_uri_complete ?? raw.verification_uri;
  if (typeof deviceCode !== 'string' || typeof userCode !== 'string' || typeof uri !== 'string'
    || typeof expiresIn !== 'number' || (interval !== undefined && typeof interval !== 'number')) {
    throw new Error('Invalid Kimi device code response fields');
  }
  // This URI reaches a browser opener, so it must be a real http(s) URL and never anything `open` could
  // execute. Same guard PI applies to Copilot's device response.
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    throw new Error('Untrusted verification_uri in Kimi device code response');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Untrusted verification_uri in Kimi device code response');
  }
  return { deviceCode, userCode, verificationUri: parsed.href, intervalSeconds: interval, expiresInSeconds: expiresIn };
}

/** Shape a token response into PI's credential. Kimi reports `expires_in` seconds from now. */
function toCredentials(raw: unknown, deviceId: string, fallbackRefresh?: string): KimiCredentials {
  if (!isRecord(raw)) throw new Error('Invalid Kimi token response');
  const { access_token: access, refresh_token: refresh, expires_in: expiresIn } = raw;
  if (typeof access !== 'string' || access === '') throw new Error('Kimi token response carried no access token');
  // A refresh that rotates its own token replaces it; one that does not keeps the token we already hold.
  const refreshToken = typeof refresh === 'string' && refresh !== '' ? refresh : fallbackRefresh;
  if (!refreshToken) throw new Error('Kimi token response carried no refresh token');
  return {
    refresh: refreshToken,
    access,
    expires: typeof expiresIn === 'number' && expiresIn > 0
      ? Date.now() + expiresIn * 1000 - EXPIRY_SKEW_MS
      // No expiry told: treat it as already due so the next read revalidates rather than trusting it forever.
      : 0,
    deviceId,
  };
}

async function pollForToken(device: DeviceCode, deviceId: string, signal?: AbortSignal): Promise<KimiCredentials> {
  return pollOAuthDeviceCodeFlow<KimiCredentials>({
    intervalSeconds: device.intervalSeconds,
    expiresInSeconds: device.expiresInSeconds,
    waitBeforeFirstPoll: true,
    signal,
    poll: async () => {
      const response = await postForm(TOKEN_URL, deviceId, {
        client_id: CLIENT_ID,
        device_code: device.deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }, signal);
      // The BODY decides, never the status: while the user has not approved yet, Kimi answers
      // `400 {"error":"authorization_pending"}`, so treating a non-2xx as failure would kill every login
      // on its first poll.
      const code = errorCode(response.data);
      if (code === 'authorization_pending') return { status: 'pending' };
      if (code === 'slow_down') {
        // PI adds RFC 8628's +5s itself when the server names no new interval.
        const interval = isRecord(response.data) ? response.data.interval : undefined;
        return { status: 'slow_down', intervalSeconds: typeof interval === 'number' ? interval : undefined };
      }
      if (code) return { status: 'failed', message: `Kimi login failed: ${errorText(response)}` };
      if (isRecord(response.data) && typeof response.data.access_token === 'string') {
        return { status: 'complete', value: toCredentials(response.data, deviceId) };
      }
      return { status: 'failed', message: `Invalid Kimi device token response (${errorText(response)})` };
    },
  });
}

/** The device id a refresh must replay, tolerating a credential written before this field existed. */
const credentialDeviceId = (credentials: OAuthCredentials): string =>
  typeof credentials.deviceId === 'string' && credentials.deviceId ? credentials.deviceId : randomUUID();

/**
 * Kimi's OAuth provider, minus `id` — `ModelRegistry.registerProvider` stamps the id from the provider
 * name it is registered under, and doing that through the registry (rather than calling
 * `registerOAuthProvider` here) is deliberate: it is what puts the provider in the same module instance
 * `AuthStorage` reads. npm ships two physical copies of pi-ai and only that one counts.
 */
export const kimiOAuthProvider: Omit<OAuthProviderInterface, 'id'> = {
  name: 'Kimi',
  async login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
    const deviceId = randomUUID();
    const device = await startDeviceFlow(deviceId, callbacks.signal);
    callbacks.onDeviceCode({
      userCode: device.userCode,
      verificationUri: device.verificationUri,
      intervalSeconds: device.intervalSeconds,
      expiresInSeconds: device.expiresInSeconds,
    });
    return pollForToken(device, deviceId, callbacks.signal);
  },
  async refreshToken(credentials: OAuthCredentials): Promise<OAuthCredentials> {
    const deviceId = credentialDeviceId(credentials);
    const response = await postForm(TOKEN_URL, deviceId, {
      client_id: CLIENT_ID,
      grant_type: 'refresh_token',
      refresh_token: credentials.refresh,
    });
    // No pending state on a refresh: a refusal here is final and must surface, so PI stops handing out an
    // access token the endpoint has already rejected and the operator is told to sign in again.
    if (!response.ok || errorCode(response.data)) {
      throw new Error(`Kimi refused the refresh (${errorText(response)})`);
    }
    return toCredentials(response.data, deviceId, credentials.refresh);
  },
  getApiKey(credentials: OAuthCredentials): string {
    return credentials.access;
  },
};
