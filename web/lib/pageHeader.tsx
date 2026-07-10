'use client';
import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

/** The page title (+ optional count + icon) that the shell's frameless masthead shows. A page publishes
 *  it via <ModuleHeader>; page-local filters and actions remain in the module body below. */
export type PageHeader = { title?: string; count?: number; icon?: LucideIcon };

const PageHeaderContext = createContext<{ header: PageHeader; setHeader: (h: PageHeader) => void } | null>(null);

export function PageHeaderProvider({ children }: { children: ReactNode }) {
  const [header, setHeaderState] = useState<PageHeader>({});
  const setHeader = useCallback((h: PageHeader) => setHeaderState(h), []);
  // Memoized so the context value only changes identity when the header itself changes — an inline
  // object here would give every provider render a fresh value, re-running any consumer effect that
  // (correctly) lists the context in its deps and turning a single setHeader into an infinite loop.
  const value = useMemo(() => ({ header, setHeader }), [header, setHeader]);
  return <PageHeaderContext.Provider value={value}>{children}</PageHeaderContext.Provider>;
}

/** Null outside the provider (e.g. the chromeless terminal pop-out), so callers must optional-chain. */
export function usePageHeader() {
  return useContext(PageHeaderContext);
}
