import { describe, it, expect } from 'vitest';
import { openDb } from '../../src/store/db.js';
import { UserSettingStore } from '../../src/store/userSettingStore.js';

describe('UserSettingStore', () => {
  it('defaults CLI settings when nothing is stored', () => {
    const s = new UserSettingStore(openDb(':memory:'));
    expect(s.cliSettings(1)).toEqual({ model: '', autoCompact: false, autoCompactAt: 80 });
  });

  it('round-trips model + autoCompact + threshold via the typed helper', () => {
    const s = new UserSettingStore(openDb(':memory:'));
    s.setCliSettings(1, { model: 'ollama/kimi-k2.7-code', autoCompact: true, autoCompactAt: 70 });
    expect(s.cliSettings(1)).toEqual({ model: 'ollama/kimi-k2.7-code', autoCompact: true, autoCompactAt: 70 });
  });

  it('clamps the auto-compact threshold into the safe band', () => {
    const s = new UserSettingStore(openDb(':memory:'));
    s.setCliSettings(1, { autoCompactAt: 5 });
    expect(s.cliSettings(1).autoCompactAt).toBe(30);
    s.setCliSettings(1, { autoCompactAt: 200 });
    expect(s.cliSettings(1).autoCompactAt).toBe(95);
  });

  it('applies a partial patch without clobbering the other field', () => {
    const s = new UserSettingStore(openDb(':memory:'));
    s.setCliSettings(1, { model: 'm', autoCompact: true });
    s.setCliSettings(1, { model: 'n' });
    expect(s.cliSettings(1)).toEqual({ model: 'n', autoCompact: true, autoCompactAt: 80 });
  });

  it('isolates settings per user', () => {
    const s = new UserSettingStore(openDb(':memory:'));
    s.setCliSettings(1, { model: 'a' });
    s.setCliSettings(2, { model: 'b' });
    expect(s.cliSettings(1).model).toBe('a');
    expect(s.cliSettings(2).model).toBe('b');
  });

  it('removeForUser drops a user\'s settings', () => {
    const s = new UserSettingStore(openDb(':memory:'));
    s.setCliSettings(1, { model: 'a', autoCompact: true });
    s.removeForUser(1);
    expect(s.cliSettings(1)).toEqual({ model: '', autoCompact: false, autoCompactAt: 80 });
  });
});
