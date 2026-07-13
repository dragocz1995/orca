import { describe, it, expect } from 'vitest';
import { descriptorCapabilities, inferredModelCapabilities } from '../../src/brain/modelCapabilities.js';

/** The effort ladder Elowen would offer for a model on a custom endpoint registered as `elowen-<id>`. */
const levels = (provider: string, model: string) => inferredModelCapabilities(`elowen-${provider}`, model).levels;

describe('descriptorCapabilities — models.dev catalog', () => {
  it('offers the efforts a reasoning model really accepts (the ladder is per endpoint, not per name)', () => {
    // The regression that started this: GLM was in no family regex, so it was declared non-reasoning and
    // every effort change was refused. It reasons — but only at high/max, never at low/medium.
    expect(levels('ollama', 'glm-5.2')).toEqual(['high', 'max']);
    expect(levels('zai', 'glm-5.2')).toEqual(['high', 'max']);
    // The SAME model through OpenRouter accepts a different ladder. A name heuristic cannot express this;
    // offering `max` here (or `low` anywhere) would send an effort the endpoint rejects.
    expect(levels('openrouter', 'z-ai/glm-5.2')).toEqual(['high', 'xhigh']);
  });

  it('reads a self-hosted pull through its tag', () => {
    // `ollama pull glm-5.2` lands as `glm-5.2:latest`; the capability belongs to the model, not the tag.
    expect(levels('ollama-local', 'glm-5.2:latest')).toEqual(['high', 'max']);
    // A tag the catalog DOES publish keeps its own row rather than being collapsed to the bare id.
    expect(levels('ollama', 'gpt-oss:120b')).toEqual(['low', 'medium', 'high']);
  });

  it('marks a model that reasons without a settable effort as reasoning, but offers no levels', () => {
    // qwen3.5 thinks, yet exposes only an on/off toggle — advertising an effort knob it does not have
    // would put an unsupported `reasoning_effort` on every request.
    expect(descriptorCapabilities('elowen-ollama', 'qwen3.5:397b').reasoning).toBe(true);
    expect(levels('ollama', 'qwen3.5:397b')).toEqual([]);
    expect(levels('openrouter', 'deepseek/deepseek-r1')).toEqual([]);
  });

  it('lets the catalog correct the name heuristics rather than the other way round', () => {
    // `gpt-5-pro` matches the OpenAI family regex, which would offer it minimal…xhigh. It takes `high`
    // and nothing else.
    expect(levels('openai', 'gpt-5-pro')).toEqual(['high']);
    expect(levels('openai', 'o3')).toEqual(['low', 'medium', 'high']);
    // …and the chat variants match the same regex while not reasoning at all.
    expect(descriptorCapabilities('elowen-openai', 'gpt-5.3-chat-latest').reasoning).toBe(false);
  });

  it('falls back to the family heuristics for a model the catalog has not published', () => {
    // A relay's private variant is in no catalog; the OpenAI family ladder (and its `ultra` label) still
    // applies, so a fresh release is usable before the table is refreshed.
    expect(levels('relay', 'openai/gpt-5.6-sol')).toEqual(['minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
    expect(descriptorCapabilities('elowen-relay', 'openai/gpt-5.6-sol').labels).toEqual({ xhigh: 'ultra' });
  });

  it('still refuses to guess for an unknown id', () => {
    // Unchanged contract: a plain chat model on a private endpoint must never be sent `reasoning_effort`.
    expect(descriptorCapabilities('elowen-relay', 'my-private-chat-model')).toEqual({ reasoning: false });
    expect(descriptorCapabilities('elowen-relay', 'text-embedding-3-large')).toEqual({ reasoning: false });
  });

  it('keeps Codex OAuth on its own rule — ChatGPT is not a models.dev endpoint', () => {
    const codex = descriptorCapabilities('openai-codex', 'gpt-5.6');
    expect(codex.reasoning).toBe(true);
    expect(codex.fast).toBe(true);
    expect(codex.labels).toEqual({ xhigh: 'ultra' });
    expect(inferredModelCapabilities('openai-codex', 'gpt-5.6').levels)
      .toEqual(['minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
  });
});
