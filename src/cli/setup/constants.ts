import type { BrainProviderType } from '../../store/configStore.js';

/** OpenAI-compatible chat/embeddings base — includes the `/v1` version segment the openai client needs. */
const OPENAI_BASE = 'https://api.openai.com/v1';
/** Anthropic Messages API base — NO `/v1` (the anthropic-messages client appends its own path). */
const ANTHROPIC_BASE = 'https://api.anthropic.com';
/** OpenRouter's OpenAI-compatible base. */
export const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

/** Recommended embedding model — small, cheap, widely served on OpenAI-compatible endpoints. */
export const RECOMMENDED_EMBEDDING_MODEL = 'text-embedding-3-small';

/** API-key provider presets for the AI step: label + brain provider type + default base URL. */
export const API_KEY_PROVIDERS: { key: string; label: string; type: BrainProviderType; base: string }[] = [
  { key: 'openai', label: 'OpenAI', type: 'openai', base: OPENAI_BASE },
  { key: 'anthropic', label: 'Anthropic', type: 'anthropic', base: ANTHROPIC_BASE },
  { key: 'openrouter', label: 'OpenRouter', type: 'openai', base: OPENROUTER_BASE },
];

/** OAuth sign-in choices → the brain provider config `type` + the pi-ai built-in name (for the catalog). */
export const OAUTH_CHOICES: { type: BrainProviderType; label: string; builtin: string }[] = [
  { type: 'oauth-openai-codex', label: 'Sign in with Codex / OpenAI', builtin: 'openai-codex' },
  { type: 'oauth-anthropic', label: 'Sign in with Claude', builtin: 'anthropic' },
  { type: 'oauth-github-copilot', label: 'Sign in with GitHub Copilot', builtin: 'github-copilot' },
];
