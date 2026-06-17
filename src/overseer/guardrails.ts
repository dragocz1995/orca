export const GUARDRAILS = ['schema', 'migration', 'auth', 'payments', 'destructive'] as const;

const PATTERNS: Record<string, RegExp> = {
  schema: /\bschema\b/i,
  migration: /\bmigrat/i,
  auth: /\bauth|login|password|token\b/i,
  payments: /\bpayment|billing|stripe|invoice\b/i,
  destructive: /\bdelete|drop|truncate|rm -rf|destroy\b/i,
};

export function detectGuardrails(text: string): string[] {
  return GUARDRAILS.filter(g => PATTERNS[g]!.test(text));
}

export function isCleared(triggered: string[], cleared: string[]): boolean {
  return triggered.every(g => cleared.includes(g));
}
