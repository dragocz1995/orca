import type { Db } from './db.js';

/** A named prompt profile that shapes how Orca behaves on a given surface ('web'/'discord'/'cli', …).
 *  Scoped per (user, platform); a user may keep several named profiles per platform and pin one active
 *  in personality_active_profiles. `enabled` is stored as 1/0 but exposed as a boolean. */
export interface PersonalityProfile {
  id: number;
  user_id: number;
  platform: string;
  name: string;
  description: string;
  tone: string;
  style: string;
  prompt: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

/** Raw row as stored: `enabled` is an INTEGER 1/0. */
interface PersonalityProfileRow {
  id: number;
  user_id: number;
  platform: string;
  name: string;
  description: string;
  tone: string;
  style: string;
  prompt: string;
  enabled: number;
  created_at: string;
  updated_at: string;
}

/** Fields accepted when creating a profile. */
export interface PersonalityProfileInput {
  platform: string;
  name: string;
  description?: string;
  tone?: string;
  style?: string;
  prompt: string;
  enabled?: boolean;
}

/** Partial patch for update — only the provided fields are written. */
export interface PersonalityProfilePatch {
  platform?: string;
  name?: string;
  description?: string;
  tone?: string;
  style?: string;
  prompt?: string;
  enabled?: boolean;
}

function toProfile(row: PersonalityProfileRow): PersonalityProfile {
  return { ...row, enabled: row.enabled !== 0 };
}

/** Per-user, per-platform personality-profile store. EVERY query is user_id-scoped — a user can never
 *  read or write another user's profiles. The active pointer lives in a separate table and is kept in
 *  sync (cleared on delete/removeForUser, verified against ownership on setActive). */
export class PersonalityStore {
  constructor(private db: Db) {}

  /** All of a user's profiles, ordered by platform then name. Optionally filtered to one platform. */
  list(userId: number, platform?: string): PersonalityProfile[] {
    const rows = platform !== undefined
      ? this.db.prepare('SELECT * FROM personality_profiles WHERE user_id = ? AND platform = ? ORDER BY platform, name')
          .all(userId, platform) as PersonalityProfileRow[]
      : this.db.prepare('SELECT * FROM personality_profiles WHERE user_id = ? ORDER BY platform, name')
          .all(userId) as PersonalityProfileRow[];
    return rows.map(toProfile);
  }

  /** A single profile by id, scoped to the owner. */
  get(userId: number, id: number): PersonalityProfile | undefined {
    const row = this.db.prepare('SELECT * FROM personality_profiles WHERE user_id = ? AND id = ?')
      .get(userId, id) as PersonalityProfileRow | undefined;
    return row ? toProfile(row) : undefined;
  }

  /** Create a profile and return the full stored row (insert-then-reselect). */
  create(userId: number, input: PersonalityProfileInput): PersonalityProfile {
    const info = this.db.prepare(
      `INSERT INTO personality_profiles (user_id, platform, name, description, tone, style, prompt, enabled)
       VALUES (@user_id, @platform, @name, @description, @tone, @style, @prompt, @enabled)`
    ).run({
      user_id: userId,
      platform: input.platform,
      name: input.name,
      description: input.description ?? '',
      tone: input.tone ?? '',
      style: input.style ?? '',
      prompt: input.prompt,
      enabled: input.enabled === false ? 0 : 1,
    });
    return this.get(userId, Number(info.lastInsertRowid))!;
  }

  /** Apply a partial patch (only provided fields), bump updated_at, return the row. Ownership-checked:
   *  a patch targeting another user's id matches nothing and returns undefined. */
  update(userId: number, id: number, patch: PersonalityProfilePatch): PersonalityProfile | undefined {
    const sets: string[] = [];
    const params: Record<string, string | number> = { user_id: userId, id };
    if (patch.platform !== undefined) { sets.push('platform = @platform'); params.platform = patch.platform; }
    if (patch.name !== undefined) { sets.push('name = @name'); params.name = patch.name; }
    if (patch.description !== undefined) { sets.push('description = @description'); params.description = patch.description; }
    if (patch.tone !== undefined) { sets.push('tone = @tone'); params.tone = patch.tone; }
    if (patch.style !== undefined) { sets.push('style = @style'); params.style = patch.style; }
    if (patch.prompt !== undefined) { sets.push('prompt = @prompt'); params.prompt = patch.prompt; }
    if (patch.enabled !== undefined) { sets.push('enabled = @enabled'); params.enabled = patch.enabled ? 1 : 0; }
    if (sets.length === 0) return this.get(userId, id);
    sets.push(`updated_at = datetime('now')`);
    this.db.prepare(`UPDATE personality_profiles SET ${sets.join(', ')} WHERE user_id = @user_id AND id = @id`).run(params);
    return this.get(userId, id);
  }

  /** Delete a profile and clear any active pointer to it (both tables change together). */
  remove(userId: number, id: number): void {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM personality_active_profiles WHERE user_id = ? AND profile_id = ?').run(userId, id);
      this.db.prepare('DELETE FROM personality_profiles WHERE user_id = ? AND id = ?').run(userId, id);
    })();
  }

  /** Pin a profile as the active one for (user, platform). The profile MUST belong to this user AND
   *  platform, else we throw — an active pointer to a foreign or mismatched profile is never allowed. */
  setActive(userId: number, platform: string, profileId: number): void {
    const owned = this.db.prepare('SELECT id FROM personality_profiles WHERE user_id = ? AND platform = ? AND id = ?')
      .get(userId, platform, profileId) as { id: number } | undefined;
    if (!owned) throw new Error(`personality profile ${profileId} not found for user ${userId} on platform ${platform}`);
    this.db.prepare(
      `INSERT INTO personality_active_profiles (user_id, platform, profile_id) VALUES (@user_id, @platform, @profile_id)
       ON CONFLICT(user_id, platform) DO UPDATE SET profile_id = excluded.profile_id, updated_at = datetime('now')`
    ).run({ user_id: userId, platform, profile_id: profileId });
  }

  /** Unpin the active profile for (user, platform). */
  clearActive(userId: number, platform: string): void {
    this.db.prepare('DELETE FROM personality_active_profiles WHERE user_id = ? AND platform = ?').run(userId, platform);
  }

  /** The active profile for (user, platform) — only if it is still enabled. */
  getActive(userId: number, platform: string): PersonalityProfile | undefined {
    const row = this.db.prepare(
      `SELECT p.* FROM personality_active_profiles a
         JOIN personality_profiles p ON p.id = a.profile_id AND p.user_id = a.user_id
        WHERE a.user_id = ? AND a.platform = ? AND p.enabled = 1`
    ).get(userId, platform) as PersonalityProfileRow | undefined;
    return row ? toProfile(row) : undefined;
  }

  /** Drop all of a user's profiles + active rows — called on user delete so no orphan rows linger. */
  removeForUser(userId: number): void {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM personality_active_profiles WHERE user_id = ?').run(userId);
      this.db.prepare('DELETE FROM personality_profiles WHERE user_id = ?').run(userId);
    })();
  }
}
