import { describe, it, expect } from 'vitest';
import { MODULES, modulesByGroup } from '../../modules/registry';

describe('module registry', () => {
  it('registers the eight modules with routes + groups', () => {
    expect(MODULES.map((m) => m.route)).toEqual(['/dash', '/tasks', '/kanban', '/timeline', '/sessions', '/missions', '/settings', '/users']);
    expect(MODULES.every((m) => typeof m.icon !== 'undefined')).toBe(true);
  });
  it('groups Operate (6) and Config (2)', () => {
    const groups = modulesByGroup();
    expect(groups.find((g) => g.group === 'Operate')?.items.length).toBe(6);
    expect(groups.find((g) => g.group === 'Config')?.items.map((m) => m.route)).toEqual(['/settings', '/users']);
  });
});
