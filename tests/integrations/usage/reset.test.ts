import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clearAllUsage } from '../../../src/integrations/usage/reset.js';

let home: string;

/** Seed a minimal opencode session db with `n` rows. */
function seedOpencode(rows: number): string {
  const dir = join(home, '.local', 'share', 'opencode');
  mkdirSync(dir, { recursive: true });
  const dbPath = join(dir, 'opencode.db');
  const db = new Database(dbPath);
  db.prepare('CREATE TABLE session (id INTEGER PRIMARY KEY)').run();
  for (let i = 0; i < rows; i++) db.prepare('INSERT INTO session (id) VALUES (?)').run(i + 1);
  db.close();
  return dbPath;
}

function seedClaude(): string[] {
  const a = join(home, '.claude', 'projects', '-var-www-orca');
  const b = join(home, '.claude', 'projects', '-tmp-other');
  mkdirSync(a, { recursive: true });
  mkdirSync(b, { recursive: true });
  const files = [join(a, 's1.jsonl'), join(a, 's2.jsonl'), join(b, 's3.jsonl')];
  for (const f of files) writeFileSync(f, '{"message":{"usage":{"input_tokens":1}}}\n');
  return files;
}

function seedCodex(): string[] {
  const dir = join(home, '.codex', 'sessions', '2026', '06', '22');
  mkdirSync(dir, { recursive: true });
  const files = [join(dir, 'rollout-2026-06-22T07-53-43-abc.jsonl')];
  // a non-rollout sibling that must be left untouched
  writeFileSync(join(dir, 'notes.txt'), 'keep me');
  for (const f of files) writeFileSync(f, '{"total_token_usage":{"total_tokens":1}}\n');
  return files;
}

beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'orca-usage-reset-')); });
afterEach(() => { rmSync(home, { recursive: true, force: true }); });

describe('clearAllUsage', () => {
  it('clears every executor store and reports removed counts', () => {
    const dbPath = seedOpencode(3);
    const claudeFiles = seedClaude();
    const codexFiles = seedCodex();

    const res = clearAllUsage(home);

    // opencode: rows gone, db (and schema) preserved
    expect(res.opencode).toEqual({ cleared: true, removed: 3 });
    const db = new Database(dbPath, { readonly: true });
    expect((db.prepare('SELECT COUNT(*) c FROM session').get() as { c: number }).c).toBe(0);
    db.close();

    // claude: every transcript gone across all project dirs
    expect(res.claude.cleared).toBe(true);
    expect(res.claude.removed).toBe(claudeFiles.length);
    for (const f of claudeFiles) expect(existsSync(f)).toBe(false);

    // codex: rollouts gone, the non-rollout sibling kept
    expect(res.codex.cleared).toBe(true);
    expect(res.codex.removed).toBe(codexFiles.length);
    for (const f of codexFiles) expect(existsSync(f)).toBe(false);
    expect(existsSync(join(home, '.codex', 'sessions', '2026', '06', '22', 'notes.txt'))).toBe(true);
  });

  it('treats missing stores as a no-op (not an error)', () => {
    const res = clearAllUsage(home); // nothing seeded
    expect(res.opencode).toEqual({ cleared: false, removed: 0 });
    expect(res.claude).toEqual({ cleared: false, removed: 0 });
    expect(res.codex).toEqual({ cleared: false, removed: 0 });
  });

  it('is isolated: one failing executor does not abort the others', () => {
    // opencode.db is a directory, not a db → opening it throws, but claude/codex still clear.
    mkdirSync(join(home, '.local', 'share', 'opencode', 'opencode.db'), { recursive: true });
    const claudeFiles = seedClaude();
    seedCodex();

    const res = clearAllUsage(home);

    expect(res.opencode.cleared).toBe(false);
    expect(res.opencode.error).toBeTruthy();
    expect(res.claude.cleared).toBe(true);
    expect(res.claude.removed).toBe(claudeFiles.length);
    expect(res.codex.cleared).toBe(true);
    // claude project dirs swept clean
    for (const f of claudeFiles) expect(existsSync(f)).toBe(false);
    expect(readdirSync(join(home, '.claude', 'projects', '-var-www-orca'))).toHaveLength(0);
  });
});
