import { describe, it, expect, beforeEach } from 'vitest';
import { getToken, setToken, clearToken, withToken } from '../../lib/token';

beforeEach(() => localStorage.clear());

describe('token store', () => {
  it('set/get/clear round-trip', () => {
    expect(getToken()).toBeNull();
    setToken('abc');
    expect(getToken()).toBe('abc');
    clearToken();
    expect(getToken()).toBeNull();
  });
  it('withToken appends the token query param', () => {
    setToken('xyz');
    expect(withToken('http://d/events')).toBe('http://d/events?token=xyz');
  });
  it('withToken leaves the url unchanged when no token', () => {
    expect(withToken('http://d/events')).toBe('http://d/events');
  });
});
