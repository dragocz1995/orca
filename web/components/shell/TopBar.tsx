'use client';
import Link from 'next/link';
import { User, Menu } from 'lucide-react';
import { useTranslation } from '../../lib/i18n';
import { useMe } from '../../lib/queries';
import { usePageHeader } from '../../lib/pageHeader';
import { NotificationBell } from '../ui/NotificationBell';
import { Avatar } from '../ui/Avatar';
import { ThemeToggle } from '../ui/ThemeToggle';
import { LanguageSwitcher } from '../ui/LanguageSwitcher';

/** Global top bar: the current page's title (+ count badge) on the left — published by the page's
 *  <ModuleHeader> — and the account controls (bell / theme / language / avatar) on the right. The
 *  page's own filters/actions stay below the bar with the content. In drawer mode the hamburger sits
 *  left of the title. */
export function TopBar({ onMenuClick }: { onMenuClick?: () => void }) {
  const { t } = useTranslation();
  const me = useMe();
  const ph = usePageHeader();
  const { title, count, icon: Icon } = ph?.header ?? {};
  return (
    <div className="sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-bg/80 px-4 backdrop-blur-md">
      <div className="flex min-w-0 items-center gap-2.5">
        {onMenuClick ? (
          <button type="button" onClick={onMenuClick} aria-label={t.common.toggleSidebar} className="-ml-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-elevated hover:text-text">
            <Menu size={20} aria-hidden />
          </button>
        ) : null}
        {Icon ? <Icon size={20} strokeWidth={1.75} className="shrink-0 text-text-muted" aria-hidden /> : null}
        {title ? <h1 className="truncate text-lg font-semibold tracking-tight text-text">{title}</h1> : null}
        {count !== undefined ? <span className="shrink-0 rounded-full bg-elevated px-2 py-0.5 font-mono text-xs text-text-muted">{count}</span> : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <NotificationBell />
        <ThemeToggle />
        <LanguageSwitcher />
        <Link
          href="/account"
          className="ml-0.5 flex items-center rounded-full transition-opacity hover:opacity-80"
          title={me.data?.user ? (me.data.user.name || me.data.user.username) : t.common.daemon}
        >
          {me.data?.user
            ? <Avatar user={me.data.user} size={34} />
            : <span className="flex h-[34px] w-[34px] items-center justify-center rounded-full border border-border bg-elevated"><User size={17} className="text-text-muted" aria-hidden /></span>}
        </Link>
      </div>
    </div>
  );
}
