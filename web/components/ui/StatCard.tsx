'use client';
import { useEffect, useRef, useState } from 'react';
import type { Tone } from './tone';

const VALUE_TONE: Record<Tone, string> = {
  default: 'text-text',
  accent: 'text-accent',
  muted: 'text-text-muted',
  danger: 'text-danger',
};

// Animate the number toward `target` on change (not on first mount → SSR/test-safe).
function useCountUp(target: number): number {
  const [display, setDisplay] = useState(target);
  const prev = useRef(target);
  useEffect(() => {
    const from = prev.current;
    prev.current = target;
    if (from === target) return;
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { setDisplay(target); return; }
    let raf = 0;
    const start = performance.now();
    const dur = 450;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(Math.round(from + (target - from) * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return display;
}

export function StatCard({ label, value, hint, tone = 'default' }: { label: string; value: string | number; hint?: string; tone?: Tone }) {
  const numeric = typeof value === 'number' ? value : 0;
  const animated = useCountUp(numeric);
  const display = typeof value === 'number' ? animated : value;
  return (
    <div className="card-interactive animate-fade-up flex flex-col gap-1 rounded-lg border border-border bg-surface p-4" style={{ boxShadow: 'var(--shadow-card)' }}>
      <span className="font-mono uppercase tracking-widest text-text-muted" style={{ fontSize: 'var(--text-caption)' }}>{label}</span>
      <span className={`font-mono tabular-nums ${VALUE_TONE[tone]}`} style={{ fontSize: 'var(--text-display)' }}>{display}</span>
      {hint ? <span className="text-text-muted" style={{ fontSize: 'var(--text-caption)' }}>{hint}</span> : null}
    </div>
  );
}
