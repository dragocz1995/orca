import type { ReactNode } from 'react';

/** A titled sidebar card for the PageLayout rail. Flat OLED styling with a small uppercase caption. */
export function RailCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-text-muted">{title}</h3>
      {children}
    </div>
  );
}
