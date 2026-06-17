import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from '../../src/store/db.js';
import { MissionStore } from '../../src/store/missionStore.js';

let m: MissionStore;
beforeEach(() => { m = new MissionStore(openDb(':memory:')); });

describe('MissionStore', () => {
  it('persists a mission and lists it active; setState hides it', () => {
    m.create({ id: 'm1', epic_id: 'e1', autonomy: 'L3', max_sessions: 1, cleared_guardrails: ['schema'] });
    expect(m.active().map(x => x.id)).toEqual(['m1']);
    expect(m.get('m1')?.cleared_guardrails).toEqual(['schema']);
    m.setState('m1', 'disengaged');
    expect(m.active()).toEqual([]);
  });
});
