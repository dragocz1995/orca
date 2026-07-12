'use client';
import { type ReactNode, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { HelpCircle } from 'lucide-react';
import { useTranslation } from '../../lib/i18n';

/** A small "?" that reveals a custom tooltip on hover/focus. For inline field help. */
export function HelpTip({ children, align = 'right' }: { children: ReactNode; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { t } = useTranslation();

  useLayoutEffect(() => {
    if (!open) { setPosition(null); return; }
    const updatePosition = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = 256;
      const gutter = 8;
      const edge = 12;
      const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
      const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
      const roomLeft = rect.left - gutter - edge >= width;
      const roomRight = viewportWidth - rect.right - gutter - edge >= width;
      // The existing right alignment opens to the left of the trigger. Flip only when it would hit
      // the viewport edge; explicit left alignment keeps its normal preference when possible.
      const openRight = align === 'left' ? (!roomLeft || roomRight) : !roomLeft && roomRight;
      const left = openRight
        ? Math.min(rect.right + gutter, viewportWidth - width - edge)
        : Math.max(edge, rect.left - width - gutter);
      const top = Math.min(rect.bottom + gutter, viewportHeight - edge);
      setPosition({ left, top });
    };
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [align, open]);

  const tooltip = open && position && typeof document !== 'undefined'
    ? createPortal(
      <span
        role="tooltip"
        className="fixed z-[130] w-64 pointer-events-none rounded-md border border-border bg-surface p-3 text-xs font-normal normal-case leading-relaxed tracking-normal text-text-muted"
        style={{ left: position.left, top: position.top, boxShadow: 'var(--shadow-raised)' }}
      >
        {children}
      </span>,
      document.body,
    )
    : null;

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-label={t.common.help}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="inline-flex h-4 w-4 items-center justify-center text-text-muted transition-colors hover:text-text"
      >
        <HelpCircle size={14} aria-hidden />
      </button>
      {tooltip}
    </span>
  );
}
