import { z } from 'zod';

/** Start the caller's embedded brain, optionally choosing which configured provider drives it. */
export const brainStartSchema = z.object({
  provider: z.string().optional(),
});

/** A single user message sent into the brain conversation. */
export const brainSendSchema = z.object({
  text: z.string().min(1),
});
