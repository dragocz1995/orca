import { existsSync, realpathSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Policy } from '../../plugins/policy.js';
import { realPathWithin } from '../../plugins/pathGuard.js';

/** The client-reported directory, validated: a real directory the caller may access (all-access:
 *  anywhere; scoped: inside an allowed repo root), realpath-resolved. Undefined otherwise. */
export function clientDir(policy: Policy, clientCwd?: string): string | undefined {
  if (!clientCwd) return undefined;
  try {
    const real = realpathSync(clientCwd);
    if (!statSync(real).isDirectory()) return undefined;
    if (policy.allowedProjectIds === 'all') return real;
    return realPathWithin(real, policy.allowedPaths()) ?? undefined;
  } catch { return undefined; /* vanished or unreadable directory — the caller falls back */ }
}

/** The canonical root of the Git worktree containing a validated client directory. This is solely a
 * preference scope — conversation addressing continues to use the exact validated cwd. Scoped users
 * may only use a root that itself belongs to one of their allowed project paths. */
export function gitProjectRoot(policy: Policy, clientCwd?: string): string | undefined {
  const dir = clientDir(policy, clientCwd);
  if (!dir) return undefined;
  let current = dir;
  while (true) {
    if (existsSync(join(current, '.git'))) {
      return policy.allowedProjectIds === 'all' || realPathWithin(current, policy.allowedPaths())
        ? current
        : undefined;
    }
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

/** The default tool cwd for one owner-chat turn: the client-reported directory when it is a real
 *  directory the caller may access (all-access: anywhere; scoped: inside an allowed repo root), else
 *  their first allowed root, else the daemon's primary project. Never the daemon process cwd —
 *  systemd runs that at `/`. Returns undefined only when no fallback exists (tools then keep their
 *  own `defaultCwd()` chain). */
export function turnWorkDir(policy: Policy, clientCwd: string | undefined, projectPath?: () => string | undefined): string | undefined {
  return clientDir(policy, clientCwd) ?? policy.allowedPaths()[0] ?? projectPath?.();
}
