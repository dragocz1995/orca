import { ZodError, type ZodType } from 'zod';
import type { Context } from 'hono';

/** Parse and validate a JSON request body against a zod schema. A malformed/empty body throws a
 *  SyntaxError (which `onError` maps to a clean `invalid JSON body` 400), and a well-formed body of the
 *  wrong shape throws a {@link ZodError} (mapped to a 400 listing the offending fields). Single source
 *  of truth for request-body shape across the route families: handlers declare a schema and read typed
 *  fields, instead of hand-rolling `typeof` ladders. */
export async function parseBody<T>(c: Context, schema: ZodType<T>): Promise<T> {
  return schema.parse(await c.req.json());
}

/** Flatten a {@link ZodError} into a short, human-readable `path: message; …` string for the 400 body. */
export function formatZodError(err: ZodError): string {
  return err.issues.map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message)).join('; ');
}
