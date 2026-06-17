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
});
