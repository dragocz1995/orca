import type { Db } from './db.js';

/** Assignments of users to projects (many-to-many). The bootstrap admin (users.is_admin) always
 *  has access to everything regardless of rows here — see `canAccess`. */
export class UserProjectStore {
  constructor(private db: Db) {}

  /** Project ids assigned to a user. */
  forUser(userId: number): number[] {
    return (this.db.prepare('SELECT project_id FROM user_projects WHERE user_id = ? ORDER BY project_id').all(userId) as { project_id: number }[])
      .map((r) => r.project_id);
  }

  assign(userId: number, projectId: number): void {
    this.db.prepare('INSERT OR IGNORE INTO user_projects (user_id, project_id) VALUES (?, ?)').run(userId, projectId);
  }

  unassign(userId: number, projectId: number): void {
    this.db.prepare('DELETE FROM user_projects WHERE user_id = ? AND project_id = ?').run(userId, projectId);
  }

  /** True for the bootstrap admin (full visibility + may manage assignments). Reads the explicit
   *  users.is_admin flag — never a mutable MIN(id) heuristic, so deleting a user can't transfer it. */
  isAdmin(userId: number): boolean {
    const r = this.db.prepare('SELECT is_admin FROM users WHERE id = ?').get(userId) as { is_admin: number } | undefined;
    return !!r?.is_admin;
  }

  /** True when the user may see/operate the project: the admin always can; otherwise only when
   *  explicitly assigned. (Assignment is the access boundary for non-admin users.) */
  canAccess(userId: number, projectId: number): boolean {
    if (this.isAdmin(userId)) return true;
    const r = this.db.prepare('SELECT 1 FROM user_projects WHERE user_id = ? AND project_id = ?').get(userId, projectId);
    return !!r;
  }
}
