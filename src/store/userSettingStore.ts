import type { Db } from './db.js';

/** Typed per-user CLI/brain settings. `model`/`modelProvider` empty → use the configured brain default.
 *  `autoCompactAt` is the context-window fill percentage at which the conversation is auto-summarized. */
export interface CliSettings { model: string; modelProvider: string; autoCompact: boolean; autoCompactAt: number }
const CLI_DEFAULTS: CliSettings = { model: '', modelProvider: '', autoCompact: false, autoCompactAt: 80 };

/** Keep the auto-compact threshold in a sane band — too low would thrash (compact every turn), too high
 *  risks overflowing before it triggers. Non-numbers fall back to the default. */
function clampPercent(n: number): number {
  if (!Number.isFinite(n)) return CLI_DEFAULTS.autoCompactAt;
  return Math.min(95, Math.max(30, Math.round(n)));
}

/** Per-user key/value settings. A row exists only for a value the user has explicitly set — absence means
 *  "use the default". Keyed by (user_id, key). Generic, but ships a typed CLI-settings accessor. */
export class UserSettingStore {
  constructor(private db: Db) {}

  get(userId: number, key: string): string | null {
    const r = this.db.prepare('SELECT value FROM user_settings WHERE user_id = ? AND key = ?')
      .get(userId, key) as { value: string } | undefined;
    return r ? r.value : null;
  }

  getAll(userId: number): Record<string, string> {
    const rows = this.db.prepare('SELECT key, value FROM user_settings WHERE user_id = ?')
      .all(userId) as { key: string; value: string }[];
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }

  set(userId: number, key: string, value: string): void {
    this.db.prepare(
      `INSERT INTO user_settings (user_id, key, value) VALUES (@user_id, @key, @value)
       ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
    ).run({ user_id: userId, key, value });
  }

  remove(userId: number, key: string): void {
    this.db.prepare('DELETE FROM user_settings WHERE user_id = ? AND key = ?').run(userId, key);
  }

  /** Drop all of a user's settings — called on user delete so no orphan rows linger. */
  removeForUser(userId: number): void {
    this.db.prepare('DELETE FROM user_settings WHERE user_id = ?').run(userId);
  }

  /** The user's CLI/brain settings, with defaults filled in. */
  cliSettings(userId: number): CliSettings {
    const all = this.getAll(userId);
    return {
      model: all.model ?? CLI_DEFAULTS.model,
      modelProvider: all.modelProvider ?? CLI_DEFAULTS.modelProvider,
      autoCompact: all.autoCompact !== undefined ? all.autoCompact === 'true' : CLI_DEFAULTS.autoCompact,
      autoCompactAt: all.autoCompactAt !== undefined ? clampPercent(Number(all.autoCompactAt)) : CLI_DEFAULTS.autoCompactAt,
    };
  }

  /** Apply a partial CLI-settings patch (only the provided fields are written). */
  setCliSettings(userId: number, patch: Partial<CliSettings>): void {
    if (patch.model !== undefined) this.set(userId, 'model', patch.model);
    if (patch.modelProvider !== undefined) this.set(userId, 'modelProvider', patch.modelProvider);
    if (patch.autoCompact !== undefined) this.set(userId, 'autoCompact', String(patch.autoCompact));
    if (patch.autoCompactAt !== undefined) this.set(userId, 'autoCompactAt', String(clampPercent(patch.autoCompactAt)));
  }
}
