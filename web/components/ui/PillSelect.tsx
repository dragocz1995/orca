'use client';
import type { LucideIcon } from 'lucide-react';

export interface PillOption<T> {
  value: T;
  label: string;
  icon?: LucideIcon;
  title?: string;
}

/** A flex-wrap group of selectable pills — a friendlier, livelier replacement for a small `<select>`.
 *  One value is active at a time. Matches the bordered-pill look used for the project picker and the
 *  Projects PR-flow toggle, so single-choice fields read consistently across the app. */
export function PillSelect<T extends string | number>({ value, onChange, options, size = 'md', className }: {
  value: T;
  onChange: (v: T) => void;
  options: PillOption<T>[];
  /** `sm` for tight inline rows (e.g. a manual phase line), `md` for full form fields. */
  size?: 'sm' | 'md';
  className?: string;
}) {
  const pad = size === 'sm' ? 'px-2 py-1' : 'px-2.5 py-1.5';
  return (
    <div className={`flex flex-wrap gap-1.5 ${className ?? ''}`}>
      {options.map((o) => {
        const on = value === o.value;
        const Icon = o.icon;
        return (
          <button
            key={String(o.value)}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={on}
            title={o.title}
            className={`inline-flex items-center gap-1.5 rounded-md border text-xs font-medium transition-colors ${pad} ${on ? 'border-accent/50 bg-accent/15 text-accent' : 'border-border bg-elevated text-text-muted hover:border-border-strong hover:text-text'}`}
            style={{ transitionDuration: 'var(--motion-fast)' }}
          >
            {Icon ? <Icon size={13} className="shrink-0" aria-hidden /> : null}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
