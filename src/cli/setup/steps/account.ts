import * as p from '@clack/prompts';
import { isFirstRun, createAdmin, login } from '../../setup.js';
import { guard, type StepResult, type WizardCtx } from '../types.js';

/** Step 0 — the daemon's first admin. On a fresh box (zero users) create it; on a re-run or an
 *  `orca install` box an admin already exists, so offer to sign in (later steps need the token) or skip. */
export async function runAccountStep(ctx: WizardCtx): Promise<StepResult> {
  const first = await isFirstRun(ctx.fetchFn, ctx.base);
  return first ? createFlow(ctx) : existingFlow(ctx);
}

async function createFlow(ctx: WizardCtx): Promise<StepResult> {
  const username = (guard(await p.text({
    message: 'Admin username', initialValue: 'admin',
    validate: (v) => (!(v ?? '').trim() ? 'Required' : undefined),
  })) as string).trim();
  const password = guard(await p.password({
    message: 'Admin password', validate: (v) => ((v ?? '').length < 4 ? 'At least 4 characters' : undefined),
  })) as string;
  guard(await p.password({
    message: 'Confirm password', validate: (v) => (v !== password ? 'Passwords do not match' : undefined),
  }));

  const s = p.spinner();
  s.start('Creating admin…');
  try {
    ctx.token = await createAdmin(ctx.fetchFn, ctx.base, { username, password });
    s.stop('Admin account created.');
    ctx.answers.account = { username, created: true, signedIn: true };
    return { status: 'done', summary: `${username} (created)` };
  } catch (e) {
    const msg = (e as Error).message;
    s.stop(`Creating the admin failed: ${msg}`);
    // 409: a user appeared between the first-run check and the create → sign in instead of aborting.
    if (msg.includes('(409)')) return existingFlow(ctx);
    return { status: 'skipped', summary: 'not created' };
  }
}

async function existingFlow(ctx: WizardCtx): Promise<StepResult> {
  p.log.info('An admin account already exists.');
  const choice = guard(await p.select({
    message: 'How do you want to continue?',
    options: [
      { value: 'signin', label: 'Sign in', hint: 'recommended — later steps need it' },
      { value: 'skip', label: 'Skip for now' },
      { value: 'back', label: '← Go back' },
    ],
  })) as string;
  if (choice === 'back') return { status: 'back' };
  if (choice === 'skip') {
    p.log.warn('Skipped — steps that change shared settings need an admin sign-in and may be limited.');
    ctx.answers.account = { username: '', created: false, signedIn: false };
    return { status: 'skipped', summary: 'not signed in' };
  }
  // Sign-in loop: a wrong password retries without leaving the step.
  for (;;) {
    const username = (guard(await p.text({ message: 'Username', initialValue: 'admin' })) as string).trim();
    const password = guard(await p.password({ message: 'Password' })) as string;
    const s = p.spinner();
    s.start('Signing in…');
    try {
      ctx.token = await login(ctx.fetchFn, ctx.base, { username, password });
      s.stop('Signed in.');
      ctx.answers.account = { username, created: false, signedIn: true };
      return { status: 'done', summary: `${username} (signed in)` };
    } catch (e) {
      s.stop(`Sign-in failed: ${(e as Error).message}`);
      const again = guard(await p.confirm({ message: 'Try again?', initialValue: true }));
      if (!again) { ctx.answers.account = { username: '', created: false, signedIn: false }; return { status: 'skipped', summary: 'not signed in' }; }
    }
  }
}
