import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Db } from './db.js';

export interface User { id: number; username: string; created_at: string }
type Row = User & { password_hash: string };
const mask = (r: Row): User => ({ id: r.id, username: r.username, created_at: r.created_at });

function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}
function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), 64);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export class UserStore {
  constructor(private db: Db) {}

  create(username: string, password: string): User {
    const info = this.db
      .prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
      .run(username, hashPassword(password));
    return this.getById(Number(info.lastInsertRowid))!;
  }
  private getById(id: number): User | null {
    const r = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as Row | undefined;
    return r ? mask(r) : null;
  }
  verify(username: string, password: string): User | null {
    const r = this.db.prepare('SELECT * FROM users WHERE username = ?').get(username) as Row | undefined;
    if (!r || !verifyPassword(password, r.password_hash)) return null;
    return mask(r);
  }
  list(): User[] {
    return (this.db.prepare('SELECT * FROM users ORDER BY created_at').all() as Row[]).map(mask);
  }
  count(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
  }
  delete(id: number): void {
    this.db.prepare('DELETE FROM auth_tokens WHERE user_id = ?').run(id);
    this.db.prepare('DELETE FROM users WHERE id = ?').run(id);
  }
  issueToken(userId: number): string {
    const token = randomBytes(32).toString('hex');
    this.db.prepare('INSERT INTO auth_tokens (token, user_id) VALUES (?, ?)').run(token, userId);
    return token;
  }
  userForToken(token: string): User | null {
    const r = this.db
      .prepare('SELECT u.* FROM auth_tokens t JOIN users u ON u.id = t.user_id WHERE t.token = ?')
      .get(token) as Row | undefined;
    return r ? mask(r) : null;
  }
  revokeToken(token: string): void {
    this.db.prepare('DELETE FROM auth_tokens WHERE token = ?').run(token);
  }
}
