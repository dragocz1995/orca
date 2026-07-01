import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadPlugins } from '../../src/plugins/loader.js';

const log = { info() {}, warn() {}, error() {} };

function makePlugin(root: string, name: string, body: string, apiVersion = '1') {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'orca-plugin.json'), JSON.stringify({
    name, version: '0.1.0', apiVersion, description: name, entry: 'index.mjs',
  }));
  writeFileSync(join(dir, 'index.mjs'), body);
  return dir;
}

const SKILL = (n: string) => `{name:'${n}',description:'d',filePath:'/s/${n}.md'}`;

describe('loadPlugins', () => {
  let root: string;
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'orca-plugins-'));
    makePlugin(root, 'good', `export function register(ctx){ ctx.registerSkill(${SKILL('g')}); }`);
    makePlugin(root, 'other', `export function register(ctx){ ctx.registerSystemPromptFragment('frag'); }`);
    makePlugin(root, 'broken', `export function register(){ throw new Error('boom'); }`);
    makePlugin(root, 'disabled', `export function register(ctx){ ctx.registerSkill(${SKILL('x')}); }`);
    makePlugin(root, 'badver', `export function register(ctx){ ctx.registerSkill(${SKILL('v')}); }`, '999');
    makePlugin(root, 'usesconfig', `export function register(ctx){ ctx.registerSystemPromptFragment(ctx.config.msg); }`);
  });

  it('loads only enabled plugins and aggregates their contributions', async () => {
    const reg = await loadPlugins({ dirs: [root], enabled: ['good', 'other'], logger: log });
    expect(reg.skills.map((s) => s.name)).toEqual(['g']);
    expect(reg.promptFragments).toEqual(['frag']);
  });

  it('skips a broken plugin without throwing, still loading its sibling', async () => {
    const reg = await loadPlugins({ dirs: [root], enabled: ['broken', 'good'], logger: log });
    expect(reg.skills.map((s) => s.name)).toEqual(['g']);
  });

  it('skips a plugin with an unsupported apiVersion', async () => {
    const reg = await loadPlugins({ dirs: [root], enabled: ['badver'], logger: log });
    expect(reg.skills).toHaveLength(0);
  });

  it('ignores plugins not in the enabled list', async () => {
    const reg = await loadPlugins({ dirs: [root], enabled: ['good'], logger: log });
    expect(reg.skills).toHaveLength(1);
  });

  it('passes each plugin its own config slice', async () => {
    const reg = await loadPlugins({ dirs: [root], enabled: ['usesconfig'], config: { usesconfig: { msg: 'hi' } }, logger: log });
    expect(reg.promptFragments).toEqual(['hi']);
  });

  it('tolerates a missing directory', async () => {
    const reg = await loadPlugins({ dirs: [join(root, 'nope')], enabled: ['good'], logger: log });
    expect(reg.skills).toHaveLength(0);
  });
});
