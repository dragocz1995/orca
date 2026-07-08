import * as p from '../ui/prompts.js';
import { resolveToken, NeedsLogin, login } from './token.js';
import { runChat } from './app.js';

/** Raised when the interactive login can't proceed: the user pressed esc, or there is no TTY to
 *  render the Orca modals into. Carries an actionable, user-facing message. */
function loginCancelled(): Error {
  return new Error(
    'Login requires an interactive terminal. Run `orca login` from a terminal, '
    + 'or set the ORCA_TOKEN environment variable to a valid token.',
  );
}

/** Interactive login → cache a full-scope token, returning it. Used by `orca login` and as the
 *  fallback when chat finds no token in the env or cache. Credentials are collected through the
 *  Orca modal prompts (framed, masked password). Wrong credentials let the user retry; pressing esc
 *  or running without a TTY aborts with an actionable error instead of hanging or looping. */
export async function interactiveLogin(base: string, env: NodeJS.ProcessEnv): Promise<string> {
  for (;;) {
    const username = await p.text({ message: 'Username' });
    if (p.isCancel(username)) throw loginCancelled();
    const password = await p.password({ message: 'Password' });
    if (p.isCancel(password)) throw loginCancelled();
    try {
      return await login(base, { username, password }, env);
    } catch (e) {
      // Wrong credentials (or a transient login error) — surface it and let the user try again.
      // esc on the next prompt aborts cleanly via `loginCancelled`, so this never spins on a non-TTY.
      p.log.error(e instanceof Error ? e.message : String(e));
    }
  }
}

/** Resolve a token (env → cache → interactive login) and open the interactive Orca chat TUI. The single
 *  entry point shared by the `orca chat` command and the launcher menu's "Talk to Orca" item. */
export async function launchChat(
  base: string, env: NodeJS.ProcessEnv,
  opts: { model?: string; session?: string; fresh?: boolean } = {},
): Promise<void> {
  let token: string;
  try { token = resolveToken(env); }
  catch (e) { if (e instanceof NeedsLogin) token = await interactiveLogin(base, env); else throw e; }
  await runChat({ base, token, model: opts.model, session: opts.session, fresh: opts.fresh });
}
