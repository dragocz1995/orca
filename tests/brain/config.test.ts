import { describe, it, expect } from 'vitest';
import { openDb } from '../../src/store/db.js';
import { ConfigStore } from '../../src/store/configStore.js';
import { brainConfigFromOrca } from '../../src/brain/config.js';

describe('brainConfigFromOrca', () => {
  it('returns null when no api key is set', () => {
    const config = new ConfigStore(openDb(':memory:'));
    expect(brainConfigFromOrca(config)).toBeNull();
  });

  it('maps the relay endpoint to the openai provider when configured', () => {
    const config = new ConfigStore(openDb(':memory:'));
    config.update({ autopilot: { apiUrl: 'https://coresynth.io/v1', model: 'gpt-x', apiKey: 'cs-key' } });
    const cfg = brainConfigFromOrca(config);
    expect(cfg?.default).toBe('openai');
    expect(cfg?.openai).toMatchObject({ baseUrl: 'https://coresynth.io/v1', model: 'gpt-x', apiKey: 'cs-key' });
  });
});
