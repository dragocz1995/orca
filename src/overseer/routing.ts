import type { AgentSpec } from '../spawn/commandBuilder.js';

const PROGRAM_PREFIXES: Record<string, string> = { 'codex:': 'codex', 'opencode:': 'opencode', 'claude:': 'claude-code' };

export function resolveExecutor(labels: string[], fallback: AgentSpec): AgentSpec {
  const label = labels.find(l => l.startsWith('exec:'));
  if (!label) return fallback;
  const spec = label.slice('exec:'.length);
  for (const [prefix, program] of Object.entries(PROGRAM_PREFIXES)) {
    if (spec.startsWith(prefix)) return { program, model: spec.slice(prefix.length) };
  }
  if (spec.includes('/')) return { program: 'opencode', model: spec };
  return { program: 'claude-code', model: spec };
}
