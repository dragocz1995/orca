import { describe, it, expect } from 'vitest';
import { buildReadOnlyBoundary } from '../../../src/brain/agents/readOnlyBoundary.js';
import { resolveToolPermission, type NoninteractivePermissionBoundary } from '../../../src/brain/toolPermissions.js';

const act = (b: NoninteractivePermissionBoundary, tool: string, command?: string) =>
  resolveToolPermission(b.rules, tool, command).action;

describe('buildReadOnlyBoundary — a read-only agent cannot mutate even though it runs unattended', () => {
  it('allows read-only shell + tools and denies writes and mutating shell (null parent)', () => {
    const b = buildReadOnlyBoundary(null);
    // Unattended: an `ask` must never resolve to allow — strict mode is forced on.
    expect(b.unattendedAsks).toBe('deny');
    // Read-only shell runs.
    expect(act(b, 'Bash', 'ls -la')).toBe('allow');
    expect(act(b, 'Bash', 'cat src/index.ts')).toBe('allow');
    expect(act(b, 'Bash', 'git status')).toBe('allow');
    expect(act(b, 'Bash', 'git diff HEAD~1')).toBe('allow');
    expect(act(b, 'Bash', 'grep -r foo .')).toBe('allow');
    // Anything that mutates is denied outright — no approver to fall back on.
    expect(act(b, 'Bash', 'rm -rf /')).toBe('deny');
    expect(act(b, 'Bash', 'npm install')).toBe('deny');
    expect(act(b, 'Bash', 'git push')).toBe('deny');
    expect(act(b, 'Bash', 'echo hi > file')).toBe('deny');
    // A chained read-then-mutate cannot ride the read-only allow (per-segment resolution).
    expect(act(b, 'Bash', 'cat x && rm -rf ~')).toBe('deny');
    // Read-only tools pass; write tools are denied (defense-in-depth — they aren't in the allow-list either).
    expect(act(b, 'Read')).toBe('allow');
    expect(act(b, 'Search')).toBe('allow');
    expect(act(b, 'Write')).toBe('deny');
    expect(act(b, 'Edit')).toBe('deny');
  });

  it('preserves the parent boundary but can only narrow it — a parent allow cannot widen back', () => {
    // A permissive parent (all shell allowed, unattended asks auto-allow) — exactly the case that would let
    // a naive read-only agent run rm. The minted boundary must clamp it.
    const parent: NoninteractivePermissionBoundary = {
      rules: [
        { scope: 'tools', pattern: '*', action: 'allow' },
        { scope: 'bash', pattern: '*', action: 'allow' },
        { scope: 'bash', pattern: 'rm *', action: 'allow' },
      ],
      unattendedAsks: 'allow',
    };
    const b = buildReadOnlyBoundary(parent);
    expect(b.unattendedAsks).toBe('deny');
    expect(act(b, 'Bash', 'rm -rf x')).toBe('deny');
    expect(act(b, 'Bash', 'ls')).toBe('allow');
    expect(act(b, 'Write')).toBe('deny');
  });

  it('keeps a parent deny that the read-only layer does not re-permit', () => {
    // A parent deny on a normally-read-only command stays denied — the read-only allow-list is appended
    // but the operator's own explicit deny is stricter and must survive. (git status is on the allow-list,
    // so we assert a command that is NOT: the parent denies `cat`, and read-only re-allows it — proving the
    // layering order — while a parent deny on a non-allow-listed command like `curl` still bites.)
    const parent: NoninteractivePermissionBoundary = {
      rules: [
        { scope: 'tools', pattern: '*', action: 'allow' },
        { scope: 'bash', pattern: 'curl *', action: 'deny' },
      ],
      unattendedAsks: 'allow',
    };
    const b = buildReadOnlyBoundary(parent);
    expect(act(b, 'Bash', 'curl http://x')).toBe('deny');
    expect(act(b, 'Bash', 'ls')).toBe('allow');
  });
});
