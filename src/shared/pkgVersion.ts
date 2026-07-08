import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/** Resolve this package's package.json, two dirs up from the CALLING module (`dist/<area>/<file>.js` →
 *  package root). Pass `import.meta.url`. */
function pkgJsonPath(metaUrl: string): string {
  return join(dirname(fileURLToPath(metaUrl)), '..', '..', 'package.json');
}

/** Read this package's version from its package.json, defaulting to '0.0.0' if unreadable. Single source
 *  for the CLI (`elowen --version`) and the daemon (`ELOWEN_VERSION` on /health); pass `import.meta.url`. */
export function readPkgVersion(metaUrl: string): string {
  try {
    return (JSON.parse(readFileSync(pkgJsonPath(metaUrl), 'utf8')) as { version?: string }).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/** Last-install timestamp (ISO) from the mtime of this package's package.json — i.e. when the package
 *  files were last written. Reflects any (re)install, including a manual `npm install -g`, not just
 *  `elowen update`. Null if unreadable. Surfaced on /system as "last updated". */
export function readPkgInstalledAt(metaUrl: string): string | null {
  try {
    return statSync(pkgJsonPath(metaUrl)).mtime.toISOString();
  } catch {
    return null;
  }
}
