// Keep in sync with the server-side allow-list (`src/shared/execs.ts` → KNOWN_EXECS / EXEC_NOTES).
export const EXEC_PRESETS: { label: string; exec: string }[] = [
  { label: 'GLM 5.2', exec: 'ollama-cloud/glm-5.2' },
  { label: 'GPT 5.5', exec: 'codex:gpt-5.5' },
  { label: 'Claude Sonnet 4.5', exec: 'sonnet' },
  { label: 'Claude Opus 4.8', exec: 'opus' },
  { label: 'DeepSeek V4 Pro', exec: 'ollama-cloud/deepseek-v4-pro' },
  { label: 'Kimi k2.7 Code', exec: 'ollama/kimi-k2.7-code' },
  { label: 'MiniMax M3', exec: 'ollama-cloud/minimax-m3' },
  { label: 'DeepSeek v4 Flash', exec: 'ollama-cloud/deepseek-v4-flash' },
  { label: 'MiniMax M2.7', exec: 'ollama-cloud/minimax-m2.7' },
  { label: 'GLM 5.1', exec: 'ollama-cloud/glm-5.1' },
  { label: 'QWEN 3.5', exec: 'ollama-cloud/qwen3.5' },
];

/** Preset models (minus hidden/deleted) merged with custom models, deduped by exec. Custom overrides preset labels. */
export function allModels(custom: { label: string; exec: string }[] = [], hidden: string[] = []): { label: string; exec: string }[] {
  const customExecs = new Set(custom.map((m) => m.exec));
  const hiddenExecs = new Set(hidden);
  const presets = EXEC_PRESETS.filter((p) => !customExecs.has(p.exec) && !hiddenExecs.has(p.exec));
  return [...presets, ...custom];
}
