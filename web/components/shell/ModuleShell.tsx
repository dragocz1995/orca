'use client';
import type { ReactNode } from 'react';

export function ModuleShell({ moduleId, children }: { moduleId: string; children: ReactNode }) {
  return <section data-module={moduleId} className="module-root flex flex-col gap-4">{children}</section>;
}
