'use client';
import { useRef, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { useElementWidth } from '../../lib/useElementWidth';

export interface SettingsSection {
  id: string;
  label: string;
  icon: LucideIcon;
}

/** Width (px of THIS component's own box) at/above which the category list becomes a sticky left
 *  sidebar; below it folds into one horizontally scrollable pill row. Measured, not viewport-based —
 *  so the layout adapts to the room the advisor dock leaves, not just the window. */
const SIDEBAR_MIN = 768;

/** Settings-style page body: a sticky category sidebar on the left (VS Code / Vercel style) with the
 *  section content beside it. When space is tight the sidebar folds into one horizontally scrollable
 *  pill row, so every category stays reachable. Keyboard/AT semantics match Segmented (radiogroup), so
 *  tests and muscle memory carry over.
 *
 *  Uses a ResizeObserver rather than CSS container queries ON PURPOSE: the section content ({children})
 *  can contain full-screen `fixed inset-0` modals, and a `container-type` ancestor would re-anchor them
 *  to this box instead of the viewport. Measuring in JS keeps the layout responsive without containment. */
export function SettingsLayout({ sections, value, onChange, ariaLabel, children }: {
  sections: SettingsSection[];
  value: string;
  onChange: (id: string) => void;
  ariaLabel: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const width = useElementWidth(ref);
  const wide = width === 0 || width >= SIDEBAR_MIN; // default wide until measured (avoids a pill-row flash)
  return (
    <div ref={ref} className={wide ? 'grid min-w-0 grid-cols-[230px_minmax(0,1fr)] items-start gap-8' : 'flex min-w-0 flex-col gap-6'}>
      <nav
        role="radiogroup"
        aria-label={ariaLabel}
        className={wide
          ? 'sticky top-20 flex flex-col gap-0.5'
          : 'scrollbar-none -mx-1 flex gap-1 overflow-x-auto px-1'}
      >
        {sections.map(({ id, label, icon: Icon }) => {
          const on = id === value;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(id)}
              className={`flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm transition-colors ${wide ? 'w-full rounded-l-none border-l-2' : ''} ${
                on
                  ? `bg-accent/12 font-medium text-accent ${wide ? 'border-accent' : ''}`
                  : `text-text-muted hover:bg-elevated hover:text-text ${wide ? 'border-transparent' : ''}`
              }`}
              style={{ transitionDuration: 'var(--motion-fast)' }}
            >
              <Icon size={16} aria-hidden className="shrink-0" />
              {label}
            </button>
          );
        })}
      </nav>
      <div className="flex min-w-0 flex-col gap-6">{children}</div>
    </div>
  );
}
