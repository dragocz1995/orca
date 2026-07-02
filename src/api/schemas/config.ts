import { z } from 'zod';

/** A browser web-push subscription (endpoint + the two encryption keys). */
export const pushSubscribeSchema = z.object({
  endpoint: z.string().min(1),
  keys: z.object({ p256dh: z.string(), auth: z.string() }),
});

/** Remove one of the caller's own push devices by endpoint. */
export const pushUnsubscribeSchema = z.object({
  endpoint: z.string().min(1),
});

/** Restart one of the two orca systemd units on demand. */
export const systemRestartSchema = z.object({
  target: z.enum(['daemon', 'web']),
});
