// Build the Next.js web app as a self-contained standalone server and assemble it under `web-dist/`
// so it ships inside the npm package. Next's standalone output deliberately omits `.next/static` and
// `public/` (it assumes a CDN), so we copy both in — without them the UI loads no CSS/JS and serves
// no Monaco assets. The launcher then runs `node web-dist/server.js`.
import { execFileSync } from 'node:child_process';
import { cpSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const web = join(root, 'web');
const standalone = join(web, '.next', 'standalone');
const dest = join(root, 'web-dist');

console.log('[build-web-bundle] building the Next standalone server…');
execFileSync('npm', ['--prefix', web, 'run', 'build'], { stdio: 'inherit' });

if (!existsSync(join(standalone, 'server.js'))) {
  throw new Error('[build-web-bundle] standalone server.js not found — is `output: "standalone"` set in web/next.config.ts?');
}

console.log('[build-web-bundle] assembling web-dist/…');
rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
// 1) the standalone server + its minimal node_modules
cpSync(standalone, dest, { recursive: true });
// 2) static assets (hashed JS/CSS chunks) — standalone omits these
cpSync(join(web, '.next', 'static'), join(dest, '.next', 'static'), { recursive: true });
// 3) public/ (incl. the self-hosted Monaco editor under public/monaco) — also omitted
if (existsSync(join(web, 'public'))) cpSync(join(web, 'public'), join(dest, 'public'), { recursive: true });

console.log(`[build-web-bundle] done → ${dest}`);
