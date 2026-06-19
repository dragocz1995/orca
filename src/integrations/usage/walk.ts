import { readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Recursively yield every file path under `dir` (depth-limited). Returns [] if dir is missing. */
export function walkFiles(dir: string, maxDepth = 4): string[] {
  const out: string[] = [];
  const visit = (d: string, depth: number) => {
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory()) { if (depth < maxDepth) visit(p, depth + 1); }
      else out.push(p);
    }
  };
  visit(dir, 0);
  return out;
}
