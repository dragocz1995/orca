import type { Model, Api, ModelThinkingLevel, ThinkingLevelMap } from '@earendil-works/pi-ai';
import { getSupportedThinkingLevels } from '@earendil-works/pi-ai';
import { MODEL_CAPABILITY_CATALOG } from './modelCapabilityData.js';

/**
 * Elowen's one model-capability vocabulary. PI keeps the canonical values stable while providers are
 * free to call the strongest level `xhigh`, `max`, or something else on the wire. User interfaces read
 * the labels from here instead of copying provider-specific guesses into every transport.
 */
export interface ModelCapabilityView {
  reasoning: boolean;
  levels: ModelThinkingLevel[];
  labels: Partial<Record<ModelThinkingLevel, string>>;
  /** ChatGPT OAuth's priority service tier (`service_tier: "priority"`). */
  fast: boolean;
}

/** Mutable, session-local request switches read by the provider hook for every model round-trip. */
export interface ProviderRequestProfile { fast: boolean }

/** Pure payload projection used by the Codex request hook (kept exportable for a no-network contract test). */
export function applyProviderRequestProfile(payload: Record<string, unknown>, profile: ProviderRequestProfile): Record<string, unknown> {
  return profile.fast ? { ...payload, service_tier: 'priority' } : payload;
}

type DescriptorPatch = {
  reasoning: boolean;
  thinkingLevelMap?: ThinkingLevelMap;
  labels?: Partial<Record<ModelThinkingLevel, string>>;
  fast?: boolean;
};

export const CANONICAL_THINKING_LEVELS: readonly ModelThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

export function isCanonicalThinkingLevel(value: string): value is ModelThinkingLevel {
  return (CANONICAL_THINKING_LEVELS as readonly string[]).includes(value);
}

const NON_REASONING = /(?:^|[-_/])(image|embedding|embed|whisper|tts|dall-e|moderation)(?:[-_/]|$)/i;
// OpenRouter and similar catalogs namespace ids (`openai/gpt-5.6-sol`), while direct endpoints use the
// bare id. Match the actual family segment in both forms rather than keying capability to one relay.
const OPENAI_REASONING = /(?:^|\/)(?:gpt-5|o[134](?:-|$))/i;
const CLAUDE_REASONING = /(?:^|\/)claude-(?:opus|sonnet|haiku)-(?:4|5)(?:[.-]|$)/i;
const GEMINI_REASONING = /(?:^|\/)gemini-(?:2\.5|3|3\.1|3\.5)(?:-|$)/i;
const OTHER_REASONING = /(?:deepseek[-_/]?r1|qwq|reasoning)/i;

/** Catalog keys for endpoints whose Elowen id differs from the published one. Ollama Cloud ships as
 *  `ollama-cloud`; a self-hosted Ollama serves the same model families, so it reads the same rows. */
const CATALOG_ALIAS: Readonly<Record<string, string>> = {
  ollama: 'ollama-cloud',
  'ollama-local': 'ollama-cloud',
};

/** The model's row in the models.dev catalog, or undefined when it lists no such model.
 *  Custom endpoints register under `elowen-<id>`, where `<id>` is the operator's provider key. */
function catalogCapability(provider: string, model: string) {
  const key = provider.startsWith('elowen-') ? provider.slice('elowen-'.length) : provider;
  const catalog = CATALOG_ALIAS[key] ?? key;
  const row = MODEL_CAPABILITY_CATALOG[`${catalog}/${model}`];
  if (row !== undefined) return row;
  // A self-hosted pull carries a tag the catalog does not publish (`glm-5.2:latest`); the capability is
  // the model's, not the tag's. Only retried when the bare id has no row of its own.
  const untagged = model.includes(':') ? model.slice(0, model.indexOf(':')) : undefined;
  return untagged ? MODEL_CAPABILITY_CATALOG[`${catalog}/${untagged}`] : undefined;
}

/** Turn an accepted effort ladder into PI's map: a level the endpoint does not accept is `null`
 *  (unsupported), and `off` is never an effort — a reasoning model always thinks. */
function ladderToMap(levels: readonly ModelThinkingLevel[]): ThinkingLevelMap {
  const map: ThinkingLevelMap = {
    off: null, minimal: null, low: null, medium: null, high: null, xhigh: null, max: null,
  };
  for (const level of levels) map[level] = level;
  return map;
}

/**
 * Capability rules for descriptors Elowen creates itself (custom OpenAI-compatible endpoints and
 * OAuth catalog additions). Built-in PI descriptors remain authoritative; these rules prevent the old
 * blanket "every model supports every effort" declaration for unknown/image models.
 *
 * The models.dev catalog decides whenever it knows the (provider, model) pair: which efforts an endpoint
 * accepts is per-endpoint data, not a property of the name — `glm-5.2` takes high/max on Z.AI but
 * high/xhigh through OpenRouter, and `gpt-5-pro` takes only `high`. A name heuristic cannot express that,
 * and over-advertising an effort the endpoint does not accept is a request-breaking 400. The family
 * regexes below remain the fallback for models the catalog has not published (a fresh release, a private
 * relay), and the conservative default still refuses to guess for an unknown id.
 */
export function descriptorCapabilities(provider: string, model: string): DescriptorPatch {
  if (NON_REASONING.test(model)) return { reasoning: false };

  // Codex OAuth is not a models.dev endpoint (its catalog is ChatGPT's own), so it keeps its own rule.
  if (provider !== 'openai-codex') {
    const catalog = catalogCapability(provider, model);
    if (catalog === false) return { reasoning: false };
    if (catalog !== undefined) {
      return {
        reasoning: true,
        // `true` means the model reasons but exposes no effort knob (a bare on/off toggle): every level is
        // unsupported, so no UI offers one and no request carries a `reasoning_effort` it would reject.
        thinkingLevelMap: ladderToMap(catalog === true ? [] : catalog),
        ...(OPENAI_REASONING.test(model) ? { labels: { xhigh: 'ultra' } } : {}),
      };
    }
  }

  if (provider === 'openai-codex' || OPENAI_REASONING.test(model)) {
    const supportsMax = /(?:^|\/)gpt-5\.6(?:-|$)/i.test(model);
    return {
      reasoning: true,
      // ChatGPT Codex accepts low/medium/high/xhigh; GPT-5.6 adds the distinct `max` level. `minimal`
      // is normalized to low by the upstream catalog. The UI calls xhigh "ultra" while PI retains its
      // stable canonical id internally, leaving the stronger 5.6 level visibly named "max".
      thinkingLevelMap: {
        off: null, minimal: 'low', low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh',
        max: supportsMax ? 'max' : null,
      },
      labels: { xhigh: 'ultra' },
      fast: provider === 'openai-codex',
    };
  }

  if (CLAUDE_REASONING.test(model)) {
    // Anthropic's 4.6 tier adds `max`; 4.7+ (and generation 5) additionally expose xhigh. Keep the
    // two distinct instead of assuming every model with max also accepts xhigh.
    const supportsMax = /-(?:4[.-][678]|5)(?:[.-]|$)/i.test(model);
    const supportsXhigh = /-(?:4[.-][78]|5)(?:[.-]|$)/i.test(model);
    return {
      reasoning: true,
      thinkingLevelMap: {
        off: null, minimal: 'minimal', low: 'low', medium: 'medium', high: 'high',
        xhigh: supportsXhigh ? 'xhigh' : null,
        max: supportsMax ? 'max' : null,
      },
    };
  }

  if (GEMINI_REASONING.test(model) || OTHER_REASONING.test(model)) {
    return {
      reasoning: true,
      thinkingLevelMap: { off: null, minimal: null, low: 'low', medium: 'medium', high: 'high', xhigh: null, max: null },
    };
  }

  // Unknown custom endpoints are conservative: advertising reasoning_effort to a plain chat model is a
  // request-breaking 400. Operators still get native metadata for every built-in OAuth model.
  return { reasoning: false };
}

/** Capability view when a custom endpoint advertised a model through `/models` but it has not been
 *  registered in PI's in-memory catalog. This keeps dynamically discovered known families useful while
 *  preserving the conservative non-reasoning result for an unknown id. */
export function inferredModelCapabilities(provider: string, model: string): ModelCapabilityView {
  const rule = descriptorCapabilities(provider, model);
  const levels = rule.reasoning
    ? CANONICAL_THINKING_LEVELS.filter((level) => {
        const mapped = rule.thinkingLevelMap?.[level];
        if (mapped === null) return false;
        return level === 'xhigh' || level === 'max' ? mapped !== undefined : true;
      })
    : [];
  return { reasoning: rule.reasoning, levels, labels: rule.labels ?? {}, fast: rule.fast === true };
}

/** Read-only capability view for a fully resolved model descriptor. */
export function modelCapabilities(model: Model<Api>): ModelCapabilityView {
  const inferred = inferredModelCapabilities(model.provider, model.id);
  const reasoning = !!model.reasoning;
  return {
    reasoning,
    levels: reasoning ? getSupportedThinkingLevels(model) : [],
    labels: inferred.labels,
    fast: model.provider === 'openai-codex' && model.api === 'openai-codex-responses' && !NON_REASONING.test(model.id),
  };
}

/** Accept provider-facing aliases without leaking them into PI's canonical session state. */
export function canonicalThinkingLevel(model: Model<Api>, value: string): string {
  const normalized = value.trim().toLowerCase();
  const caps = modelCapabilities(model);
  for (const level of caps.levels) {
    if ((caps.labels[level] ?? level).toLowerCase() === normalized) return level;
  }
  return normalized;
}
