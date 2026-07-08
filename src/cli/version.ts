import { readPkgVersion } from '../shared/pkgVersion.js';

/** This CLI's version from its package.json (same source as `elowen --version`), shown on the chat
 *  start screen. Read here — two dirs below the package root — because `readPkgVersion` resolves
 *  package.json relative to the calling module. */
export const ELOWEN_CLI_VERSION = readPkgVersion(import.meta.url);

/** True when `candidate` is a strictly higher version than `current`. Compares dot segments
 *  numerically (so 1.10.0 > 1.9.0, unlike a string compare), tolerates a leading `v`, and pads a
 *  shorter version with zeros (1.2 == 1.2.0). Deliberately tiny — no full semver/prerelease support;
 *  the npm registry only ever hands us plain release versions for the update check. */
export function isNewer(candidate: string, current: string): boolean {
  const parse = (v: string): number[] => v.replace(/^v/, '').split('.').map((s) => Number(s) || 0);
  const a = parse(candidate);
  const b = parse(current);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}
