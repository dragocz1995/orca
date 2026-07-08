import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSessionStream } from '../../lib/useSessionStream';

class FakeES {
  static readonly CLOSED = 2;
  static last: FakeES;
  listeners: Record<string, (e: { data: string }) => void> = {};
  onerror: (() => void) | null = null;
  readyState = 0;
  closed = false;
  constructor(public url: string) { FakeES.last = this; }
  addEventListener(type: string, fn: (e: { data: string }) => void) { this.listeners[type] = fn; }
  close() { this.closed = true; }
  emit(type: string, data: unknown) { this.listeners[type]?.({ data: JSON.stringify(data) }); }
}
beforeEach(() => { (globalThis as unknown as { EventSource: typeof FakeES }).EventSource = FakeES; });

describe('useSessionStream', () => {
  it('returns the latest pane from a pane event', () => {
    const { result } = renderHook(() => useSessionStream('elowen-A'));
    expect(FakeES.last.url).toContain('/sessions/elowen-A/stream');
    act(() => FakeES.last.emit('pane', { pane: 'frame-1' }));
    expect(result.current).toBe('frame-1');
    act(() => FakeES.last.listeners['pane']?.({ data: 'not json' })); // malformed → skipped, no throw
    expect(result.current).toBe('frame-1');
  });
  it('closes the source on unmount', () => {
    const { unmount } = renderHook(() => useSessionStream('elowen-A'));
    const es = FakeES.last; unmount();
    expect(es.closed).toBe(true);
  });

  // A CLOSED error stops the retry loop (close the source); a transient drop is left to the browser's
  // native auto-reconnect. Auth is never touched here — the session cookie is httpOnly and a real
  // expiry is handled by the regular request path, not this stream.
  it('closes the source on a CLOSED error', () => {
    renderHook(() => useSessionStream('elowen-A'));
    const es = FakeES.last;
    es.readyState = FakeES.CLOSED;
    es.onerror?.();
    expect(es.closed).toBe(true);
  });
  it('leaves the source open on a transient (non-CLOSED) error', () => {
    renderHook(() => useSessionStream('elowen-A'));
    const es = FakeES.last;
    es.readyState = 0;
    es.onerror?.();
    expect(es.closed).toBe(false);
  });
});
