import { describe, it, expect } from 'vitest';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPlugins } from '../../src/plugins/loader.js';

const log = { info() {}, warn() {}, error() {} };
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

describe('discord plugin', () => {
  it('registers no platform without a botToken (warns instead of crashing)', async () => {
    const reg = await loadPlugins({ dirs: [join(repoRoot, 'plugins')], enabled: ['discord'], logger: log });
    expect(reg.platforms).toHaveLength(0);
  });

  it('registers the platform adapter when a botToken is configured', async () => {
    const reg = await loadPlugins({
      dirs: [join(repoRoot, 'plugins')], enabled: ['discord'], logger: log,
      config: { discord: { botToken: 'tok', rolePolicies: [] } },
    });
    expect(reg.platforms.map((p) => p.name)).toEqual(['discord']);
  });
});

describe('discord splitContent (code-block-aware chunking)', () => {
  it('never breaks a fenced code block across a chunk boundary', async () => {
    const { splitContent } = await import(join(repoRoot, 'plugins/discord/index.mjs')) as { splitContent: (t: string) => string[] };
    const big = '```js\n' + 'const x = 1;\n'.repeat(400) + '```'; // > 2000 chars, one fence
    const pieces = splitContent(big);
    expect(pieces.length).toBeGreaterThan(1);
    for (const p of pieces) {
      expect(p.length).toBeLessThanOrEqual(2100);
      expect((p.match(/```/g)?.length ?? 0) % 2).toBe(0); // every piece has balanced fences
    }
    // reassembled (stripping the injected reopen/close fences) preserves the code lines
    expect(pieces.join('')).toContain('const x = 1;');
  });

  it('leaves short text untouched', async () => {
    const { splitContent } = await import(join(repoRoot, 'plugins/discord/index.mjs')) as { splitContent: (t: string) => string[] };
    expect(splitContent('ahoj')).toEqual(['ahoj']);
  });
});
