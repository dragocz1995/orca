import type { ConfigStore } from '../store/configStore.js';
import type { BrainProviderConfig } from './providers.js';

/** Derive the brain's provider config from Orca's existing config. Step #1 reuses the relay endpoint
 *  (autopilot.apiUrl + the shared apiKey + autopilot.model) as the OpenAI-compatible provider — one
 *  place configures that endpoint. Returns null when no usable provider is configured, so the daemon
 *  leaves the brain unwired (routes degrade to 503) instead of constructing a brain that can't run. */
export function brainConfigFromOrca(config: ConfigStore): BrainProviderConfig | null {
  const s = config.get();
  const apiKey = config.apiKey();
  if (!apiKey || !s.autopilot.apiUrl || !s.autopilot.model) return null;
  return {
    openai: { baseUrl: s.autopilot.apiUrl, apiKey, model: s.autopilot.model },
    default: 'openai',
  };
}
