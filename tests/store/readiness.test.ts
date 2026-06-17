import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from '../../src/store/db.js';
import { TaskStore } from '../../src/store/taskStore.js';
import { Readiness } from '../../src/store/readiness.js';

let store: TaskStore; let ready: Readiness;
beforeEach(() => {
  const db = openDb(':memory:'); db.prepare("INSERT INTO projects (id,slug,path) VALUES (1,'orca','/o')").run();
  store = new TaskStore(db); ready = new Readiness(db);
  store.create({ id: 't1', project_id: 1, title: 'one' });
  store.create({ id: 't2', project_id: 1, title: 'two' });
  store.addDep('t2', 't1'); // t2 depends on t1
});

describe('Readiness', () => {
  it('returns only the unblocked head while a blocker is open', () => {
    expect(ready.ready(1).map(t => t.id)).toEqual(['t1']);
  });
  it('unblocks the dependent once the blocker is closed', () => {
    store.setStatus('t1', 'closed');
    expect(ready.ready(1).map(t => t.id)).toEqual(['t2']);
  });
});
