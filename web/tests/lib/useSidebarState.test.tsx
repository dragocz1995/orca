import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSidebarState } from '../../lib/useSidebarState';

beforeEach(() => localStorage.clear());

describe('useSidebarState', () => {
  it('toggles collapsed and persists', () => {
    const { result } = renderHook(() => useSidebarState());
    expect(result.current.collapsed).toBe(false);
    act(() => result.current.toggle());
    expect(result.current.collapsed).toBe(true);
    expect(JSON.parse(localStorage.getItem('elowen-sidebar')!).collapsed).toBe(true);
  });
  it('clamps width and persists', () => {
    const { result } = renderHook(() => useSidebarState());
    act(() => result.current.setWidth(9999));
    expect(result.current.width).toBe(360);
    act(() => result.current.setWidth(10));
    expect(result.current.width).toBe(160);
  });
  it('reads stored state on mount', () => {
    localStorage.setItem('elowen-sidebar', JSON.stringify({ collapsed: true, width: 300 }));
    const { result } = renderHook(() => useSidebarState());
    expect(result.current.collapsed).toBe(true);
    expect(result.current.width).toBe(300);
  });
});
