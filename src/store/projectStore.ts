import type { Db } from './db.js';

export interface Project { id: number; slug: string; path: string; notes: string }

export class ProjectStore {
  constructor(private db: Db) {}
  create(p: { slug: string; path: string; notes?: string }): Project {
    const info = this.db.prepare('INSERT INTO projects (slug, path, notes) VALUES (?, ?, ?)').run(p.slug, p.path, p.notes ?? '');
    return this.get(Number(info.lastInsertRowid))!;
  }
  list(): Project[] { return this.db.prepare('SELECT * FROM projects ORDER BY id').all() as Project[]; }
  get(id: number): Project | null { return (this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as Project | undefined) ?? null; }
  /** Update a project's path and/or Pilot notes. The slug is the stable identifier and stays immutable. */
  update(id: number, patch: { path?: string; notes?: string }): Project | null {
    const cur = this.get(id);
    if (!cur) return null;
    const path = patch.path ?? cur.path;
    const notes = patch.notes ?? cur.notes;
    this.db.prepare('UPDATE projects SET path = ?, notes = ? WHERE id = ?').run(path, notes, id);
    return this.get(id);
  }
}
