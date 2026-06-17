import type { Db } from './db.js';
import type { Task } from './types.js';

type Row = Omit<Task, 'labels'> & { labels: string };

export class Readiness {
  constructor(private db: Db) {}
  ready(projectId: number): Task[] {
    const open = this.db.prepare(
      "SELECT id FROM tasks WHERE project_id = ? AND status = 'open' AND type != 'epic' ORDER BY created_at"
    ).all(projectId) as { id: string }[];
    const blockedStmt = this.db.prepare(
      `SELECT COUNT(*) AS n FROM task_deps d JOIN tasks t ON t.id = d.depends_on_id
       WHERE d.task_id = ? AND t.status NOT IN ('closed','cancelled')`
    );
    const get = this.db.prepare('SELECT * FROM tasks WHERE id = ?');
    const toTask = (r: Row): Task => ({ ...r, labels: r.labels ? r.labels.split(',').filter(Boolean) : [] });
    return open
      .filter(o => (blockedStmt.get(o.id) as { n: number }).n === 0)
      .map(o => toTask(get.get(o.id) as Row));
  }
}
