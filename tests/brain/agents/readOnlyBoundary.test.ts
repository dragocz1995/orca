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
    // An output redirection is a write and must be denied EVEN on an allow-listed read command: `>` is
    // not a command separator, so `cat x > victim` stays one segment that the `cat *` allow would match.
    expect(act(b, 'Bash', 'cat /etc/hostname > /var/www/.config/elowen/collectors/job/check.sh')).toBe('deny');
    expect(act(b, 'Bash', 'ls . > victim')).toBe('deny');
    expect(act(b, 'Bash', 'grep x f >> ~/.ssh/authorized_keys')).toBe('deny');
    expect(act(b, 'Bash', 'git log > victim')).toBe('deny');
    expect(act(b, 'Bash', 'cat x>victim')).toBe('deny');
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

  it('keeps a parent deny even on a command the read-only allow-list would otherwise re-permit', () => {
    // The critical narrowing case: the operator explicitly denied `cat` (a command that IS on the
    // read-only allow-list). The re-permit must NOT win — the parent's deny is re-asserted last, so the
    // child can never run a command the operator forbade. A deny on a non-allow-listed command (`curl`)
    // stays denied too.
    const parent: NoninteractivePermissionBoundary = {
      rules: [
        { scope: 'tools', pattern: '*', action: 'allow' },
        { scope: 'bash', pattern: 'cat *', action: 'deny' },
        { scope: 'bash', pattern: 'curl *', action: 'deny' },
      ],
      unattendedAsks: 'allow',
    };
    const b = buildReadOnlyBoundary(parent);
    expect(act(b, 'Bash', 'cat secret.txt')).toBe('deny'); // parent deny wins over the read-only re-allow
    expect(act(b, 'Bash', 'curl http://x')).toBe('deny');
    expect(act(b, 'Bash', 'ls')).toBe('allow'); // a command the parent did NOT deny still runs
  });
});
