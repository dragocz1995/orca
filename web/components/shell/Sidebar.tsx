'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV = [
  { href: '/dash', label: 'Dash' },
  { href: '/tasks', label: 'Tasks' },
  { href: '/sessions', label: 'Sessions' },
  { href: '/missions', label: 'Missions' },
];

export function Sidebar() {
  const path = usePathname();
  return (
    <nav className="flex flex-col border-r border-border bg-surface">
      {NAV.map((n) => {
        const active = path === n.href;
        return (
          <Link
            key={n.href}
            href={n.href}
            className={`border-l-2 px-4 py-2 text-sm uppercase tracking-wide transition-colors ${active ? 'border-accent text-text' : 'border-transparent text-text-muted hover:text-text'}`}
          >
            {n.label}
          </Link>
        );
      })}
    </nav>
  );
}
