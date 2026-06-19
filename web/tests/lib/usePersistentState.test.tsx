import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePersistentState } from '../../lib/usePersistentState';

const ALLOWED = ['open', 'closed', 'all'] as const;
type V = (typeof ALLOWED)[number];

beforeEach(() => localStorage.clear());

describe('usePersistentState', () => {
  it('starts from the fallback when nothing is stored', () => {
    const { result } = renderHook(() => usePersistentState<V>('k', 'open', ALLOWED));
    expect(result.current[0]).toBe('open');
  });

  it('persists the value to localStorage on set', () => {
    const { result } = renderHook(() => usePersistentState<V>('k', 'open', ALLOWED));
    act(() => result.current[1]('closed'));
    expect(result.current[0]).toBe('closed');
    expect(localStorage.getItem('k')).toBe('closed');
  });

  it('rehydrates a valid stored value on mount', () => {
    localStorage.setItem('k', 'all');
    const { result } = renderHook(() => usePersistentState<V>('k', 'open', ALLOWED));
    expect(result.current[0]).toBe('all');
  });

  it('ignores a stored value that is not in the allowed set (keeps fallback)', () => {
    localStorage.setItem('k', 'bogus');
    const { result } = renderHook(() => usePersistentState<V>('k', 'open', ALLOWED));
    expect(result.current[0]).toBe('open');
  });
});
