import type { ButtonHTMLAttributes } from 'react';
import type { LucideIcon } from 'lucide-react';

type Variant = 'default' | 'accent' | 'ghost' | 'danger';
const VARIANTS: Record<Variant, string> = {
  default: 'bg-surface border-border text-text hover:bg-elevated',
  accent: 'bg-accent border-accent text-bg hover:opacity-90',
  ghost: 'bg-transparent border-transparent text-text-muted hover:text-text',
  danger: 'bg-transparent border-danger text-danger hover:bg-danger hover:text-bg',
};

export function Button({ variant = 'default', icon: Icon, className = '', children, ...rest }: { variant?: Variant; icon?: LucideIcon } & ButtonHTMLAttributes<HTMLButtonElement>) {
  const extra = className.trim();
  return (
    <button
      className={`inline-flex items-center gap-2 border px-3 py-1.5 text-sm rounded-none transition-colors hover:-translate-y-px disabled:translate-y-0 disabled:opacity-40 disabled:cursor-not-allowed ${VARIANTS[variant]}${extra ? ` ${extra}` : ''}`}
      {...rest}
    >
      {Icon ? <Icon size={14} aria-hidden /> : null}
      {children}
    </button>
  );
}
