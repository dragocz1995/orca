import { z } from 'zod';

/** Create a personality profile. platform/name/prompt are required; the descriptive fields default to
 *  empty in the store. Generous ceilings guard the DB row without constraining real prompts. */
export const personalityCreateSchema = z.object({
  platform: z.string().trim().min(1, 'platform required').max(40, 'platform too long'),
  name: z.string().trim().min(1, 'name required').max(120, 'name too long'),
  prompt: z.string().trim().min(1, 'prompt cannot be empty').max(100_000, 'prompt too long'),
  description: z.string().max(2000, 'description too long').optional(),
  tone: z.string().max(200, 'tone too long').optional(),
  style: z.string().max(200, 'style too long').optional(),
  enabled: z.boolean().optional(),
});

/** Partial update — every field optional, only the provided ones are written (mirrors the store patch).
 *  The trim/min guards still reject an explicitly-blank name/prompt so an update can't empty them. */
export const personalityPatchSchema = z.object({
  platform: z.string().trim().min(1, 'platform required').max(40, 'platform too long').optional(),
  name: z.string().trim().min(1, 'name required').max(120, 'name too long').optional(),
  prompt: z.string().trim().min(1, 'prompt cannot be empty').max(100_000, 'prompt too long').optional(),
  description: z.string().max(2000, 'description too long').optional(),
  tone: z.string().max(200, 'tone too long').optional(),
  style: z.string().max(200, 'style too long').optional(),
  enabled: z.boolean().optional(),
});

/** Preview request: which platform's resolved personality stack to render. */
export const personalityPreviewSchema = z.object({
  platform: z.string().trim().min(1, 'platform required').max(40, 'platform too long'),
});
