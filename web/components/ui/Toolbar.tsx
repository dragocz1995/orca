import type { ReactNode } from 'react';
export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="flex items-center gap-2 border-b border-border px-3 py-2">{children}</div>;
}
