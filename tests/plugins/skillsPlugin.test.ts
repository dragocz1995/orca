import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { loadPlugins } from '../../src/plugins/loader.js';
import { formatSkillsForPrompt } from '@earendil-works/pi-coding-agent';

const log = { info() {}, warn() {}, error() {} };
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

describe('bundled skills plugin', () => {
  it('registers at least one skill from its bundled dir', async () => {
    const reg = await loadPlugins({ dirs: [resolve(repoRoot, 'plugins')], enabled: ['skills'], logger: log });
    expect(reg.skills.length).toBeGreaterThan(0);
    expect(reg.skills.map((s) => s.name)).toContain('elowen-control');
  });

  it('the registered skills format into a non-empty prompt block', async () => {
    const reg = await loadPlugins({ dirs: [resolve(repoRoot, 'plugins')], enabled: ['skills'], logger: log });
    expect(formatSkillsForPrompt(reg.skills).length).toBeGreaterThan(0);
  });
});
