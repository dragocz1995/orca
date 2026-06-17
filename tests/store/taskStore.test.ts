import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from '../../src/store/db.js';
import { TaskStore } from '../../src/store/taskStore.js';

let store: TaskStore;
beforeEach(() => { const db = openDb(':memory:'); db.prepare("INSERT INTO projects (id,slug,path) VALUES (1,'orca','/var/www/orca')").run(); store = new TaskStore(db); });

describe('TaskStore', () => {
  it('creates and reads a task with parsed labels', () => {
    const t = store.create({ id: 'orca-1', project_id: 1, title: 'A', labels: ['exec:sonnet'] });
    expect(t.title).toBe('A');
    expect(store.get('orca-1')?.labels).toEqual(['exec:sonnet']);
  });
  it('setStatus updates status', () => {
    store.create({ id: 'orca-1', project_id: 1, title: 'A' });
    store.setStatus('orca-1', 'closed');
    expect(store.get('orca-1')?.status).toBe('closed');
  });

  it('descendants returns the transitive subtree excluding the root', () => {
    store.create({ id: 'epic', project_id: 1, title: 'Epic', type: 'epic' });
    store.create({ id: 'a', project_id: 1, title: 'A', parent_id: 'epic' });
    store.create({ id: 'a1', project_id: 1, title: 'A1', parent_id: 'a' });
    store.create({ id: 'other', project_id: 1, title: 'Other' });
    const ids = store.descendants('epic').map((t) => t.id).sort();
    expect(ids).toEqual(['a', 'a1']);
  });

  it('descendants returns empty for a leaf', () => {
    store.create({ id: 'epic', project_id: 1, title: 'Epic', type: 'epic' });
    expect(store.descendants('epic')).toEqual([]);
  });

  it('depsAmong returns only edges with both ends in the set', () => {
    store.create({ id: 'a', project_id: 1, title: 'A' });
    store.create({ id: 'b', project_id: 1, title: 'B' });
    store.create({ id: 'c', project_id: 1, title: 'C' });
    store.addDep('b', 'a'); // b depends on a
    store.addDep('c', 'b'); // c depends on b
    expect(store.depsAmong(['a', 'b'])).toEqual([{ task_id: 'b', depends_on_id: 'a' }]);
    expect(store.depsAmong([])).toEqual([]);
  });
});
