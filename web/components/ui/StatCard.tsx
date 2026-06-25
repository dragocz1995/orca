import type { LucideIcon } from 'lucide-react';

/** A big, airy stat card: large number/label + faint icon. Shared by the dashboard's system
 *  overview and the stats page so both read identically. `value` is a string or number so callers
 *  can pass a formatted figure ("$12.34", "1.2M") or a raw count. */
export function StatCard({ value, label, icon: Icon }: { value: string | number; label: string; icon: LucideIcon }) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-5" style={{ boxShadow: 'var(--shadow-card)' }}>
      <Icon size={18} className="text-text-muted" aria-hidden />
      <div className="flex flex-col gap-1">
        <span className="font-mono text-3xl font-semibold leading-none tabular-nums text-text">{value}</span>
        <span className="text-[11px] uppercase tracking-wider text-text-muted">{label}</span>
      </div>
    </div>
  );
}
