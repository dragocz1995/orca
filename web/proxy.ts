import { NextResponse } from 'next/server';

// Force the app-shell HTML to revalidate on every load. Next serves its prerendered pages with
// Cache-Control: s-maxage=31536000, and next.config `headers()` does NOT override that for static
// routes — so a shared cache (Cloudflare) or a sticky browser/PWA cache can pin a stale shell (old
// hashed JS chunks → old code) long after a deploy, stranding users on a pre-fix bundle. The proxy
// (Next 16's renamed middleware) runs on every matched request and reliably overrides the header.
//
// `no-cache` still allows efficient 304 revalidation via ETag. The matcher excludes /_next/* (the
// content-hashed static assets keep their immutable long-lived cache) and /elowen-api/* (proxied to the
// daemon, which sets its own headers).
export function proxy() {
  const res = NextResponse.next();
  res.headers.set('Cache-Control', 'no-cache, must-revalidate');
  return res;
}

export const config = {
  matcher: ['/((?!_next/|elowen-api/).*)'],
};
