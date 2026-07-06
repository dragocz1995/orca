import * as p from '@clack/prompts';
import { runAccountStep } from './steps/account.js';
import { runProjectStep } from './steps/project.js';
import { runAiStep } from './steps/aiProvider.js';
import { runMemoryStep } from './steps/memory.js';
import { readMarker, writeMarker } from './marker.js';
import { guard, WizardCancelled, type WizardAnswers, type WizardCtx, type WizardStep } from './types.js';

const STEPS: WizardStep[] = [
  { id: 'account', title: 'Account', run: runAccountStep },
  { id: 'project', title: 'Project', run: runProjectStep },
  { id: 'ai', title: 'AI Provider', run: runAiStep },
  { id: 'memory', title: 'Memory', run: runMemoryStep },
];
const TOTAL = STEPS.length + 1; // + Review

/** What the Review screen decided: finish, skip the rest, or jump back to a step index to edit. */
export type ReviewDecision = 'finish' | 'skip-remaining' | number;

export interface NavHooks {
  onStep(index: number, step: WizardStep): void;
  review(): Promise<ReviewDecision>;
}

/** Pure step navigator — no terminal I/O, so it's unit-testable with fake steps and a scripted review.
 *  Forward on done/skipped, back on 'back' (clamped at 0), Review after the last step (which may jump to
 *  any index). A step that throws (e.g. WizardCancelled) propagates to the caller. */
export async function navigate(steps: WizardStep[], ctx: WizardCtx, hooks: NavHooks, startIndex = 0): Promise<{ done: boolean; skipped: boolean }> {
  let i = Math.max(0, Math.min(startIndex, steps.length));
  for (;;) {
    if (i >= steps.length) {
      const d = await hooks.review();
      if (d === 'finish') return { done: true, skipped: false };
      if (d === 'skip-remaining') return { done: true, skipped: true };
      i = Math.max(0, Math.min(d, steps.length - 1));
      continue;
    }
    hooks.onStep(i, steps[i]!);
    const r = await steps[i]!.run(ctx);
    i = r.status === 'back' ? Math.max(0, i - 1) : i + 1;
  }
}

export interface OnboardingOpts {
  reset?: boolean;
  debug?: boolean;
  /** Embedded inside another flow (e.g. `orca install`): skip the wizard's own intro/outro so the host
   *  provides the framing. Steps and progress still render. */
  embedded?: boolean;
}

/** Run the full onboarding wizard. Returns the admin username once the run completes (or null when the
 *  user bailed — progress is saved for resume). All configuration flows through the daemon HTTP API; only
 *  the local completion/resume marker is written here. */
export async function runOnboarding(base: string, env: NodeJS.ProcessEnv, opts: OnboardingOpts = {}): Promise<string | null> {
  const prior = opts.reset ? null : readMarker(env);
  const answers: WizardAnswers = prior?.resume?.answers ?? {};
  const ctx: WizardCtx = { base, isTTY: !!process.stdout.isTTY, debug: !!opts.debug, fetchFn: fetch, answers };
  const startIndex = prior?.resume?.stepIndex ?? 0;

  if (!opts.embedded) {
    p.intro('🐋 Welcome to Orca');
    p.log.message("Let's get your workspace ready — 5 quick steps. You can skip anything and finish later.");
  }

  let index = startIndex;
  try {
    const result = await navigate(STEPS, ctx, {
      onStep: (i, step) => { index = i; p.log.step(`[${i + 1}/${TOTAL}] ${step.title}`); },
      review: () => review(ctx),
    }, startIndex);
    finish(env, answers, result.skipped, !!opts.embedded);
    return answers.account?.username || null;
  } catch (e) {
    if (e instanceof WizardCancelled) {
      const save = await confirmSave();
      if (save) writeMarker(env, { completed: false, skipped: false, updatedAt: new Date().toISOString(), resume: { stepIndex: index, answers } });
      p.cancel(save ? 'Setup paused — resume anytime with `orca setup`.' : 'Setup cancelled.');
      return null;
    }
    throw e;
  }
}

async function review(ctx: WizardCtx): Promise<ReviewDecision> {
  const a = ctx.answers;
  p.note([
    `Account   ${accountSummary(a)}`,
    `Project   ${projectSummary(a)}`,
    `AI        ${a.ai?.summary ?? 'skipped'}`,
    `Memory    ${a.memory?.summary ?? 'skipped'}`,
  ].join('\n'), 'Setup summary');

  const decision = guard(await p.select({
    message: 'Ready to finish?',
    options: [
      { value: 'finish', label: 'Finish setup' },
      { value: 'edit', label: 'Go back and edit…' },
      { value: 'skip', label: 'Skip remaining' },
    ],
  })) as string;
  if (decision === 'finish') return 'finish';
  if (decision === 'skip') return 'skip-remaining';
  const which = guard(await p.select({ message: 'Edit which step?', options: STEPS.map((s, idx) => ({ value: String(idx), label: s.title })) })) as string;
  return Number(which);
}

/** Persist the completion marker and (unless embedded in a host flow) print the "what's ready + next
 *  command" outro (≤4 lines, no ASCII). */
function finish(env: NodeJS.ProcessEnv, answers: WizardAnswers, skipped: boolean, embedded: boolean): void {
  writeMarker(env, { completed: true, skipped, updatedAt: new Date().toISOString() });
  if (embedded) return; // the host (e.g. `orca install`) shows its own summary
  const unfinished = skipped
    || answers.project?.connected !== true
    || answers.ai?.status !== 'done'
    || answers.memory?.status !== 'done';
  const lines = ['Start Orca:      orca up', 'Talk to it:      orca chat'];
  if (unfinished) lines.push('Finish setup:    orca setup');
  p.note(lines.join('\n'), "You're set");
  p.outro('See you 🐋');
}

async function confirmSave(): Promise<boolean> {
  const ans = await p.confirm({ message: 'Save your progress and resume later?', initialValue: true });
  return !p.isCancel(ans) && ans === true;
}

function accountSummary(a: WizardAnswers): string {
  const acc = a.account;
  if (!acc) return 'skipped';
  if (acc.created) return `${acc.username} (created)`;
  if (acc.signedIn) return `${acc.username} (signed in)`;
  return 'not signed in';
}

function projectSummary(a: WizardAnswers): string {
  return a.project?.connected ? `${a.project.slug} → ${a.project.path}` : 'skipped';
}
