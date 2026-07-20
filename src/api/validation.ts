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

/** Parse a query-string integer with a fallback and an optional clamp. The one place list endpoints read a
 *  `?limit`/`?days`/`?offset`: non-numeric or non-finite input (`?limit=abc`) falls back instead of reaching
 *  a store as `NaN`, a present value is floored and clamped to `[min, max]` when those are given. Pass a
 *  numeric `fallback` for "always a number", or `undefined` for "omit when absent/garbage". */
export function queryInt(raw: string | undefined, opts: { min?: number; max?: number; fallback: number }): number;
export function queryInt(raw: string | undefined, opts: { min?: number; max?: number; fallback?: undefined }): number | undefined;
export function queryInt(raw: string | undefined, opts: { min?: number; max?: number; fallback?: number }): number | undefined {
  if (raw === undefined || raw === '') return opts.fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return opts.fallback;
  let v = Math.floor(n);
  if (opts.min !== undefined) v = Math.max(opts.min, v);
  if (opts.max !== undefined) v = Math.min(opts.max, v);
  return v;
}

/** Flatten a {@link ZodError} into a short, human-readable `path: message; …` string for the 400 body. */
export function formatZodError(err: ZodError): string {
  return err.issues.map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message)).join('; ');
}
