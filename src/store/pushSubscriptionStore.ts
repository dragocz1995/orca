import type { Db } from './db.js';

/** A browser `PushSubscription` as serialized by `pushManager.subscribe().toJSON()`. */
export interface WebPushSubscription { endpoint: string; keys: { p256dh: string; auth: string } }

export interface PushSubscriptionRecord {
  id: number; user_id: number; endpoint: string; p256dh: string; auth: string; created_at: string;
}

const COLS = 'id,user_id,endpoint,p256dh,auth,created_at';

/** Per-user web-push device subscriptions. A user may hold many (one per device/browser); the unique
 *  key is the endpoint, so re-subscribing the same device updates it in place — and a device that
 *  moved to another account (shared phone, re-login) is re-pointed rather than duplicated. */
export class PushSubscriptionStore {
  constructor(private db: Db) {}

  /** Insert or update a device subscription for a user (keyed on the unique endpoint). */
  upsert(userId: number, sub: WebPushSubscription): void {
    this.db.prepare(
      `INSERT INTO user_push_subscriptions (user_id, endpoint, p256dh, auth)
       VALUES (@user_id, @endpoint, @p256dh, @auth)
       ON CONFLICT(endpoint) DO UPDATE SET
         user_id=excluded.user_id, p256dh=excluded.p256dh, auth=excluded.auth`
    ).run({ user_id: userId, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth });
  }

  /** Remove a subscription by endpoint — used by the sender to prune a dead 404/410 endpoint, where
   *  the owner is whoever holds it. Not for user-facing unsubscribe (use removeForUser). */
  remove(endpoint: string): void {
    this.db.prepare('DELETE FROM user_push_subscriptions WHERE endpoint = ?').run(endpoint);
  }

  /** Remove a subscription only if it belongs to the given user — so an unsubscribe can never delete
   *  another user's device by guessing its endpoint. */
  removeForUser(userId: number, endpoint: string): void {
    this.db.prepare('DELETE FROM user_push_subscriptions WHERE endpoint = ? AND user_id = ?').run(endpoint, userId);
  }

  listForUser(userId: number): PushSubscriptionRecord[] {
    return this.db.prepare(`SELECT ${COLS} FROM user_push_subscriptions WHERE user_id = ? ORDER BY id`)
      .all(userId) as PushSubscriptionRecord[];
  }

  /** All subscriptions belonging to any of the given users (deduped by row). Empty input → []. */
  listForUsers(userIds: number[]): PushSubscriptionRecord[] {
    if (userIds.length === 0) return [];
    const placeholders = userIds.map(() => '?').join(',');
    return this.db.prepare(`SELECT ${COLS} FROM user_push_subscriptions WHERE user_id IN (${placeholders}) ORDER BY id`)
      .all(...userIds) as PushSubscriptionRecord[];
  }
}
