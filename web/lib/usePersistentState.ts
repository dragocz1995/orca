'use client';
import { useCallback, useEffect, useState } from 'react';

/** A `useState` whose value is mirrored into `localStorage` and rehydrated on mount.
 *  The stored value is validated against `allowed` on read, so a stale or foreign key can
 *  never poison state. SSR-safe: it starts from `fallback` and hydrates inside an effect,
 *  which avoids a server/client hydration mismatch. Single source of truth for the
 *  "remember the last section the user was on" behaviour shared across pages. */
export function usePersistentState<T extends string>(
  key: string,
  fallback: T,
  allowed: readonly T[],
): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(fallback);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw !== null && (allowed as readonly string[]).includes(raw)) setValue(raw as T);
    } catch { /* private mode / SSR — keep the fallback */ }
    // `allowed` is a stable literal per call site; only the key identifies the slot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const set = useCallback((next: T) => {
    setValue(next);
    try { localStorage.setItem(key, next); } catch { /* quota / SSR — ignore */ }
  }, [key]);

  return [value, set];
}
