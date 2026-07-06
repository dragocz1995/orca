'use client';
import { Gauge } from 'lucide-react';
import type { MemoryCategory } from '../../lib/types';
import { Slider } from '../../components/ui/Slider';
import { CategoryIcon } from '../../lib/categoryIcons';
import { categorySwatch } from './memoryMeta';

/** A 1..5 integer rank (importance) edited as a stepped slider with an "n / 5" readout — NOT a 0..1
 *  weight, so it must never go through pct01 (the server validates importance as an int in 1..5).
 *  Shared by the create and edit memory modals so both expose importance identically. */
export function RankSlider({ label, icon: Icon = Gauge, value, onChange }: { label: string; icon?: typeof Gauge; value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="inline-flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-text-muted">
        <span className="inline-flex items-center gap-1"><Icon size={11} aria-hidden />{label}</span>
        <span className="font-mono text-text">{value} / 5</span>
      </span>
      <Slider value={value} min={1} max={5} step={1} onChange={onChange} />
    </div>
  );
}

/** Category picker showing the CURRENTLY-selected category's icon (in its colour) next to a native
 *  select — a native <option> can't carry an icon, so the icon swatch reflects the pick live. Shared by
 *  the create and edit memory modals so both set the category the same way. */
export function CategorySelect({ categories, value, onChange, ariaLabel, noneLabel }: {
  categories: MemoryCategory[]; value: number | null; onChange: (v: number | null) => void; ariaLabel: string; noneLabel: string;
}) {
  const selected = value != null ? categories.find((c) => c.id === value) : undefined;
  return (
    <div className="flex items-center gap-2">
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-surface"
        style={{ color: selected ? categorySwatch(selected.color) : undefined }}
        aria-hidden
      >
        <CategoryIcon name={selected?.icon} size={16} />
      </span>
      <select
        value={value == null ? '' : String(value)}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        aria-label={ariaLabel}
        className="h-9 w-full rounded-md border border-border bg-surface px-3 text-sm text-text focus:border-accent focus:outline-none"
      >
        <option value="">{noneLabel}</option>
        {categories.map((c) => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
      </select>
    </div>
  );
}
