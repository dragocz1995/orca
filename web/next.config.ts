import type { NextConfig } from 'next';
import path from 'path';
const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
  // Emit a self-contained server (server.js + a minimal node_modules) so the web UI can ship inside
  // the npm package and run with a bare `node server.js` — no `next` CLI, no full install. The build
  // bundle script copies in `.next/static` and `public/`, which standalone deliberately omits.
  output: 'standalone',
  // The same-origin daemon proxy is now the `app/api/[...path]` route handler, which (unlike a plain
  // rewrite) injects the daemon bearer from the httpOnly session cookie server-side. No rewrite needed.
};
export default nextConfig;
