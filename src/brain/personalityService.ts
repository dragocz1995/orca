import type { PersonalityStore } from '../store/personalityStore.js';

/** The seams PersonalityService borrows from the daemon — mirrored from BrainDeps so the personality
 *  chunk is rendered with the exact same call the brain makes at spawn (no divergence). */
export interface PersonalityServiceDeps {
  store: PersonalityStore;
  /** Renders a named prompt template (per-user override aware) — the brain's `d.prompts` seam. */
  prompts: { render(name: string, vars: Record<string, string>, userId?: number): string };
  /** Resolves an Elowen user to their display identity — the brain's `d.users` seam. */
  users: { get(id: number): { name?: string; username?: string } | null | undefined };
  /** The user's communication-style setting (advisorStyle → the {{personality}} paragraph). Absent →
   *  the default style. */
  userSettings?: (userId: number) => { advisorStyle?: string } | undefined;
  /** The assistant's configured display identity (Settings → Elowen AI). Absent → 'Elowen'. */
  agentName?: () => string;
}

/** SINGLE SOURCE for turning a user's active personality profile into a system-prompt chunk. The brain
 *  calls through here at spawn, so the chunk format can never drift.
 *
 *  Discord is a SHARED, owner-anchored channel: its personality is the channel owner's 'discord' active
 *  profile (the bot's one persona), rendered on the elowen-platform overlay. Owner surfaces (web/cli) are
 *  per-user sessions and render on the elowen base. */
export class PersonalityService {
  constructor(private d: PersonalityServiceDeps) {}

  /** The single labeled personality chunk for (user, platform), or undefined when no enabled active
   *  profile is pinned. This is the ONLY place the chunk format is defined. Empty tone/style are omitted. */
  activeAppend(userId: number, platform: string): string | undefined {
    const profile = this.d.store.getActive(userId, platform);
    if (!profile) return undefined;
    const lines = [`User personality for ${platform}:`, `Name: ${profile.name}`];
    if (profile.tone.trim()) lines.push(`Tone: ${profile.tone}`);
    if (profile.style.trim()) lines.push(`Style: ${profile.style}`);
    lines.push('', 'Instructions:', profile.prompt);
    return lines.join('\n');
  }
}
