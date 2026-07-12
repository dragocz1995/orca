'use client';
import { type ReactNode, useState } from 'react';
import { HelpCircle } from 'lucide-react';
import { useTranslation } from '../../lib/i18n';

/** A small "?" that reveals a custom tooltip on hover/focus. For inline field help. */
export function HelpTip({ children, align = 'right', layout = 'overlay' }: {
  children: ReactNode;
  align?: 'left' | 'right';
  /** Inline hints reserve layout space, which keeps dense modal forms fully usable. */
  layout?: 'overlay' | 'inline';
}) {
  const [open, setOpen] = useState(false);
  const { t } = useTranslation();
  return (
    <span
      className={layout === 'inline' ? 'inline-flex min-w-0 flex-col items-start' : 'relative inline-flex'}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label={t.common.help}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="inline-flex h-4 w-4 items-center justify-center text-text-muted transition-colors hover:text-text"
      >
        <HelpCircle size={14} aria-hidden />
      </button>
      {open && (
        <span
          role="tooltip"
          data-layout={layout}
          className={layout === 'inline'
            ? 'mt-2 block max-w-64 rounded-md border border-border bg-elevated p-3 text-xs font-normal normal-case leading-relaxed tracking-normal text-text-muted'
            : `absolute top-6 z-50 w-64 rounded-md border border-border bg-surface p-3 text-xs font-normal normal-case leading-relaxed tracking-normal text-text-muted ${align === 'right' ? 'right-0' : 'left-0'}`}
          style={{ boxShadow: 'var(--shadow-raised)' }}
        >
          {children}
        </span>
      )}
    </span>
  );
}
