'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown } from 'lucide-react';

export interface SelectMenuOption<T extends string = string> {
  value: T;
  label: string;
  icon?: ReactNode;
}

/**
 * Shared dark single-choice dropdown. Unlike a native select, the popup stays inside Elowen's visual
 * system and can carry meaningful icons. The host owns the value; this component only handles the
 * accessible trigger, listbox, outside click, Escape, and selection focus return.
 */
export function SelectMenu<T extends string>({ value, onChange, options, label, variant = 'default', className = '' }: {
  value: T;
  onChange: (value: T) => void;
  options: SelectMenuOption<T>[];
  label: string;
  variant?: 'default' | 'line';
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const selected = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const choose = (next: T) => {
    onChange(next);
    setOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <div ref={rootRef} className={`relative min-w-0 ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-label={label}
        aria-controls={listId}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className={`flex h-9 w-full min-w-0 items-center gap-2 text-sm transition-[border-color,background-color,box-shadow] ${variant === 'line'
          ? `border-b px-1 ${open ? 'border-accent text-accent' : 'border-border bg-transparent text-text hover:border-border-strong'}`
          : `rounded-md border px-3 ${open ? 'border-accent/60 bg-accent/10 text-accent shadow-[0_0_0_3px_rgb(255_82_54_/_0.08)]' : 'border-border bg-surface text-text hover:border-border-strong hover:bg-elevated'}`}`}
      >
        {selected?.icon ? <span className="flex shrink-0 text-accent" aria-hidden>{selected.icon}</span> : null}
        <span className="min-w-0 flex-1 truncate text-left">{selected?.label ?? ''}</span>
        <ChevronDown size={13} className={`shrink-0 text-text-muted transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>

      {open ? (
        <div id={listId} role="listbox" aria-label={label} className="absolute left-0 top-full z-50 mt-2 w-max min-w-full max-w-80 origin-top-left animate-fade-up rounded-xl border border-border bg-surface p-1.5 shadow-[var(--shadow-raised)]">
          {options.map((option) => {
            const active = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => choose(option.value)}
                className={`flex w-full min-w-0 items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors ${active ? 'bg-accent/10 text-accent' : 'text-text hover:bg-elevated'}`}
              >
                {option.icon ? <span className={`flex shrink-0 ${active ? 'text-accent' : 'text-text-muted'}`} aria-hidden>{option.icon}</span> : null}
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                {active ? <Check size={15} className="shrink-0 text-accent" aria-hidden /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
