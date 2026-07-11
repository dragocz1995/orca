import type { ReactNode } from 'react';

export function ControlSurfaceDocument({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section data-control-surface className={`control-surface-document ${className}`}>{children}</section>;
}

export function ControlSurfaceToolbar({ children, className = '', testId }: { children: ReactNode; className?: string; testId?: string }) {
  return <div className={`control-surface-toolbar ${className}`} data-testid={testId}>{children}</div>;
}

export function ControlSurfaceRegister({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`control-surface-register ${className}`}>{children}</div>;
}

export function ControlSurfaceState({ children, tone = 'default', className = '' }: { children: ReactNode; tone?: 'default' | 'danger'; className?: string }) {
  return <div className={`control-surface-state ${className}`} data-tone={tone}>{children}</div>;
}
