'use client';
import { useState } from 'react';
import { ModelIcon } from './ModelIcon';

interface Model { label: string; exec: string }

/** Executor picker as model pills (icon + name). An empty `value` means "Default". To stay compact
 *  with long allow-lists, only the first `limit` models (alphabetical) show until "+N more" is clicked;
 *  the currently-selected model is always kept visible so a collapsed list never hides the choice. */
export function ExecutorPicker({ value, onChange, models, defaultLabel, moreLabel, limit = 5, allowDefault = true }: {
  value: string;
  onChange: (exec: string) => void;
  models: Model[];
  /** Label for the empty-value pill. Only rendered when `allowDefault` (the default). */
  defaultLabel?: string;
  /** Template for the expand button, with `{count}` replaced by the hidden-model count. */
  moreLabel: string;
  limit?: number;
  /** Whether to offer the empty "default" pill. Off for fields that must resolve to a concrete model. */
  allowDefault?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const sorted = [...models].sort((a, b) => a.label.localeCompare(b.label));
  const capped = expanded ? sorted : sorted.slice(0, limit);
  // Keep the selected model visible even when it sorts past the cap and the list is collapsed.
  const shown = !expanded && value && !capped.some((m) => m.exec === value)
    ? [...capped, sorted.find((m) => m.exec === value)!].filter(Boolean)
    : capped;
  const hidden = sorted.length - shown.length;

  const pill = (active: boolean, key: string, onClick: () => void, children: React.ReactNode) => (
    <button
      key={key}
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${active ? 'border-accent/50 bg-accent/15 text-accent' : 'border-border bg-elevated text-text-muted hover:border-border-strong hover:text-text'}`}
      style={{ transitionDuration: 'var(--motion-fast)' }}
    >
      {children}
    </button>
  );

  return (
    <div className="flex flex-wrap gap-1.5">
      {allowDefault ? pill(value === '', 'default', () => onChange(''), defaultLabel) : null}
      {shown.map((m) => pill(value === m.exec, m.exec, () => onChange(m.exec), (
        <><ModelIcon name={m.exec} size={15} />{m.label}</>
      )))}
      {!expanded && hidden > 0 ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="inline-flex items-center rounded-md border border-dashed border-border px-2.5 py-1.5 text-xs font-medium text-text-muted transition-colors hover:border-border-strong hover:text-text"
          style={{ transitionDuration: 'var(--motion-fast)' }}
        >
          {moreLabel.replace('{count}', String(hidden))}
        </button>
      ) : null}
    </div>
  );
}
