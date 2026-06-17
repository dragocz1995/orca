type Tone = 'default' | 'accent';
export function StatCard({ label, value, hint, tone = 'default' }: { label: string; value: string | number; hint?: string; tone?: Tone }) {
  return (
    <div className="bg-surface border border-border rounded-none p-4 flex flex-col gap-1" style={{ boxShadow: 'var(--shadow-card)' }}>
      <span className="font-mono uppercase tracking-widest text-text-muted" style={{ fontSize: 'var(--text-caption)' }}>{label}</span>
      <span className={`font-mono ${tone === 'accent' ? 'text-accent' : 'text-text'}`} style={{ fontSize: 'var(--text-display)' }}>{value}</span>
      {hint && <span className="text-text-muted" style={{ fontSize: 'var(--text-caption)' }}>{hint}</span>}
    </div>
  );
}
