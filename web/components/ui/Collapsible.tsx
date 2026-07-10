'use client';
import { useState, type ReactNode } from 'react';
import { ChevronDown, type LucideIcon } from 'lucide-react';

/** A collapsible section: an optional icon chip + title header with a rotating chevron, and content that
 *  hides when closed. Flat OLED styling (hairline border, no shadow) so a stack of these reads as one
 *  system. `right` renders an extra node in the header (kept outside the toggle button so it can hold its
 *  own interactive controls). */
export function Collapsible({ icon: Icon, title, subtitle, defaultOpen = false, right, children }: {
  icon?: LucideIcon;
  title: string;
  subtitle?: string;
  defaultOpen?: boolean;
  right?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="border-y border-border/80">
      <div className="flex items-center gap-3 py-3.5">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          {Icon ? (
            <span className="flex h-7 w-7 shrink-0 items-center justify-center text-text-muted">
              <Icon size={15} aria-hidden />
            </span>
          ) : null}
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-sm font-medium text-text">{title}</span>
            {subtitle ? <span className="text-xs leading-relaxed text-text-muted">{subtitle}</span> : null}
          </span>
          <ChevronDown
            size={16}
            className={`shrink-0 text-text-muted transition-transform ${open ? '' : '-rotate-90'}`}
            style={{ transitionDuration: 'var(--motion-fast)' }}
            aria-hidden
          />
        </button>
        {right ? <span className="shrink-0">{right}</span> : null}
      </div>
      {open ? <div className="border-t border-border/70 py-5">{children}</div> : null}
    </section>
  );
}
