import type { RouteContext } from '../../context.js';

/** The values {@link import('./index.js').registerPluginRoutes} builds once and threads into each
 *  sub-registrar. Kept minimal: just the setup-tolerant admin gate every plugin route shares. */
export type PluginRoutesShared = {
  notAdmin: RouteContext['notAdminUnlessSetup'];
};
