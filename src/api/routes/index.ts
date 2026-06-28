import type { OrcaApp, RouteContext } from '../context.js';
import { registerAuthGuards } from '../middleware.js';
import { registerAuthRoutes } from './auth.js';
import { registerProjectRoutes } from './projects.js';
import { registerActivityRoutes } from './activity.js';
import { registerIntegrationRoutes } from './integrations.js';
import { registerSessionRoutes } from './sessions.js';
import { registerAdvisorRoutes } from './advisor.js';
import { registerMissionRoutes } from './missions.js';
import { registerConfigRoutes } from './config.js';

/** Register every route family on the app. Order matters: the auth/tenancy guards are global
 *  middleware and MUST register before any family so every downstream handler is authenticated and
 *  gated. The tasks/plan family is still inline in `createServer` and registers after this call
 *  (still after the guards). */
export function registerRoutes(app: OrcaApp, ctx: RouteContext): void {
  registerAuthGuards(app, ctx);
  registerAuthRoutes(app, ctx);
  registerProjectRoutes(app, ctx);
  registerActivityRoutes(app, ctx);
  registerIntegrationRoutes(app, ctx);
  registerSessionRoutes(app, ctx);
  registerAdvisorRoutes(app, ctx);
  registerMissionRoutes(app, ctx);
  registerConfigRoutes(app, ctx);
}
