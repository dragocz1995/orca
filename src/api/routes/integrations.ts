import { homedir } from 'node:os';
import { join } from 'node:path';
import { hermesStatus, installOrcaMcp } from '../../integrations/hermesInstall.js';
import { detectClis } from '../../integrations/cliDetection.js';
import { detectGithubAuth } from '../../integrations/github/auth.js';
import type { OrcaApp, RouteContext } from '../context.js';

/** External-integration status/install surface: Hermes MCP registration, CLI detection and GitHub
 *  auth posture. The Hermes routes are admin-only and constrain the home path under the Hermes root. */
export function registerIntegrationRoutes(app: OrcaApp, ctx: RouteContext): void {
  const { d, notAdmin } = ctx;
  // Hermes integration — register orca as an MCP server in a same-host Hermes instance.
  const hermesRoot = process.env.HERMES_HOME || join(homedir(), '.hermes');
  // Resolve the Hermes home. An `home` override is constrained to live under the configured root so a
  // crafted path can't read/write arbitrary filesystem locations (path-traversal / fs enumeration).
  // Returns null for a rejected override; callers turn that into a 400.
  const hermesHome = (override?: string): string | null => {
    const o = override?.trim();
    if (!o) return hermesRoot;
    const abs = join(o);
    if (abs !== hermesRoot && !abs.startsWith(hermesRoot + '/')) return null;
    return abs;
  };
  app.get('/integrations/hermes/status', c => {
    if (notAdmin(c)) return c.json({ error: 'forbidden' }, 403);
    const home = hermesHome(c.req.query('home'));
    if (!home) return c.json({ error: 'home must be under the Hermes root' }, 400);
    return c.json(hermesStatus(home));
  });
  app.post('/integrations/hermes/install', async c => {
    // Admin-only: this writes credentials + config into a host path. Without the gate any
    // authenticated user could point Hermes at an attacker URL/token.
    if (notAdmin(c)) return c.json({ error: 'forbidden' }, 403);
    const b = await c.req.json().catch(() => ({})) as { home?: string; url?: string; token?: string };
    const url = (b.url ?? '').trim();
    const token = (b.token ?? '').trim();
    if (!url || !token) return c.json({ error: 'url and token required' }, 400);
    const home = hermesHome(b.home);
    if (!home) return c.json({ error: 'home must be under the Hermes root' }, 400);
    try {
      const result = installOrcaMcp({ home, url, token });
      return c.json({ ...result, status: hermesStatus(home) }, 201);
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
  });

  app.get('/integrations/cli-status', async c => {
    const cfg = d.config.get();
    const ctx = {
      configPersisted: d.config.hasSettings(),
      hasApiKey: cfg.autopilot.apiKeySet,
      hasCustomSetup: cfg.customModels.length > 0 || cfg.hiddenPresets.length > 0,
    };
    return c.json(await detectClis(ctx));
  });

  // GitHub auth posture for the PR-native workflow — whether a push would succeed (via a stored token
  // or gh's own login) and as whom. The token value is never exposed, only whether one is set.
  app.get('/integrations/github-status', c => c.json(detectGithubAuth(!!d.config.ghToken())));
}
