import type { ReactNode, ThHTMLAttributes, TdHTMLAttributes } from 'react';

export function Table({ children }: { children: ReactNode }) {
  return <table className="w-full border-collapse text-sm">{children}</table>;
}

export function THead({ children }: { children: ReactNode }) {
  return <thead>{children}</thead>;
}

export function TR({ children }: { children: ReactNode }) {
  return <tr className="border-b border-border transition-colors hover:bg-elevated/40">{children}</tr>;
}

export function TH({ children, ...rest }: { children?: ReactNode } & ThHTMLAttributes<HTMLTableCellElement>) {
  return <th className="text-left uppercase tracking-wide text-xs text-text-muted px-3 py-2 font-normal" {...rest}>{children}</th>;
}

export function TD({ children, mono = false, ...rest }: { children: ReactNode; mono?: boolean } & TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={`px-3 py-2${mono ? ' font-mono text-text-muted' : ''}`} {...rest}>{children}</td>;
}
