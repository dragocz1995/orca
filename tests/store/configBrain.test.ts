import { describe, it, expect } from 'vitest';
import { openDb } from '../../src/store/db.js';
import { ConfigStore } from '../../src/store/configStore.js';

const entry = { id: 'relay', label: 'CoreSynth', type: 'openai', baseUrl: 'https://ai.example/v1', models: ['m1'], apiKey: 'sek' };

describe('ConfigStore brain providers', () => {
  it('defaults to no providers', () => {
    const cs = new ConfigStore(openDb(':memory:'));
    expect(cs.get().brain.providers).toEqual([]);
  });

  it('round-trips a provider, stripping the key to apiKeySet in the public view', () => {
    const cs = new ConfigStore(openDb(':memory:'));
    cs.update({ brain: { providers: [entry] } });
    expect(cs.get().brain.providers).toEqual([
      { id: 'relay', label: 'CoreSynth', type: 'openai', baseUrl: 'https://ai.example/v1', models: ['m1'], apiKeySet: true },
    ]);
    expect(JSON.stringify(cs.get())).not.toContain('sek');
    expect(cs.brainProviders()[0]?.apiKey).toBe('sek');
  });

  it('keeps the stored key when a patched entry arrives keyless', () => {
    const cs = new ConfigStore(openDb(':memory:'));
    cs.update({ brain: { providers: [entry] } });
    cs.update({ brain: { providers: [{ ...entry, apiKey: undefined, label: 'Renamed' }] } });
    expect(cs.brainProviders()[0]?.apiKey).toBe('sek');
    expect(cs.brainProviders()[0]?.label).toBe('Renamed');
  });

  it('drops malformed entries and duplicate ids', () => {
    const cs = new ConfigStore(openDb(':memory:'));
    cs.update({ brain: { providers: [entry, { ...entry, label: 'dup' }, { id: '', type: 'openai' }, { id: 'x', type: 'bogus' }, 'junk'] } });
    expect(cs.brainProviders().map((p) => p.id)).toEqual(['relay']);
  });

  it('removing an entry via a wholesale update deletes it (and its key)', () => {
    const cs = new ConfigStore(openDb(':memory:'));
    cs.update({ brain: { providers: [entry] } });
    cs.update({ brain: { providers: [] } });
    expect(cs.brainProviders()).toEqual([]);
  });
});

describe('brain provider wire-API (api) round-trip', () => {
  const oa = { id: 'oa', label: 'OpenAI', type: 'openai', baseUrl: 'https://api.openai.com/v1', models: ['gpt-x'] };

  it('persists the pin, exposes it in the public view, and keeps it across a keyless echo', () => {
    const cs = new ConfigStore(openDb(':memory:'));
    cs.update({ brain: { providers: [{ ...oa, api: 'openai-completions', apiKey: 'sk-1' }] } });
    expect(cs.get().brain.providers[0]).toMatchObject({ api: 'openai-completions', apiKeySet: true });
    // The UI/setup round-trip re-sends the keyless public entry — pin AND key must both survive.
    cs.update({ brain: { providers: [{ ...oa, api: 'openai-completions' }] } });
    expect(cs.brainProviders()[0]).toMatchObject({ api: 'openai-completions', apiKey: 'sk-1' });
  });

  it('an entry arriving WITHOUT api resets the pin to auto (documented contract)', () => {
    const cs = new ConfigStore(openDb(':memory:'));
    cs.update({ brain: { providers: [{ ...oa, api: 'openai-responses', apiKey: 'sk-1' }] } });
    cs.update({ brain: { providers: [{ ...oa }] } });
    expect(cs.get().brain.providers[0]!.api).toBeUndefined();
  });

  it('drops api on non-openai types and rejects unknown values', () => {
    const cs = new ConfigStore(openDb(':memory:'));
    cs.update({ brain: { providers: [
      { id: 'an', label: 'Ant', type: 'anthropic', baseUrl: '', models: [], api: 'openai-responses' },
      { ...oa, api: 'not-a-real-api' },
    ] } });
    expect(cs.get().brain.providers.find((p) => p.id === 'an')!.api).toBeUndefined();
    expect(cs.get().brain.providers.find((p) => p.id === 'oa')!.api).toBeUndefined();
  });
});
