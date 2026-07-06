'use client';
import { useEffect, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { usePageHeader } from '../../lib/pageHeader';

/** Publishes the page title (+ optional count + icon) into the global TopBar, and renders ONLY the
 *  page's own actions/filters row (and optional subtitle) below the bar. The title itself no longer
 *  renders inline — it lives in the always-visible top strip — so pages get a stable heading up top
 *  while their filters stay with the content. If a page has no children/subtitle, nothing renders here. */
export function ModuleHeader({ title, count, icon: Icon, children, subtitle }: { title: string; count?: number; icon?: LucideIcon; children?: ReactNode; subtitle?: string }) {
  // Depend on the stable setHeader only — the context VALUE changes whenever the header state does
  // (which this very effect writes), so listing it in the deps would re-run the effect after its own
  // update and loop forever, starving the transition-based router navigation.
  const setHeader = usePageHeader()?.setHeader;
  useEffect(() => {
    setHeader?.({ title, count, icon: Icon });
    return () => setHeader?.({});
  }, [title, count, Icon, setHeader]);

  if (!children && !subtitle) return null;
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      {subtitle ? <p className="text-sm text-text-muted">{subtitle}</p> : <span className="hidden sm:block" aria-hidden />}
      {children ? <div className="flex flex-wrap items-center gap-2 sm:shrink-0">{children}</div> : null}
    </div>
  );
}
