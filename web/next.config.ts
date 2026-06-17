import type { NextConfig } from 'next';
import path from 'path';
const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
  // Same-origin proxy to the orca daemon: the browser only ever talks to this
  // web origin; Next forwards /orca-api/* to the daemon on localhost. Set
  // NEXT_PUBLIC_ORCA_URL=/orca-api so the client uses these relative paths.
  async rewrites() {
    const daemon = process.env.ORCA_DAEMON_URL ?? 'http://localhost:4400';
    return [{ source: '/orca-api/:path*', destination: `${daemon}/:path*` }];
  },
};
export default nextConfig;
