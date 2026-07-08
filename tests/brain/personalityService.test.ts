import { describe, it, expect } from 'vitest';
import { openDb } from '../../src/store/db.js';
import { PersonalityStore } from '../../src/store/personalityStore.js';
import { PersonalityService } from '../../src/brain/personalityService.js';

/** A fake prompts seam that echoes the template name + vars so tests can assert the persona render is
 *  the exact call the brain makes, without pulling in the real template files. */
function fakePrompts() {
  return {
    render(name: string, vars: Record<string, string>, userId?: number): string {
      return `[${name}] ${JSON.stringify(vars)} u=${userId}`;
    },
  };
}

function fakeUsers(map: Record<number, { name?: string; username?: string }>) {
  return { get: (id: number) => map[id] };
}

function build() {
  const store = new PersonalityStore(openDb(':memory:'));
  const service = new PersonalityService({
    store,
    prompts: fakePrompts(),
    users: fakeUsers({ 1: { name: 'Filip', username: 'filip' } }),
    agentName: () => 'Elowen',
  });
  return { store, service };
}

describe('PersonalityService.activeAppend', () => {
  it('returns undefined when no active profile is pinned', () => {
    const { service } = build();
    expect(service.activeAppend(1, 'discord')).toBeUndefined();
  });

  it('returns the labeled chunk with tone + style present', () => {
    const { store, service } = build();
    const p = store.create(1, { platform: 'discord', name: 'Snarky', tone: 'dry', style: 'terse', prompt: 'Be witty.' });
    store.setActive(1, 'discord', p.id);
    expect(service.activeAppend(1, 'discord')).toBe(
      'User personality for discord:\nName: Snarky\nTone: dry\nStyle: terse\n\nInstructions:\nBe witty.',
    );
  });

  it('omits empty tone/style lines', () => {
    const { store, service } = build();
    const p = store.create(1, { platform: 'discord', name: 'Plain', prompt: 'Just answer.' });
    store.setActive(1, 'discord', p.id);
    expect(service.activeAppend(1, 'discord')).toBe(
      'User personality for discord:\nName: Plain\n\nInstructions:\nJust answer.',
    );
  });

  it('respects enabled-only — a disabled active profile resolves to undefined', () => {
    const { store, service } = build();
    const p = store.create(1, { platform: 'discord', name: 'Off', prompt: 'x' });
    store.setActive(1, 'discord', p.id);
    store.update(1, p.id, { enabled: false });
    expect(service.activeAppend(1, 'discord')).toBeUndefined();
  });

  it('isolates platforms — a web profile does not leak into discord', () => {
    const { store, service } = build();
    const web = store.create(1, { platform: 'web', name: 'WebOnly', prompt: 'web voice' });
    store.setActive(1, 'web', web.id);
    expect(service.activeAppend(1, 'discord')).toBeUndefined();
    expect(service.activeAppend(1, 'web')).toContain('WebOnly');
  });
});
