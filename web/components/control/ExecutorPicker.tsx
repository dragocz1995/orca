'use client';
const PRESETS: { label: string; exec: string }[] = [
  { label: 'Claude Sonnet', exec: 'sonnet' },
  { label: 'DeepSeek v4 Flash', exec: 'ollama/deepseek-v4-flash' },
  { label: 'Kimi k2.7 Code', exec: 'ollama/kimi-k2.7-code' },
  { label: 'Minimax m2.7', exec: 'ollama/minimax-m2.7' },
  { label: 'Codex gpt-5.4', exec: 'codex:gpt-5.4' },
];
export function ExecutorPicker({ onPick }: { onPick: (exec: string) => void }) {
  return (
    <select
      defaultValue=""
      onChange={(e) => e.target.value && onPick(e.target.value)}
      className="bg-surface border border-border rounded-none px-2 py-1 text-xs text-text"
    >
      <option value="" disabled>Launch as…</option>
      {PRESETS.map((p) => <option key={p.exec} value={p.exec}>{p.label}</option>)}
    </select>
  );
}
