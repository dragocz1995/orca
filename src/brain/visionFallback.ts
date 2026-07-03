/** What a turn should do about the vision-fallback model, decided BEFORE any session is touched.
 *  Pure — the caller (BrainService.send, inside its user-level lock) performs the stop/start. */
export type VisionHop =
  /** Stay on the current session. */
  | { action: 'none' }
  /** Image turn on a text-only model with a configured fallback → respawn on the vision model. */
  | { action: 'hop'; provider?: string; model: string }
  /** Text-only turn while parked on the fallback → respawn back on the user's normal model. */
  | { action: 'hop-back' };

export function decideVisionHop(i: {
  hasImages: boolean;
  /** Whether the CURRENT session's model accepts image input. */
  visionCapable: boolean;
  /** Whether the session currently runs on the vision-fallback model. */
  onFallback: boolean;
  visionModel?: string;
  visionModelProvider?: string;
}): VisionHop {
  if (i.hasImages && !i.visionCapable && i.visionModel) {
    return { action: 'hop', provider: i.visionModelProvider || undefined, model: i.visionModel };
  }
  if (!i.hasImages && i.onFallback) return { action: 'hop-back' };
  return { action: 'none' };
}
