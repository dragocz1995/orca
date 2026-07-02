import { describe, it, expect } from 'vitest';
import { openDb } from '../../src/store/db.js';
import { ConfigStore } from '../../src/store/configStore.js';
import { brainConfigFromOrca } from '../../src/brain/config.js';

describe('brainConfigFromOrca', () => {
  it('returns null when nothing is configured', () => {
    const config = new ConfigStore(openDb(':memory:'));
    expect(brainConfigFromOrca(config)).toBeNull();
  });

  it('falls back to the relay endpoint as a synthetic provider', () => {
    const config = new ConfigStore(openDb(':memory:'));
    config.update({ autopilot: { apiUrl: 'https://coresynth.io/v1', model: 'gpt-x', apiKey: 'cs-key' } });
    const cfg = brainConfigFromOrca(config);
    expect(cfg?.providers).toEqual([
      { id: 'relay', label: 'Relay', type: 'openai', baseUrl: 'https://coresynth.io/v1', models: ['gpt-x'], apiKey: 'cs-key' },
    ]);
  });

  it('dedicated brain.providers win over the relay fallback', () => {
    const config = new ConfigStore(openDb(':memory:'));
    config.update({
      autopilot: { apiUrl: 'https://coresynth.io/v1', model: 'gpt-x', apiKey: 'cs-key' },
      brain: { providers: [{ id: 'own', label: 'Own', type: 'openai', baseUrl: 'https://x/v1', models: ['m'], apiKey: 'k' }] },
    });
    expect(brainConfigFromOrca(config)?.providers.map((p) => p.id)).toEqual(['own']);
  });
});
