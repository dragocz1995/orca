'use client';
import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';

export interface NavEntry { href: string; label: string; icon: LucideIcon; badge?: number }

export function NavItem({ entry, active, collapsed }: { entry: NavEntry; active: boolean; collapsed: boolean }) {
  const Icon = entry.icon;
  const badge = entry.badge && entry.badge > 0 ? entry.badge : 0;
  return (
    <Link
      href={entry.href}
      title={collapsed ? entry.label : undefined}
      aria-current={active ? 'page' : undefined}
      className={`relative flex items-center gap-3 border-l-2 px-3 py-2 text-sm transition-colors ${active ? 'border-accent text-text' : 'border-transparent text-text-muted hover:text-text'}${collapsed ? ' justify-center' : ''}`.trim()}
    >
      <span className="relative shrink-0">
        <Icon size={16} strokeWidth={1.5} aria-hidden />
        {badge > 0 && collapsed && (
          <span className="absolute -right-1.5 -top-1.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-warning px-0.5 text-[9px] font-bold text-black">{badge}</span>
        )}
      </span>
      {!collapsed && <span className="uppercase tracking-wide text-xs">{entry.label}</span>}
      {badge > 0 && !collapsed && (
        <span className="ml-auto flex h-4 min-w-4 items-center justify-center rounded-full bg-warning/15 px-1 text-[10px] font-bold text-warning">{badge}</span>
      )}
    </Link>
  );
}
