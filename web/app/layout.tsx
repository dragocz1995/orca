import './globals.css';
import { GeistMono } from 'geist/font/mono';
import type { ReactNode } from 'react';
import { Shell } from '../components/shell/Shell';
import { en } from '../lib/i18n/dictionaries/en';

// Icons come from Next file conventions: app/icon.png → <link rel="icon"> and app/apple-icon.png →
// <link rel="apple-touch-icon">. Do NOT set metadata.icons here — declaring it overrides the file
// convention and drops the auto-generated favicon link.
export const metadata = {
  title: en.common.appName,
  manifest: '/manifest.json',
  appleWebApp: { capable: true, title: en.common.appName, statusBarStyle: 'black' as const },
};
export const viewport = { themeColor: '#000000' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={GeistMono.variable} suppressHydrationWarning>
      <body><Shell>{children}</Shell></body>
    </html>
  );
}
