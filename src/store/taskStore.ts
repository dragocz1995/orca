import type { Db } from './db.js';
import type { Task, CreateTaskInput, TaskStatus } from './types.js';

type Row = Omit<Task, 'labels'> & { labels: string };
const toTask = (r: Row): Task => ({ ...r, labels: r.labels ? r.labels.split(',').filter(Boolean) : [] });

export class TaskStore {
  constructor(private db: Db) {}
  create(input: CreateTaskInput): Task {
    this.db.prepare(
      `INSERT INTO tasks (id, project_id, title, type, priority, parent_id, labels)
       VALUES (@id, @project_id, @title, @type, @priority, @parent_id, @labels)`
    ).run({
      id: input.id, project_id: input.project_id, title: input.title,
      type: input.type ?? 'task', priority: input.priority ?? 'P2',
      parent_id: input.parent_id ?? null, labels: (input.labels ?? []).join(','),
    });
    return this.get(input.id)!;
  }
  get(id: string): Task | null {
    const r = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Row | undefined;
    return r ? toTask(r) : null;
  }
  list(filter?: { status?: TaskStatus; project_id?: number }): Task[] {
    const where: string[] = []; const p: Record<string, unknown> = {};
    if (filter?.status) { where.push('status = @status'); p.status = filter.status; }
    if (filter?.project_id) { where.push('project_id = @project_id'); p.project_id = filter.project_id; }
    const sql = `SELECT * FROM tasks ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at`;
    return (this.db.prepare(sql).all(p) as Row[]).map(toTask);
  }
  setStatus(id: string, status: TaskStatus): void {
    this.db.prepare('UPDATE tasks SET status = ? WHERE id = ?').run(status, id);
  }
  addDep(taskId: string, dependsOnId: string): void {
    this.db.prepare('INSERT OR IGNORE INTO task_deps (task_id, depends_on_id) VALUES (?, ?)').run(taskId, dependsOnId);
  }

  descendants(rootId: string): Task[] {
    const rows = this.db.prepare(
      `WITH RECURSIVE sub(id) AS (
         SELECT id FROM tasks WHERE parent_id = @root
         UNION
         SELECT t.id FROM tasks t JOIN sub ON t.parent_id = sub.id
       )
       SELECT t.* FROM tasks t JOIN sub ON t.id = sub.id ORDER BY t.created_at`
    ).all({ root: rootId }) as Row[];
    return rows.map(toTask);
  }

  depsAmong(ids: string[]): { task_id: string; depends_on_id: string }[] {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    return this.db.prepare(
      `SELECT task_id, depends_on_id FROM task_deps
       WHERE task_id IN (${placeholders}) AND depends_on_id IN (${placeholders})`
    ).all(...ids, ...ids) as { task_id: string; depends_on_id: string }[];
  }
}
