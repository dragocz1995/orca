import { describe, it, expect } from 'vitest';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPlugins } from '../../src/plugins/loader.js';

const log = { info() {}, warn() {}, error() {} };
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const pluginsDir = join(repoRoot, 'plugins');

describe('web plugin', () => {
  it('registers web_search + web_fetch', async () => {
    const reg = await loadPlugins({ dirs: [pluginsDir], enabled: ['web'], logger: log });
    expect(reg.tools.map((t) => t.name).sort()).toEqual(['web_fetch', 'web_search']);
  });

  it('web_search without an API key returns a helpful message instead of failing', async () => {
    const reg = await loadPlugins({ dirs: [pluginsDir], enabled: ['web'], logger: log });
    const tool = reg.tools.find((t) => t.name === 'web_search')!;
    const res = await tool.execute('t1', { query: 'orca' }, undefined as never, undefined as never);
    expect((res.content[0] as { text: string }).text).toMatch(/not configured/);
  });

  it('web_fetch refuses private addresses and non-http schemes', async () => {
    const reg = await loadPlugins({ dirs: [pluginsDir], enabled: ['web'], logger: log });
    const tool = reg.tools.find((t) => t.name === 'web_fetch')!;
    for (const url of ['http://127.0.0.1/x', 'http://localhost/x', 'file:///etc/passwd', 'http://192.168.1.1/']) {
      const res = await tool.execute('t1', { url }, undefined as never, undefined as never);
      expect((res.content[0] as { text: string }).text).toMatch(/Error/);
    }
  });

  it('web_fetch refuses IPv4-mapped IPv6 loopback literals', async () => {
    const reg = await loadPlugins({ dirs: [pluginsDir], enabled: ['web'], logger: log });
    const tool = reg.tools.find((t) => t.name === 'web_fetch')!;
    const res = await tool.execute('t1', { url: 'http://[::ffff:127.0.0.1]/x' }, undefined as never, undefined as never);
    expect((res.content[0] as { text: string }).text).toMatch(/Error/);
  });

  it('web_fetch does NOT follow a redirect that points at a private address (SSRF via 302)', async () => {
    const reg = await loadPlugins({ dirs: [pluginsDir], enabled: ['web'], logger: log });
    const tool = reg.tools.find((t) => t.name === 'web_fetch')!;
    const origFetch = globalThis.fetch;
    let hops = 0;
    // Public IP literal (no DNS) that 302s to the daemon's loopback API.
    globalThis.fetch = (async () => {
      hops++;
      return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1:4400/admin' } });
    }) as typeof fetch;
    try {
      const res = await tool.execute('t1', { url: 'http://8.8.8.8/start' }, undefined as never, undefined as never);
      expect((res.content[0] as { text: string }).text).toMatch(/private address/);
      expect(hops).toBe(1); // stopped after the first hop; never fetched the loopback target
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('web_fetch follows a redirect to another PUBLIC url and returns its body', async () => {
    const reg = await loadPlugins({ dirs: [pluginsDir], enabled: ['web'], logger: log });
    const tool = reg.tools.find((t) => t.name === 'web_fetch')!;
    const origFetch = globalThis.fetch;
    const seen: string[] = [];
    globalThis.fetch = (async (url: string | URL) => {
      seen.push(String(url));
      if (seen.length === 1) return new Response(null, { status: 301, headers: { location: 'http://1.1.1.1/final' } });
      return new Response('hello world', { status: 200, headers: { 'content-type': 'text/plain' } });
    }) as typeof fetch;
    try {
      const res = await tool.execute('t1', { url: 'http://8.8.8.8/start' }, undefined as never, undefined as never);
      expect((res.content[0] as { text: string }).text).toContain('hello world');
      expect(seen).toEqual(['http://8.8.8.8/start', 'http://1.1.1.1/final']);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('htmlToText strips markup, scripts and entities', async () => {
    const { htmlToText } = await import(join(pluginsDir, 'web/index.mjs')) as { htmlToText: (h: string) => string };
    const text = htmlToText('<head><title>x</title></head><body><script>evil()</script><h1>Ahoj &amp; vítej</h1><p>Řádek</p></body>');
    expect(text).toContain('Ahoj & vítej');
    expect(text).toContain('Řádek');
    expect(text).not.toContain('evil');
  });
});
