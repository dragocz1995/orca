import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDockState } from '../../lib/useDockState';

describe('useDockState', () => {
  it('defaults to a closed right-docked panel with just the advisor pane', () => {
    const { result } = renderHook(() => useDockState());
    expect(result.current.state.open).toBe(false);
    expect(result.current.state.side).toBe('right');
    expect(result.current.state.panes).toEqual([{ id: 'advisor', kind: 'advisor' }]);
    expect(result.current.state.sizes).toEqual([1]);
  });

  it('adds a session pane (idempotent by name) and keeps sizes aligned', () => {
    const { result } = renderHook(() => useDockState());
    act(() => result.current.addSessionPane('elowen-x'));
    expect(result.current.state.panes).toHaveLength(2);
    expect(result.current.state.sizes).toHaveLength(2);
    act(() => result.current.addSessionPane('elowen-x')); // duplicate → no-op
    expect(result.current.state.panes).toHaveLength(2);
  });

  it('removes the advisor pane (re-addable later) and session panes', () => {
    const { result } = renderHook(() => useDockState());
    act(() => result.current.addSessionPane('elowen-x'));
    act(() => result.current.removePane('advisor'));
    expect(result.current.state.panes.some((p) => p.kind === 'advisor')).toBe(false);
    expect(result.current.state.advisor).toBe(false);
    act(() => result.current.removePane('elowen-x'));
    expect(result.current.state.panes).toHaveLength(0);
    expect(result.current.state.sizes).toHaveLength(0);
  });

  it('re-adds the advisor pane at the head of the stack (idempotent)', () => {
    const { result } = renderHook(() => useDockState());
    act(() => result.current.addSessionPane('elowen-x'));
    act(() => result.current.removePane('advisor'));
    act(() => result.current.addAdvisorPane());
    expect(result.current.state.panes[0]).toEqual({ id: 'advisor', kind: 'advisor' });
    expect(result.current.state.advisor).toBe(true);
    expect(result.current.state.panes).toHaveLength(2);
    act(() => result.current.addAdvisorPane()); // already present → no-op
    expect(result.current.state.panes).toHaveLength(2);
  });

  it('persists the dock side across mounts', () => {
    const first = renderHook(() => useDockState());
    act(() => first.result.current.setSide('left'));
    first.unmount();
    const second = renderHook(() => useDockState());
    expect(second.result.current.state.side).toBe('left');
  });
});
