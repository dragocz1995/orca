import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { InferenceClient } from '../inference/types.js';

const here = dirname(fileURLToPath(import.meta.url));

/** Built-in fallback if the prompt .md cannot be read (e.g. not copied into dist). */
const FALLBACK_PROMPT = [
  'You are the Pilot: decompose the goal into 3 to 7 ordered phases and name each phase\'s agent.',
  'Return ONLY a JSON array of {"title": string, "type": "task"|"feature"|"bug"|"chore", "agent": string}.',
  '',
  'Goal: {{goal}}',
].join('\n');

let cachedDefault: string | null = null;
/** Default planner prompt template (editable in Settings). Read once from autopilotPrompt.md. */
export function defaultPromptTemplate(): string {
  if (cachedDefault === null) {
    try { cachedDefault = readFileSync(join(here, 'autopilotPrompt.md'), 'utf-8').trim(); }
    catch { cachedDefault = FALLBACK_PROMPT; }
  }
  return cachedDefault;
}

/** Task types a phase may take; anything else is coerced to 'task'. */
export const VALID_TYPES = new Set(['task', 'feature', 'bug', 'chore']);

export interface Phase { title: string; type: string; agent?: string; details?: string }

/** Sanitize a model-supplied agent name into a tmux-safe single token. */
function sanitizeAgentName(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const clean = raw.replace(/[^A-Za-z0-9]/g, '').slice(0, 24);
  return clean.length > 0 ? clean : undefined;
}

/** Per-project context fed to the Pilot — the project's saved "Pilot info" notes. */
export interface PlanProjectContext { notes?: string }

/** Render the project notes into a planning-context block, or '' when there are none. */
function projectContextBlock(project?: PlanProjectContext): string {
  const notes = project?.notes?.trim();
  return notes ? `Project context (use this when planning):\n${notes}` : '';
}

/**
 * Build the decomposition prompt: substitute the goal ({{goal}}) and the project's Pilot
 * notes ({{project}}) into the template. If the template has no {{project}} placeholder, the
 * context block is prepended so saved templates still pick up the notes.
 */
export function planPrompt(goal: string, template?: string, project?: PlanProjectContext): string {
  let tpl = (template ?? defaultPromptTemplate()).trim();
  const ctx = projectContextBlock(project);
  if (tpl.includes('{{project}}')) tpl = tpl.replaceAll('{{project}}', ctx).trim();
  else if (ctx) tpl = `${ctx}\n\n${tpl}`;
  return tpl.includes('{{goal}}') ? tpl.replaceAll('{{goal}}', goal) : `${tpl}\n\nGoal: ${goal}`;
}

/** Extract and validate the phase array from raw LLM output. Throws on unparseable/empty output. */
export function parsePhases(text: string): Phase[] {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) throw new Error('no JSON array in plan output');
  const raw = JSON.parse(match[0]) as unknown; // caller wraps in try/catch
  if (!Array.isArray(raw)) throw new Error('plan output is not an array');
  const phases = raw
    .filter((p): p is { title: string; type?: unknown; agent?: unknown; details?: unknown } => !!p && typeof (p as { title?: unknown }).title === 'string' && (p as { title: string }).title.trim().length > 0)
    .map((p) => ({
      title: p.title.trim(),
      type: VALID_TYPES.has(String(p.type)) ? String(p.type) : 'task',
      agent: sanitizeAgentName(p.agent),
      details: typeof p.details === 'string' && p.details.trim() ? p.details.trim() : undefined,
    }));
  if (phases.length === 0) throw new Error('plan output had no valid phases');
  return phases;
}

/** Run the LLM decomposition for a goal and return validated phases. */
export async function decompose(inf: InferenceClient, goal: string, template?: string, project?: PlanProjectContext): Promise<Phase[]> {
  const { text } = await inf.decide(planPrompt(goal, template, project));
  return parsePhases(text);
}
