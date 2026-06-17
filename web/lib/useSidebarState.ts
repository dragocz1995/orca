'use client';
import { useCallback, useEffect, useState } from 'react';

const KEY = 'orca-sidebar';
const MIN = 160, MAX = 360, DEFAULT = 224;
const clamp = (n: number) => Math.max(MIN, Math.min(MAX, n));

interface Stored { collapsed: boolean; width: number }

function read(): Stored {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) { const p = JSON.parse(raw) as Partial<Stored>; return { collapsed: !!p.collapsed, width: clamp(Number(p.width ?? DEFAULT)) }; }
  } catch { /* private mode / SSR — fall back to defaults */ }
  return { collapsed: false, width: DEFAULT };
}

function write(s: Stored) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore persistence failure */ }
}

export function useSidebarState() {
  const [state, setState] = useState<Stored>({ collapsed: false, width: DEFAULT });
  useEffect(() => { setState(read()); }, []);
  const toggle = useCallback(() => setState((s) => { const n = { ...s, collapsed: !s.collapsed }; write(n); return n; }), []);
  const setWidth = useCallback((w: number) => setState((s) => { const n = { ...s, width: clamp(w) }; write(n); return n; }), []);
  return { collapsed: state.collapsed, width: state.width, toggle, setWidth };
}
