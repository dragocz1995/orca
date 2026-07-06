import type { BrainGoalRow, BrainStore } from '../store/brainStore.js';
import { extractText } from './messageView.js';

export interface StoredSubgoal { text: string; done?: boolean }

export function parseSubgoals(raw: string): StoredSubgoal[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is StoredSubgoal => !!item && typeof item === 'object' && typeof (item as { text?: unknown }).text === 'string')
      : [];
  } catch {
    return [];
  }
}

export function goalDraft(text: string): string {
  return [
    `outcome: ${text}`,
    'verification: identify concrete evidence before declaring done, such as passing tests, command output, a reviewed diff, or a created artifact',
    'constraints: keep changes focused and respect the current project/session rules',
    'boundaries: stay inside the active project unless the user explicitly expands scope',
    'stop_when: blocked by missing credentials, unsafe/destructive operation, user decision, or the configured turn budget',
  ].join('\n');
}

export function goalPrompt(row: BrainGoalRow): string {
  const subgoals = parseSubgoals(row.subgoals);
  return [
    'Persistent goal started.',
    '',
    `Goal: ${row.goal}`,
    row.draft ? `\nDraft contract:\n${row.draft}` : '',
    subgoals.length ? `\nSubgoals:\n${subgoals.map((s, i) => `${i + 1}. ${s.text}`).join('\n')}` : '',
    '',
    'Work autonomously toward the goal. After each turn, provide concrete evidence for progress. Do not declare completion unless you can point to test output, command output, a diff, an artifact, or another verifiable result.',
  ].filter(Boolean).join('\n');
}

export function goalContinuePrompt(row: BrainGoalRow): string {
  const subgoals = parseSubgoals(row.subgoals);
  return [
    'Continue the active persistent goal.',
    `Goal: ${row.goal}`,
    `Budget: turn ${row.turns_used + 1}/${row.turn_budget}`,
    subgoals.length ? `Subgoals:\n${subgoals.map((s, i) => `${i + 1}. ${s.done ? '[x]' : '[ ]'} ${s.text}`).join('\n')}` : '',
    'If the goal is complete, say so only with concrete evidence. If blocked or unsafe, explain the blocker clearly instead of looping.',
  ].filter(Boolean).join('\n');
}

export function lastAssistantText(store: BrainStore, sessionId: string): string {
  const row = [...store.getMessages(sessionId)].reverse().find((m) => m.role === 'assistant');
  if (!row) return '';
  try { return extractText(JSON.parse(row.content)); }
  catch { return ''; }
}

export function judgeGoalCompletion(text: string): { done: boolean; evidence: string } {
  const compact = text.replace(/\s+/g, ' ').trim();
  const doneWords = /\b(done|complete|completed|fixed|resolved|hotovo|dokončeno|vyřešeno)\b/i.test(compact);
  const evidenceMatch = /(test[s]? (passed|pass|green)|build (passed|succeeded|success)|typecheck (passed|success)|lint (passed|success)|command output|diff|patch|wrote|edited|created|artifact|verified|ověřeno|prošlo)/i.exec(compact);
  const evidence = evidenceMatch ? truncateEvidence(compact, evidenceMatch.index) : '';
  return { done: doneWords && !!evidenceMatch, evidence };
}

function truncateEvidence(text: string, at: number): string {
  const start = Math.max(0, at - 80);
  return text.slice(start, Math.min(text.length, at + 180));
}
