#!/usr/bin/env node
/**
 * Regenerate `src/brain/modelCapabilityData.ts` from the models.dev catalog.
 *
 *   node scripts/refresh-model-capabilities.mjs                # fetch https://models.dev/api.json
 *   node scripts/refresh-model-capabilities.mjs path/to/api.json   # or read a local snapshot
 *
 * WHY a generated table: which reasoning efforts a model accepts is per (provider, model) data, not a
 * property of the model name. The same id is graded low/medium/high on one relay, high/max on another, and
 * a plain toggle on a third — so a name regex cannot be right, and guessing wrong sends an unsupported
 * `reasoning_effort` that the endpoint rejects with a 400. Only endpoints Elowen can actually address are
 * emitted, keeping the table small enough to read in a diff.
 */
import { writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

const CATALOG_URL = 'https://models.dev/api.json';
const OUT = new URL('../src/brain/modelCapabilityData.ts', import.meta.url);

/** models.dev provider keys for the endpoints Elowen ships (src/cli/setup/constants.ts) plus the OAuth
 *  built-ins. Ollama Cloud is published as `ollama-cloud`; the rest match our own keys 1:1. */
const PROVIDERS = [
  'openai', 'anthropic', 'google', 'openrouter', 'xai', 'deepseek', 'groq', 'mistral', 'cerebras',
  'perplexity', 'deepinfra', 'zai', 'nvidia', 'huggingface', 'baseten', 'ollama-cloud', 'github-copilot',
];

/** Elowen's canonical effort vocabulary (CANONICAL_THINKING_LEVELS minus `off`, which is a separate
 *  toggle rather than an effort). models.dev's `none` maps onto that toggle and is dropped here. */
const CANONICAL = new Set(['minimal', 'low', 'medium', 'high', 'xhigh', 'max']);

const source = process.argv[2];
const catalog = source
  ? JSON.parse(await readFile(source, 'utf8'))
  : await fetch(CATALOG_URL).then((r) => {
      if (!r.ok) throw new Error(`models.dev responded ${r.status}`);
      return r.json();
    });

const entries = [];
for (const provider of PROVIDERS) {
  const models = catalog[provider]?.models;
  if (!models) {
    console.warn(`warn: provider "${provider}" is absent from the catalog`);
    continue;
  }
  for (const [id, model] of Object.entries(models).sort(([a], [b]) => a.localeCompare(b))) {
    if (!model.reasoning) { entries.push([`${provider}/${id}`, 'false']); continue; }
    const effort = (model.reasoning_options ?? []).find((option) => option.type === 'effort');
    const levels = (effort?.values ?? []).filter((value) => CANONICAL.has(value));
    // Reasoning with no graded effort (a bare on/off toggle) is `true`: the model thinks, but its effort
    // is not a settable knob — offering levels for it would advertise a parameter the endpoint rejects.
    entries.push([`${provider}/${id}`, levels.length ? `[${levels.map((l) => `'${l}'`).join(', ')}]` : 'true']);
  }
}

const body = entries.map(([key, value]) => `  '${key}': ${value},`).join('\n');
const reasoning = entries.filter(([, value]) => value !== 'false').length;

writeFileSync(OUT, `/* GENERATED FILE — DO NOT EDIT BY HAND.
 * Source: models.dev (${CATALOG_URL}); regenerate with \`npm run models:refresh\`.
 *
 * Which reasoning efforts an endpoint accepts, keyed \`<catalog-provider>/<model-id>\`. The value is the
 * accepted effort ladder, \`true\` for a model that reasons but exposes no effort knob (a bare toggle), or
 * \`false\` for one that does not reason at all. Consumed by descriptorCapabilities() in
 * modelCapabilities.ts, which is the only reader — a miss there falls back to name heuristics.
 *
 * ${entries.length} models, ${reasoning} of them reasoning-capable.
 */
import type { ModelThinkingLevel } from '@earendil-works/pi-ai';

/** Accepted effort ladder, \`true\` (reasons, effort not settable), or \`false\` (no reasoning). */
export type CatalogCapability = readonly ModelThinkingLevel[] | boolean;

export const MODEL_CAPABILITY_CATALOG: Readonly<Record<string, CatalogCapability>> = {
${body}
};
`);

console.log(`wrote ${entries.length} models (${reasoning} reasoning-capable) to src/brain/modelCapabilityData.ts`);
