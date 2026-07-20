// Reusable real-daemon harness for the brain E2E suites.
//
// Boots the ACTUAL built daemon (`dist/daemon/index.js`) as a child process on a throwaway loopback
// port, backed by a throwaway SQLite DB + config/data dir under `os.tmpdir()`. Everything the daemon
// writes (DB, brain auth, plugin data, logs, avatars, marketplace cache) lands under that one temp dir,
// and HOME is redirected there too so the boot-time skill self-install can never touch the real user's
// `~/.claude` / `~/.codex` / `~/.config`. A custom brain provider pointing at a scripted model server is
// injected AFTER boot over the authenticated `PUT /config` API (the daemon reads brain config live, so no
// restart is needed). Robust teardown kills the child and removes the temp dir.
//
// SAFETY: never uses ports 4400/4500 (auto-selects a free ephemeral port), never touches the prod DB
// (/var/www/.config/elowen/elowen.db), config dir or systemd services, and never runs `elowen up`.

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const daemonEntry = join(repoRoot, 'dist', 'daemon', 'index.js');

/** Grab a free loopback TCP port by binding to port 0 and reading it back. Guarantees we never collide
 *  with prod's 4400/4500 (the OS hands out an ephemeral high port). */
function freePort() {
  return new Promise((resolvePort, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      srv.close(() => (port ? resolvePort(port) : reject(new Error('failed to allocate a free port'))));
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Poll `GET /health` until the daemon answers `{ ok: true }` or the hard deadline elapses. */
async function waitForHealth(baseUrl, deadlineMs) {
  const until = Date.now() + deadlineMs;
  let lastErr = 'no attempt';
  while (Date.now() < until) {
    try {
      const res = await fetch(`${baseUrl}/health`);
      if (res.ok) {
        const body = await res.json();
        if (body && body.ok) return;
      }
      lastErr = `status ${res.status}`;
    } catch (e) { lastErr = e instanceof Error ? e.message : String(e); }
    await sleep(100);
  }
  throw new Error(`daemon did not become healthy within ${deadlineMs}ms (last: ${lastErr})`);
}

/**
 * Boot a real daemon, inject a custom brain provider, and return handles for driving it.
 *
 * @param {object} opts
 * @param {string} opts.providerBaseUrl  OpenAI-compatible base URL (must end in `/v1`) of the model server.
 * @param {string} [opts.providerId]     Config id for the injected provider (default 'e2e').
 * @param {string} [opts.model]          Model id the provider advertises (default 'mock-model').
 * @param {number} [opts.healthTimeoutMs] Hard deadline for boot readiness (default 30000).
 * @returns {Promise<{ baseUrl: string, token: string, dataDir: string, port: number, providerId: string, model: string, stop: ()=>Promise<void> }>}
 */
export async function spawnRealDaemon(opts) {
  if (!opts?.providerBaseUrl) throw new Error('spawnRealDaemon requires providerBaseUrl');
  const providerId = opts.providerId ?? 'e2e';
  const model = opts.model ?? 'mock-model';
  const healthTimeoutMs = opts.healthTimeoutMs ?? 30_000;

  const dataDir = mkdtempSync(join(tmpdir(), 'elowen-brain-e2e-'));
  const dbPath = join(dataDir, 'elowen.db');
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const bootstrapUser = 'admin';
  const bootstrapPass = `e2e-${Math.random().toString(36).slice(2)}`;

  // Start from a filtered copy of the parent env: drop every ELOWEN_* prod var and every agent-CLI config
  // override so nothing points back at prod paths, then set our own throwaway values + a redirected HOME.
  const childEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith('ELOWEN_')) continue;
    if (k === 'CLAUDE_CONFIG_DIR' || k === 'CODEX_HOME' || k === 'XDG_CONFIG_HOME' || k === 'XDG_DATA_HOME') continue;
    childEnv[k] = v;
  }
  Object.assign(childEnv, {
    HOME: dataDir,
    ELOWEN_DB: dbPath,
    ELOWEN_PORT: String(port),
    ELOWEN_HOST: '127.0.0.1',
    ELOWEN_PROJECT: 'e2e',
    ELOWEN_PROJECT_PATH: dataDir,
    ELOWEN_LOG_DIR: join(dataDir, 'logs'),
    ELOWEN_BOOTSTRAP_USER: bootstrapUser,
    ELOWEN_BOOTSTRAP_PASS: bootstrapPass,
  });

  const child = spawn(process.execPath, [daemonEntry], { cwd: dataDir, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  const logs = [];
  child.stdout.on('data', (d) => logs.push(d.toString()));
  child.stderr.on('data', (d) => logs.push(d.toString()));
  let exited = null;
  child.on('exit', (code, signal) => { exited = { code, signal }; });

  const stop = async () => {
    try {
      if (exited === null) {
        child.kill('SIGTERM');
        for (let i = 0; i < 30 && exited === null; i += 1) await sleep(100);
        if (exited === null) child.kill('SIGKILL');
      }
    } finally {
      try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* best-effort cleanup */ }
    }
  };

  try {
    await waitForHealth(baseUrl, healthTimeoutMs);

    // Authenticate as the bootstrapped admin → bearer token.
    const loginRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: bootstrapUser, password: bootstrapPass }),
    });
    if (!loginRes.ok) throw new Error(`login failed: HTTP ${loginRes.status} ${await loginRes.text()}`);
    const { token } = await loginRes.json();
    if (!token) throw new Error('login returned no token');

    // Inject the custom brain provider pointing at the scripted model server. brainConfigFromElowen reads
    // this live on the next brain start, so no daemon restart is required.
    const cfgRes = await fetch(`${baseUrl}/config`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({
        brain: { providers: [{ id: providerId, label: 'E2E Model', type: 'openai', baseUrl: opts.providerBaseUrl, models: [model], apiKey: 'e2e-test-key' }] },
      }),
    });
    if (!cfgRes.ok) throw new Error(`config PUT failed: HTTP ${cfgRes.status} ${await cfgRes.text()}`);

    return { baseUrl, token, dataDir, port, providerId, model, stop };
  } catch (e) {
    const tail = logs.join('').split('\n').slice(-40).join('\n');
    await stop();
    const detail = exited ? ` (daemon exited code=${exited.code} signal=${exited.signal})` : '';
    throw new Error(`spawnRealDaemon failed${detail}: ${e instanceof Error ? e.message : String(e)}\n--- daemon log tail ---\n${tail}`);
  }
}
