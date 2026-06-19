import { describe, it, expect } from 'vitest';
import { enabledPlugins, enableInConfig, renderPluginConfig } from '../../src/integrations/hermesInstall.js';

const CONFIG = `# Hermes config
gateway:
  port: 8080
plugins:
  enabled:
  - coresynth-tools
  - instagram-agent
  disabled:
  - spotify
memory:
  backend: mem0
`;

describe('enabledPlugins', () => {
  it('extracts only the enabled list (not disabled or other keys)', () => {
    expect(enabledPlugins(CONFIG)).toEqual(['coresynth-tools', 'instagram-agent']);
  });
  it('returns [] when there is no plugins block', () => {
    expect(enabledPlugins('gateway:\n  port: 8080\n')).toEqual([]);
  });
});

describe('enableInConfig', () => {
  it('inserts the plugin into the enabled list, preserving the rest', () => {
    const { text, changed, already } = enableInConfig(CONFIG);
    expect(changed).toBe(true);
    expect(already).toBe(false);
    expect(enabledPlugins(text)).toContain('orca');
    expect(enabledPlugins(text)).toContain('coresynth-tools'); // others kept
    expect(text).toContain('# Hermes config'); // comments survive
    expect(text).toContain('disabled:'); // untouched
    expect(text).toContain('backend: mem0');
  });
  it('is idempotent when already enabled', () => {
    const once = enableInConfig(CONFIG).text;
    const twice = enableInConfig(once);
    expect(twice.changed).toBe(false);
    expect(twice.already).toBe(true);
    expect(twice.text).toBe(once);
  });
  it('matches the existing item indentation', () => {
    const indented = `plugins:\n  enabled:\n    - foo\n`;
    const { text } = enableInConfig(indented);
    expect(text).toContain('    - orca'); // 4-space indent matched
  });
});

describe('renderPluginConfig', () => {
  it('renders the orca section with escaped url/token', () => {
    const out = renderPluginConfig('http://h:4400', 'tok"en', 45);
    expect(out).toContain('orca:');
    expect(out).toContain('url: "http://h:4400"');
    expect(out).toContain('token: "tok\\"en"');
    expect(out).toContain('timeout: 45');
  });
});
