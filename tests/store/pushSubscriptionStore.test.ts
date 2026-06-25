import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from '../../src/store/db.js';
import type { Db } from '../../src/store/db.js';
import { PushSubscriptionStore } from '../../src/store/pushSubscriptionStore.js';

const sub = (endpoint: string, p256dh = 'p', auth = 'a') => ({ endpoint, keys: { p256dh, auth } });

let db: Db;
let store: PushSubscriptionStore;
beforeEach(() => { db = openDb(':memory:'); store = new PushSubscriptionStore(db); });

describe('PushSubscriptionStore', () => {
  it('upserts and lists a subscription for a user', () => {
    store.upsert(1, sub('https://push/1'));
    const rows = store.listForUser(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ user_id: 1, endpoint: 'https://push/1', p256dh: 'p', auth: 'a' });
  });

  it('re-upserting the same endpoint updates keys without duplicating', () => {
    store.upsert(1, sub('https://push/1', 'old', 'old'));
    store.upsert(1, sub('https://push/1', 'new', 'new'));
    const rows = store.listForUser(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ p256dh: 'new', auth: 'new' });
  });

  it('re-points an endpoint that moved to another user', () => {
    store.upsert(1, sub('https://push/shared'));
    store.upsert(2, sub('https://push/shared'));
    expect(store.listForUser(1)).toHaveLength(0);
    expect(store.listForUser(2)).toHaveLength(1);
  });

  it('removes a subscription by endpoint', () => {
    store.upsert(1, sub('https://push/1'));
    store.remove('https://push/1');
    expect(store.listForUser(1)).toHaveLength(0);
  });

  it('removeForUser only deletes the caller\'s own device, never another user\'s', () => {
    store.upsert(1, sub('https://push/1'));
    store.removeForUser(2, 'https://push/1'); // user 2 must not be able to delete user 1's device
    expect(store.listForUser(1)).toHaveLength(1);
    store.removeForUser(1, 'https://push/1'); // the owner can
    expect(store.listForUser(1)).toHaveLength(0);
  });

  it('listForUsers returns the union and is empty for no users', () => {
    store.upsert(1, sub('https://push/1'));
    store.upsert(2, sub('https://push/2'));
    store.upsert(3, sub('https://push/3'));
    expect(store.listForUsers([1, 2]).map((r) => r.endpoint).sort())
      .toEqual(['https://push/1', 'https://push/2']);
    expect(store.listForUsers([])).toEqual([]);
  });
});
