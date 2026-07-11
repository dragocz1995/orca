import { describe, expect, it } from 'vitest';
import type { Task } from '../../../lib/types';
import { taskFilterCounts } from '../../../modules/tasks/taskFilters';

describe('taskFilterCounts', () => {
  it('counts top-level tasks with effective epic status and a separate autopilot total', () => {
    const tasks = [
      { id: 'active', title: 'Active', status: 'in_progress', type: 'task', labels: [] },
      { id: 'open', title: 'Open', status: 'open', type: 'task', labels: [] },
      { id: 'blocked', title: 'Blocked', status: 'blocked', type: 'task', labels: [] },
      { id: 'closed', title: 'Closed', status: 'closed', type: 'task', labels: [] },
      { id: 'epic', title: 'Epic', status: 'open', type: 'epic', labels: [] },
      { id: 'phase', parent_id: 'epic', title: 'Phase', status: 'open', type: 'task', labels: [] },
    ] as Task[];

    expect(taskFilterCounts(tasks, [])).toEqual({
      in_progress: 1,
      open: 2,
      blocked: 1,
      closed: 1,
      autopilot: 1,
      all: 5,
    });
  });
});
