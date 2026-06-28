import { z } from 'zod';

/** Create a mission note. scope defaults to 'mission' and target/body are required-non-empty in the
 *  handler (which also trims the body and enforces the size cap). */
export const createNoteSchema = z.object({
  scope: z.string().optional(),
  target: z.string().optional(),
  body: z.string().optional(),
  author: z.string().optional(),
});
