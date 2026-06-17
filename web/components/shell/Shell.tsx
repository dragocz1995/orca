'use client';
import type { ReactNode } from 'react';
import { Providers } from '../../app/providers';
import { ToastProvider } from '../ui/Toast';
import { Sidebar } from './Sidebar';

export function Shell({ children }: { children: ReactNode }) {
  return (
    <Providers>
      <ToastProvider>
        <div className="flex min-h-screen">
          <Sidebar />
          <main className="flex-1 overflow-x-hidden p-4">{children}</main>
        </div>
      </ToastProvider>
    </Providers>
  );
}
