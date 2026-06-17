'use client';
import type { LucideIcon } from 'lucide-react';

export function IconButton({ icon: Icon, label, onClick, variant = 'default', disabled = false }: { icon: LucideIcon; label: string; onClick?: () => void; variant?: 'default' | 'danger'; disabled?: boolean }) {
  const tone = variant === 'danger' ? 'text-danger hover:bg-danger hover:text-bg border-danger' : 'text-text-muted hover:bg-elevated hover:text-text border-border';
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex h-7 w-7 items-center justify-center border transition-colors ${tone} ${disabled ? 'opacity-40' : ''}`}
      style={{ transitionDuration: 'var(--motion-fast)' }}
    >
      <Icon size={14} aria-hidden />
    </button>
  );
}
