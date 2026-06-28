import { z } from 'zod';

/** Register orca as an MCP server in a same-host Hermes. url + token are required-non-empty in the
 *  handler (it trims first), and home is constrained under the Hermes root there. */
export const hermesInstallSchema = z.object({
  home: z.string().optional(),
  url: z.string().optional(),
  token: z.string().optional(),
});
