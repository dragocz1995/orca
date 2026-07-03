import { z } from 'zod';

/** Create a memory. Only `body` is required; kind/importance/confidence default in the store. Generous
 *  body ceiling guards the DB row without constraining real facts. importance is a 1..5 rank, confidence
 *  a 0..1 probability. */
export const memoryCreateSchema = z.object({
  body: z.string().trim().min(1, 'body cannot be empty').max(100_000, 'body too long'),
  kind: z.string().trim().min(1, 'kind required').max(40, 'kind too long').optional(),
  importance: z.number().int().min(1, 'importance 1..5').max(5, 'importance 1..5').optional(),
  confidence: z.number().min(0, 'confidence 0..1').max(1, 'confidence 0..1').optional(),
});

/** Partial update — every field optional, only the provided ones are written (mirrors the store patch).
 *  A body change is re-embedded lazily by the background queue (needsEmbedding reports it stale). */
export const memoryPatchSchema = z.object({
  body: z.string().trim().min(1, 'body cannot be empty').max(100_000, 'body too long').optional(),
  kind: z.string().trim().min(1, 'kind required').max(40, 'kind too long').optional(),
  importance: z.number().int().min(1, 'importance 1..5').max(5, 'importance 1..5').optional(),
  confidence: z.number().min(0, 'confidence 0..1').max(1, 'confidence 0..1').optional(),
  status: z.enum(['active', 'archived', 'deleted']).optional(),
});

/** Merge several source memories into one new memory carrying `body`; the sources are soft-deleted. */
export const memoryMergeSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1, 'at least one source id'),
  body: z.string().trim().min(1, 'merged body cannot be empty').max(100_000, 'body too long'),
});

/** Retrieval-debugging probe: the query text to rank the caller's memories against. */
export const memoryRetrieveSchema = z.object({
  query: z.string().trim().min(1, 'query cannot be empty').max(4000, 'query too long'),
});

/** Admin update of the workspace embedding block. All fields optional — the config store merges each
 *  provided field over the current block (mirrors PUT /config partial semantics). */
export const embeddingUpdateSchema = z.object({
  providerId: z.string().max(200, 'providerId too long').optional(),
  model: z.string().max(200, 'model too long').optional(),
  baseUrl: z.string().max(1000, 'baseUrl too long').optional(),
  dimensions: z.number().int().positive('dimensions must be positive').nullable().optional(),
});
