import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { isAbsolute, resolve } from 'node:path';

/** The CLI's notion of the directory it is working in — how it is labelled, and how a user-typed `/cd`
 *  argument becomes a path. The directory ITSELF is `process.cwd()`, deliberately: it is what
 *  `/brain/start`, `/brain/send`, `!` shell commands, `@` expansion, `/export` and prompt history all
 *  read at call time, so one `process.chdir` moves every one of them at once. A second tracked copy
 *  would be a second source of truth for the same fact. */

/** Shorten a directory for display: `$HOME/x` → `~/x`, everything else verbatim. The separator in the
 *  comparison is load-bearing — it keeps `/home/filipe` from matching the home `/home/filip`. */
export function prettyCwd(cwd = process.cwd(), home = homedir()): string {
  return cwd.startsWith(`${home}/`) ? `~/${cwd.slice(home.length + 1)}` : cwd;
}

/** The current git branch, or the short HEAD when detached. Empty string when `cwd` is not a repo —
 *  a missing branch is a normal state to render, not an error to report. */
export function gitBranch(cwd = process.cwd()): string {
  try {
    const branch = execFileSync('git', ['branch', '--show-current'], {
      cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (branch) return branch;
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

/** The reason a `chdir` failed, without the paths.
 *
 *  Node's message ends `, chdir '<old>' -> '<new>'`. The caller already names the target, and `<old>` is
 *  where the user just was — so the paths are redundant while the errno is the whole answer: ENOENT,
 *  ENOTDIR and EACCES are three different problems. Anything not shaped like a chdir error is returned
 *  as-is rather than mangled. */
export function chdirFailure(e: unknown): string {
  return e instanceof Error ? e.message.replace(/, chdir .*$/, '') : String(e);
}

/** Expand a `/cd` argument into an absolute path: bare `~` and `~/x` against the home directory,
 *  anything relative against `from`, anything absolute untouched. Pure, so the expansion is testable
 *  without moving the real process.
 *
 *  `~user` is NOT expanded — it resolves relative to `from` like any other name. Looking up another
 *  user's home would need /etc/passwd, and a literal `./~ubuntu` directory is likelier here than the
 *  shell's user-home syntax. No existence or permission check: `process.chdir` reports both itself,
 *  with the errno the user needs to see. */
export function resolveCdTarget(arg: string, from = process.cwd(), home = homedir()): string {
  const trimmed = arg.trim();
  if (trimmed === '~') return home;
  if (trimmed.startsWith('~/')) return resolve(home, trimmed.slice(2));
  return isAbsolute(trimmed) ? trimmed : resolve(from, trimmed);
}
