import { describe, it, expect } from 'vitest';
import { MODULES, modulesByGroup } from '../../modules/registry';

describe('module registry', () => {
  it('registers the twelve modules with routes + groups', () => {
    expect(MODULES.map((m) => m.route)).toEqual(['/dash', '/stats', '/tasks', '/kanban', '/timeline', '/escalations', '/sessions', '/settings', '/projects', '/editor', '/users', '/memory']);
    expect(MODULES.every((m) => typeof m.icon !== 'undefined')).toBe(true);
  });
  it('groups Operate (10) and Config (2)', () => {
    const groups = modulesByGroup();
    expect(groups.find((g) => g.group === 'Operate')?.items.length).toBe(10); // missions folded into tasks; stats + escalations + projects + editor + memory in Operate
    expect(groups.find((g) => g.group === 'Config')?.items.map((m) => m.route)).toEqual(['/settings', '/users']);
  });
});
