import { describe, it, expect } from 'vitest';
import { composeFrame } from '../../../components/terminal/frame';

const CLEAR = '\x1b[H\x1b[2J';
const HIDE = '\x1b[?25l';

describe('composeFrame', () => {
  it('wraps the pane body in clear/home + hide-cursor', () => {
    expect(composeFrame('hello')).toBe(`${CLEAR}hello${HIDE}`);
  });
  it('handles an empty pane', () => {
    expect(composeFrame('')).toBe(`${CLEAR}${HIDE}`);
  });
});
