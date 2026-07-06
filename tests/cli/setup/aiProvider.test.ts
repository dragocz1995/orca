import { describe, it, expect } from 'vitest';
import { shouldWireAutopilot } from '../../../src/cli/setup/steps/aiProvider.js';
import { keepProvider, type PublicProvider } from '../../../src/cli/setup/steps/shared.js';

describe('cli/setup.shouldWireAutopilot', () => {
  it('wires only an openai-type provider that has a key (the relay trap guard)', () => {
    expect(shouldWireAutopilot('openai', true)).toBe(true);
    expect(shouldWireAutopilot('openai', false)).toBe(false); // no key → relay unusable
    expect(shouldWireAutopilot('anthropic', true)).toBe(false); // relay is OpenAI-only
    expect(shouldWireAutopilot('oauth-anthropic', true)).toBe(false);
    expect(shouldWireAutopilot('oauth-openai-codex', true)).toBe(false); // no stored key
  });
});

describe('cli/setup.keepProvider', () => {
  it('re-sends an existing provider WITHOUT its key (keyless round-trip keeps the stored secret)', () => {
    const pub: PublicProvider = { id: 'p1', label: 'OpenAI', type: 'openai', baseUrl: 'https://api.openai.com/v1', models: ['gpt-5.5'], apiKeySet: true };
    const kept = keepProvider(pub);
    expect(kept).toEqual({ id: 'p1', label: 'OpenAI', type: 'openai', baseUrl: 'https://api.openai.com/v1', models: ['gpt-5.5'] });
    expect(kept).not.toHaveProperty('apiKey');
    expect(kept).not.toHaveProperty('apiKeySet');
  });
});
