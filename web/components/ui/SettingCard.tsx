import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { HelpTip } from './HelpTip';

/** One document-style settings section: semantic glyph, title + optional description, and control.
 *  `tone` switches the glyph to the accent palette (used for the active/primary section).
 *  `description` renders as a HelpTip (?) next to the title rather than as text below it. */
export function SettingCard({ title, description, icon: Icon, tone = 'default', className, children }: {
  title: string;
  description?: string;
  icon?: LucideIcon;
  tone?: 'default' | 'accent';
  /** Extra classes on the card root — e.g. `@sm:col-span-2` to span a two-column settings grid. */
  className?: string;
  children: ReactNode;
}) {
  const chip = tone === 'accent' ? 'text-accent' : 'text-text-muted';
  return (
    <section className={`flex flex-col gap-3.5 border-y border-border/80 py-5 ${className ?? ''}`}>
      <div className="flex items-start gap-3">
        {Icon ? (
          <span className={`flex h-7 w-7 shrink-0 items-center justify-center ${chip}`}>
            <Icon size={15} aria-hidden />
          </span>
        ) : null}
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="flex items-center gap-1.5 text-sm font-medium text-text">
            {title}
            {description ? <HelpTip align="left">{description}</HelpTip> : null}
          </span>
        </div>
      </div>
      <div>{children}</div>
    </section>
  );
}
