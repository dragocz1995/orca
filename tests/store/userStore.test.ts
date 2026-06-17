import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from '../../src/store/db.js';
import { UserStore } from '../../src/store/userStore.js';

let users: UserStore;
beforeEach(() => { users = new UserStore(openDb(':memory:')); });

describe('UserStore', () => {
  it('create + verify round-trips and never exposes the hash', () => {
    const u = users.create('alice', 'secret');
    expect(u.username).toBe('alice');
    expect((u as Record<string, unknown>).password_hash).toBeUndefined();
    expect(users.verify('alice', 'secret')?.username).toBe('alice');
    expect(users.verify('alice', 'wrong')).toBeNull();
    expect(users.verify('nobody', 'secret')).toBeNull();
  });
  it('list masks the hash and count reflects inserts', () => {
    users.create('a', 'x'); users.create('b', 'y');
    expect(users.count()).toBe(2);
    expect(users.list().map((u) => u.username).sort()).toEqual(['a', 'b']);
    expect(users.list().every((u) => !('password_hash' in u))).toBe(true);
  });
  it('rejects duplicate usernames', () => {
    users.create('a', 'x');
    expect(() => users.create('a', 'y')).toThrow();
  });
  it('issues, resolves and revokes tokens', () => {
    const u = users.create('a', 'x');
    const t = users.issueToken(u.id);
    expect(users.userForToken(t)?.id).toBe(u.id);
    users.revokeToken(t);
    expect(users.userForToken(t)).toBeNull();
    expect(users.userForToken('garbage')).toBeNull();
  });
  it('delete removes the user and their tokens', () => {
    const u = users.create('a', 'x');
    const t = users.issueToken(u.id);
    users.delete(u.id);
    expect(users.count()).toBe(0);
    expect(users.userForToken(t)).toBeNull();
  });
});
