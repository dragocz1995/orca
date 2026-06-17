import { describe, it, expect } from 'vitest';
import { FakeTmuxDriver } from '../../src/tmux/fakeDriver.js';

describe('FakeTmuxDriver', () => {
  it('records sent keys and returns scripted pane content', async () => {
    const t = new FakeTmuxDriver();
    t.setPane('s1', 'hello');
    await t.sendKeys('s1', ['Enter']);
    expect(await t.capturePane('s1', 60)).toBe('hello');
    expect(t.sentKeys('s1')).toEqual([['Enter']]);
    expect(await t.list()).toEqual(['s1']);
  });
});
