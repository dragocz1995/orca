import { basename } from 'node:path';

const COMBINING_MARKS = /[̀-ͯ]/g; // accent marks left behind by NFKD decomposition

/** Derive a kebab-case project slug from a folder path: lowercase the basename, strip accents, keep
 *  [a-z0-9], collapse runs into single dashes, trim edge dashes. Falls back to 'project' when nothing
 *  usable remains (e.g. a path whose basename is only symbols). */
export function deriveSlug(path: string): string {
  const base = basename(path.replace(/[/\\]+$/, ''));
  const slug = base
    .toLowerCase()
    .normalize('NFKD')
    .replace(COMBINING_MARKS, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'project';
}

/** Return `base` when it's free, otherwise the first `base-2`, `base-3`, … not already in `taken`. */
export function uniqueSlug(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}
