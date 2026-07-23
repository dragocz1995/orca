import { describe, it, expect } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { loadPlugins } from '../../src/plugins/loader.js';

const log = { info() {}, warn() {}, error() {} };
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CREDS = { appId: 'app-guid', appPassword: 's3cret', tenantId: 'tenant-guid' };

type AdapterModule = {
  MsTeamsAdapter: new (
    cfg: Record<string, unknown>, logger: typeof log, state: unknown, listModels: () => Promise<unknown[]>,
  ) => {
    handleWebhook: (req: { method: string; headers: Record<string, string>; json: () => Promise<unknown> }) => Promise<{ status?: number }>;
    onActivity: (m: unknown) => Promise<void>;
    listen: (h: (src: Record<string, unknown>, text: string) => Promise<string | undefined>) => void;
    stripMention: (t: string) => string;
    isForMe: (m: unknown) => boolean;
    accessFor: (ids: string[], convId: string) => { access?: Record<string, unknown> };
    verifyToken: (h: string | undefined, a: unknown) => Promise<boolean>;
    connector: Record<string, unknown>;
  };
};

class MemoryState {
  data: Record<string, Record<string, unknown>> = {};
  all() { return this.data; }
  get(id: string) { return this.data[id] ?? {}; }
  patch(id: string, fields: Record<string, unknown>) { this.data[id] = { ...this.data[id], ...fields }; }
}

async function makeAdapter(cfg: Record<string, unknown> = {}) {
  const { MsTeamsAdapter } = await import(join(repoRoot, 'plugins/msteams/lib/adapter.mjs')) as AdapterModule;
  const state = new MemoryState();
  const adapter = new MsTeamsAdapter({ ...CREDS, ...cfg }, log, state, async () => []);
  // Quiet transport for unit tests: no network, capture the outbound calls.
  const calls: { kind: string; args: unknown[] }[] = [];
  Object.assign(adapter.connector, {
    typing: async (...args: unknown[]) => { calls.push({ kind: 'typing', args }); },
    reply: async (...args: unknown[]) => { calls.push({ kind: 'reply', args }); return 'act-1'; },
    send: async (...args: unknown[]) => { calls.push({ kind: 'send', args }); return 'act-2'; },
    member: async () => ({ userPrincipalName: 'alex@contoso.com' }),
    download: async () => Buffer.from('img'),
    token: async () => 'tok',
  });
  return { adapter, state, calls };
}

const activity = (over: Record<string, unknown> = {}) => ({
  type: 'message',
  id: 'in-1',
  serviceUrl: 'https://smba.test/emea',
  from: { id: '29:enc', aadObjectId: 'aad-1', name: 'Alex Rivera' },
  recipient: { id: '28:bot', name: 'Elowen' },
  conversation: { id: 'a:conv1', conversationType: 'personal', tenantId: 'tenant-guid' },
  text: 'hello there',
  ...over,
});

describe('msteams plugin registration', () => {
  it('registers no platform or route without full credentials', async () => {
    const reg = await loadPlugins({ dirs: [join(repoRoot, 'plugins')], enabled: ['msteams'], logger: log });
    expect(reg.platforms).toHaveLength(0);
    expect(reg.httpRoutes.size).toBe(0);
  });

  it('registers the platform adapter and the /hooks mount when configured', async () => {
    const reg = await loadPlugins({
      dirs: [join(repoRoot, 'plugins')], enabled: ['msteams'], logger: log,
      config: { msteams: { ...CREDS, rolePolicies: [] } },
    });
    expect(reg.platforms.map((p) => p.name)).toEqual(['msteams']);
    expect([...reg.httpRoutes.keys()]).toEqual(['msteams/messages']);
  });
});

describe('msteams identity + role mapping', () => {
  it('matches Entra GUIDs exactly and UPN/email case-insensitively', async () => {
    const { matchesId, senderIds } = await import(join(repoRoot, 'plugins/msteams/index.mjs')) as {
      matchesId: (a: string, b: string) => boolean; senderIds: (f: unknown, c: string, u?: string) => string[];
    };
    expect(matchesId('aad-1', 'aad-1')).toBe(true);
    expect(matchesId('AAD-1', 'aad-1')).toBe(false);
    expect(matchesId('Alex@Contoso.com', 'alex@contoso.com')).toBe(true);
    expect(senderIds({ id: '29:enc', aadObjectId: 'aad-1' }, 'a:conv1', 'alex@contoso.com'))
      .toEqual(['aad-1', '29:enc', 'alex@contoso.com', 'a:conv1']);
  });

  it('grants access by first matching policy and drops unmapped senders', async () => {
    const { adapter } = await makeAdapter({ rolePolicies: [
      { roleId: 'a:conv1', name: 'Dev', projectIds: [2], prompt: 'Be terse.' },
      { roleId: 'aad-1', admin: true, projectIds: [1] },
    ] });
    const byConversation = adapter.accessFor(['aad-9', '29:x', 'a:conv1'], 'a:conv1');
    expect(byConversation.access).toMatchObject({ admin: false, projectIds: [2] });
    expect(String(byConversation.access?.prompt)).toContain('Be terse.');
    expect(adapter.accessFor(['aad-unknown'], 'a:conv2').access).toBeUndefined();
  });

  it('routes a mapped personal message to the brain and replies via the connector', async () => {
    const { adapter, calls } = await makeAdapter({ rolePolicies: [{ roleId: 'aad-1', projectIds: [1] }] });
    const seen: { src: Record<string, unknown>; text: string }[] = [];
    adapter.listen(async (src, text) => { seen.push({ src, text }); return 'brain says hi'; });
    await adapter.onActivity(activity());
    expect(seen).toHaveLength(1);
    expect(seen[0]!.src).toMatchObject({ platform: 'msteams', userId: 'aad-1', userName: 'Alex Rivera', channelId: 'a:conv1#0' });
    expect(seen[0]!.text).toBe('[Alex Rivera] hello there');
    const reply = calls.find((c) => c.kind === 'reply');
    expect(reply?.args[3]).toMatchObject({ type: 'message', textFormat: 'markdown', text: 'brain says hi' });
  });

  it('drops an unmapped sender without any outbound traffic', async () => {
    const { adapter, calls } = await makeAdapter({ rolePolicies: [] });
    adapter.listen(async () => 'never');
    await adapter.onActivity(activity());
    expect(calls.filter((c) => c.kind === 'reply')).toHaveLength(0);
  });

  it('gates group chats on the bot mention when respondWithoutMention is off, and strips it', async () => {
    const { adapter } = await makeAdapter({ respondWithoutMention: false, rolePolicies: [{ roleId: 'aad-1', projectIds: [] }] });
    const seen: string[] = [];
    adapter.listen(async (_src, text) => { seen.push(text); return undefined; });
    const group = (over: Record<string, unknown>) => activity({
      conversation: { id: 'a:g1', conversationType: 'groupChat', tenantId: 't' }, ...over,
    });
    await adapter.onActivity(group({ text: 'no mention here', entities: [] }));
    expect(seen).toHaveLength(0);
    await adapter.onActivity(group({
      text: '<at>Elowen</at> do the thing',
      entities: [{ type: 'mention', mentioned: { id: '28:bot', name: 'Elowen' } }],
    }));
    expect(seen).toEqual(['[Alex Rivera] do the thing']);
  });
});

describe('msteams webhook JWT validation', () => {
  it('accepts a properly signed token and rejects bad audience/issuer/none', async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    const jwk = { ...(await exportJWK(publicKey)), kid: 'test-key', alg: 'RS256', use: 'sig' };
    const server = createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      if (req.url === '/metadata') res.end(JSON.stringify({ jwks_uri: `http://127.0.0.1:${port}/keys` }));
      else if (req.url === '/keys') res.end(JSON.stringify({ keys: [jwk] }));
      else { res.statusCode = 404; res.end('{}'); }
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;
    try {
      const { makeTokenVerifier } = await import(join(repoRoot, 'plugins/msteams/index.mjs')) as {
        makeTokenVerifier: (cfg: Record<string, unknown>, logger: typeof log) => (h: string | undefined, a: unknown) => Promise<boolean>;
      };
      const verify = makeTokenVerifier({ appId: CREDS.appId, openIdMetadataUrl: `http://127.0.0.1:${port}/metadata` }, log);
      const sign = (claims: Record<string, unknown>, aud = CREDS.appId, iss = 'https://api.botframework.com') =>
        new SignJWT({ serviceUrl: 'https://smba.test/emea', ...claims })
          .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
          .setIssuer(iss).setAudience(aud).setIssuedAt().setExpirationTime('5m')
          .sign(privateKey);

      const act = { serviceUrl: 'https://smba.test/emea' };
      expect(await verify(`Bearer ${await sign({})}`, act)).toBe(true);
      expect(await verify(undefined, act)).toBe(false);
      expect(await verify('Bearer not-a-jwt', act)).toBe(false);
      expect(await verify(`Bearer ${await sign({}, 'other-bot')}`, act)).toBe(false);
      expect(await verify(`Bearer ${await sign({}, CREDS.appId, 'https://evil.example')}`, act)).toBe(false);
      // A token minted for another serviceUrl must not authorize this activity.
      expect(await verify(`Bearer ${await sign({ serviceUrl: 'https://smba.other/region' })}`, act)).toBe(false);
    } finally {
      server.close();
    }
  });

  it('answers 401 on the webhook for an unverified activity and 200 + async turn for a message', async () => {
    const { adapter, calls } = await makeAdapter({ rolePolicies: [{ roleId: 'aad-1', projectIds: [] }] });
    let allow = false;
    adapter.verifyToken = async () => allow;
    let turns = 0;
    adapter.listen(async () => { turns += 1; return 'ok'; });
    const req = { method: 'POST', headers: { authorization: 'Bearer x' }, json: async () => activity() };
    expect((await adapter.handleWebhook(req)).status).toBe(401);
    expect(turns).toBe(0);
    allow = true;
    expect((await adapter.handleWebhook(req)).status).toBe(200);
    await new Promise((r) => setTimeout(r, 20)); // the turn runs detached from the webhook response
    expect(turns).toBe(1);
    expect(calls.some((c) => c.kind === 'reply')).toBe(true);
    expect((await adapter.handleWebhook({ ...req, method: 'GET' })).status).toBe(405);
  });
});
