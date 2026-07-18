import {
  normalizeNoninteractivePermissionBoundary,
  READ_ONLY_BASH_ALLOW,
  type NoninteractivePermissionBoundary,
  type PermissionRule,
} from '../toolPermissions.js';

/** The restrictions layered onto a read-only agent's boundary, in order. Appended AFTER the parent's own
 *  rules so — with last-match-wins resolution — they always win: writes are denied outright, every shell
 *  command is denied, then only the read-only allow-list is re-permitted. This can only ever NARROW: a
 *  deny beats any inherited allow, and the re-permitted commands are exactly the ones already safe by
 *  default. `Write`/`Edit` deny is defense-in-depth (a read-only agent never holds them in its tool
 *  allow-list either). */
const READ_ONLY_RESTRICT_RULES: readonly PermissionRule[] = [
  { scope: 'tools', pattern: 'Write', action: 'deny' },
  { scope: 'tools', pattern: 'Edit', action: 'deny' },
  { scope: 'bash', pattern: '*', action: 'deny' },
  ...READ_ONLY_BASH_ALLOW.map((pattern) => ({ scope: 'bash' as const, pattern, action: 'allow' as const })),
];

/**
 * Mint the immutable permission boundary for a read-only sub-agent (explore/plan).
 *
 * A sub-agent runs UNATTENDED — there is no human to answer an `ask`, so an inherited `ask` resolves via
 * the parent's `unattendedAsks` (default 'allow'), which would let a "read-only" agent holding the Bash
 * tool run `rm -rf`. This mints a strictly narrower boundary: the parent's rules PLUS the read-only
 * restrictions above, with `unattendedAsks: 'deny'` so anything not on the read-only allow-list can never
 * resolve to allow. Starting from the parent's rules keeps the operator's own extra denies intact; a null
 * parent (permission gate absent) falls back to a minimal allow-all-tools base the restrictions clamp down.
 */
export function buildReadOnlyBoundary(parent: NoninteractivePermissionBoundary | null): NoninteractivePermissionBoundary {
  const base: PermissionRule[] = parent ? parent.rules : [{ scope: 'tools', pattern: '*', action: 'allow' }];
  const boundary = normalizeNoninteractivePermissionBoundary({
    rules: [...base, ...READ_ONLY_RESTRICT_RULES],
    unattendedAsks: 'deny',
  });
  // The base was already validated on read and the appended rules are well-formed literals, so this
  // cannot fail — assert it so a future normalizer change can never silently widen the boundary.
  if (!boundary) throw new Error('invalid read-only agent boundary');
  return boundary;
}
