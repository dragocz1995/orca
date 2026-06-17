import { describe, it, expect } from 'vitest';
import { layoutPhases } from '../../../modules/missions/layoutPhases';
import type { MissionTask, MissionDeps } from '../../../lib/types';

const t = (id: string): MissionTask => ({ id, title: id, status: 'open', type: 'task', parent_id: 'epic' });

describe('layoutPhases', () => {
  it('puts independent tasks in phase 0', () => {
    const phases = layoutPhases([t('a'), t('b')], []);
    expect(phases).toHaveLength(1);
    expect(phases[0].map((x) => x.id).sort()).toEqual(['a', 'b']);
  });
  it('layers a linear chain a->b->c into three phases', () => {
    const deps: MissionDeps[] = [{ taskId: 'b', dependsOnId: 'a' }, { taskId: 'c', dependsOnId: 'b' }];
    const phases = layoutPhases([t('a'), t('b'), t('c')], deps);
    expect(phases.map((p) => p.map((x) => x.id))).toEqual([['a'], ['b'], ['c']]);
  });
  it('places the join of a diamond in the last phase', () => {
    const deps: MissionDeps[] = [
      { taskId: 'b', dependsOnId: 'a' }, { taskId: 'c', dependsOnId: 'a' },
      { taskId: 'd', dependsOnId: 'b' }, { taskId: 'd', dependsOnId: 'c' },
    ];
    const phases = layoutPhases([t('a'), t('b'), t('c'), t('d')], deps);
    expect(phases[0].map((x) => x.id)).toEqual(['a']);
    expect(phases[phases.length - 1].map((x) => x.id)).toEqual(['d']);
  });
  it('does not infinite-loop on a cycle', () => {
    const deps: MissionDeps[] = [{ taskId: 'a', dependsOnId: 'b' }, { taskId: 'b', dependsOnId: 'a' }];
    const phases = layoutPhases([t('a'), t('b')], deps);
    expect(phases.flat()).toHaveLength(2);
  });
});
