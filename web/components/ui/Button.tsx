import type { ButtonHTMLAttributes } from 'react';

type Variant = 'default' | 'accent' | 'ghost' | 'danger';
const VARIANTS: Record<Variant, string> = {
  default: 'bg-surface border-border text-text hover:bg-elevated',
  accent: 'bg-accent border-accent text-bg hover:opacity-90',
  ghost: 'bg-transparent border-transparent text-text-muted hover:text-text',
  danger: 'bg-transparent border-border text-text hover:border-accent',
};

export function Button({ variant = 'default', className = '', ...rest }: { variant?: Variant } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={`inline-flex items-center gap-2 border px-3 py-1.5 text-sm rounded-none transition-colors ${VARIANTS[variant]} ${className}`}
      {...rest}
    />
  );
}
