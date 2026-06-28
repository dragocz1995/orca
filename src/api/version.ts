import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';

/** This package's version, read once from its package.json (two dirs up from dist/api/version.js, and
 *  likewise from src/api/version.ts in dev/tests). Surfaced on /health so the web UI can show it. */
export const ORCA_VERSION = (() => {
  try { return (JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json'), 'utf8')) as { version?: string }).version ?? '0.0.0'; }
  catch { return '0.0.0'; }
})();

/** Port the daemon listens on — the MCP route reaches back into this same daemon's REST API at it. */
export const ORCA_PORT = Number(process.env.ORCA_PORT ?? 4400);

// Latest published orcasynth version from the npm registry, cached for 30 min so the System panel's
// polling never hammers npm. A failed fetch keeps any prior good value and returns null otherwise —
// the panel just won't show an "update available" badge rather than erroring.
let latestCache: { ts: number; val: string | null } | null = null;
const LATEST_TTL_MS = 30 * 60 * 1000;
export async function defaultLatestVersion(): Promise<string | null> {
  const now = Date.now();
  if (latestCache && now - latestCache.ts < LATEST_TTL_MS) return latestCache.val;
  try {
    const r = await fetch('https://registry.npmjs.org/orcasynth/latest');
    if (!r.ok) throw new Error(`registry ${r.status}`);
    const body = await r.json() as { version?: string };
    latestCache = { ts: now, val: body.version ?? latestCache?.val ?? null };
  } catch {
    latestCache = { ts: now, val: latestCache?.val ?? null }; // keep last good; null until first success
  }
  return latestCache.val;
}

/** Kick off a manual `orca update`, detached so it survives the very service restart it triggers
 *  (same mechanism as orca-update.service). The caller gates on missions first. */
export function defaultStartUpdate(): void {
  spawn('orca', ['update'], { detached: true, stdio: 'ignore' }).unref();
}
