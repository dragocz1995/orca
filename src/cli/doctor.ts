import * as p from '@clack/prompts';
import { login } from './setup.js';
import { webBaseUrl } from './installInfo.js';
import { color } from './chat/theme.js';

/** One readiness check as returned by `GET /system/readiness`. */
interface ReadinessCheck { id: string; label: string; ok: boolean; detail: string; hint?: string }
interface ReadinessResponse { checks: ReadinessCheck[] }

/** Unwrap a @clack/prompts result — Ctrl+C/Esc during the login prompt just aborts the command (exit 1)
 *  rather than crashing with a stack trace. */
function guard<T>(value: T | symbol): T {
  if (p.isCancel(value)) { p.cancel('Cancelled.'); process.exit(1); }
  return value as T;
}

/** Prompt for admin credentials (default username `admin`) and sign in via the same `/auth/login` helper
 *  the setup wizard uses, retrying on a bad password. `ORCA_TOKEN` skips the prompt entirely — the
 *  non-interactive override for scripts/CI that already hold a bearer. */
async function authenticate(base: string, env: NodeJS.ProcessEnv): Promise<string> {
  const envToken = env.ORCA_TOKEN;
  if (envToken) return envToken;
  p.intro('🐋 Orca doctor');
  for (;;) {
    const username = guard(await p.text({ message: 'Admin username', initialValue: 'admin' })).trim();
    const password = guard(await p.password({ message: 'Admin password' }));
    const s = p.spinner();
    s.start('Signing in…');
    try {
      const token = await login(fetch, base, { username, password });
      s.stop('Signed in.');
      return token;
    } catch (e) {
      s.stop(`Sign-in failed: ${(e as Error).message}`);
    }
  }
}

/** `orca doctor` — a layperson-readable readiness report: what works, and how to fix what doesn't. Never
 *  hangs a non-interactive caller: without a TTY and no `ORCA_TOKEN`, it prints guidance and exits 0. */
export async function runDoctor(args: string[], env: NodeJS.ProcessEnv, base: string, version: string): Promise<void> {
  void args; void version; // no flags/version-gated behavior yet — kept for dispatch-signature parity with runSetup

  const isTTY = !!process.stdout.isTTY;
  if (!isTTY && !env.ORCA_TOKEN) {
    console.log('Run `orca doctor` in an interactive terminal to check Orca\'s health, or set ORCA_TOKEN to run it non-interactively.');
    return;
  }

  try { await fetch(`${base}/health`); }
  catch { console.log('Start Orca first: `orca up`'); process.exit(1); }

  const token = await authenticate(base, env);

  let data: ReadinessResponse;
  try {
    const r = await fetch(`${base}/system/readiness`, { headers: { authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error(`the server returned ${r.status}`);
    data = await r.json() as ReadinessResponse;
  } catch (e) {
    console.error(`Couldn't run the readiness check: ${(e as Error).message}`);
    process.exit(1);
  }

  console.log('');
  let allOk = true;
  for (const check of data.checks) {
    if (!check.ok) allOk = false;
    console.log(`${check.ok ? color.success('✓') : color.error('✗')} ${check.label}: ${check.detail}`);
    if (!check.ok && check.hint) console.log(`  ${color.dim(check.hint)}`);
  }
  console.log('');
  console.log(allOk
    ? color.success('Everything checks out — Orca is ready to go.')
    : color.error('Some checks need attention — see the hints above.'));
  process.exitCode = allOk ? 0 : 1; // so scripts / agents can branch on the result
  if (isTTY) p.outro(`Web UI: ${webBaseUrl()}`);
}
