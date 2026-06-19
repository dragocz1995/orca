/** Normalized token usage for one agent run, summed from a CLI's local session storage.
 *  Portable: every figure comes from the coding CLI's own on-disk transcripts (opencode /
 *  claude / codex) — no relay or vendor dashboard required. */
export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
  /** USD cost when the CLI records it (opencode does); null when it must be priced externally. */
  costUsd: number | null;
}

export const EMPTY_USAGE: TokenUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, costUsd: null };

/** Tolerate small clock skew between when orca marks a task in_progress and when the CLI
 *  actually opens its session (a few seconds of startup). */
export const SESSION_MATCH_SKEW_MS = 15_000;
