'use client';
import { useRef, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { useElementWidth } from '../../lib/useElementWidth';

/** At/above this many px of CONTENT width the toolbar goes sticky-horizontal; below it stacks. */
const ROW_MIN = 512;

/** Sticky, compact module toolbar for operational pages. Holds title, count, and a right-aligned
 *  actions/toggles slot. Reacts to its OWN measured width (which the advisor dock shrinks) rather than
 *  the viewport — measured, not a CSS `@container`, because a container-type wrapper around just this
 *  header would confine `position: sticky` to the short wrapper and the header would scroll away. */
export function ModuleHeader({ title, count, icon: Icon, children }: { title: string; count?: number; icon?: LucideIcon; children?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const w = useElementWidth(ref);
  const row = w === 0 || w >= ROW_MIN; // default to the roomy layout until measured (avoids a flash)
  return (
    <div
      ref={ref}
      className={`z-20 -mx-4 -mt-4 mb-5 flex flex-col gap-2 border-b border-border bg-bg px-4 py-3 ${row ? 'sticky top-0 min-h-14 flex-row flex-wrap items-center gap-x-3 py-0' : ''}`}
    >
      <div className="flex items-center gap-2">
        {Icon ? <Icon size={16} className="shrink-0 text-text-muted" aria-hidden /> : null}
        <h1 className="font-display text-base font-semibold tracking-tight text-text">{title}</h1>
        {count !== undefined ? <span className="rounded-full bg-elevated px-2 py-0.5 font-mono text-[11px] text-text-muted">{count}</span> : null}
      </div>
      {children ? (
        <div className={`flex flex-wrap items-center gap-2 ${row ? 'ml-auto' : ''}`}>
          {children}
        </div>
      ) : null}
    </div>
  );
}
