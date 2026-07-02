import type { ConfigStore } from '../store/configStore.js';
import type { BrainRuntimeConfig } from './providers.js';

/** Derive the brain's provider set from Orca config. Dedicated `brain.providers` win; with none
 *  configured we fall back to the autopilot relay endpoint (autopilot.apiUrl + shared apiKey +
 *  autopilot.model) as a synthetic OpenAI-compatible provider, so a fresh install keeps working the
 *  moment the relay is set up. Returns null when nothing usable is configured — the daemon leaves the
 *  brain unwired (routes degrade to 503) instead of constructing a brain that can't run. */
export function brainConfigFromOrca(config: ConfigStore): BrainRuntimeConfig | null {
  const dedicated = config.brainProviders();
  if (dedicated.length > 0) return { providers: dedicated };
  const s = config.get();
  const apiKey = config.apiKey();
  if (!apiKey || !s.autopilot.apiUrl || !s.autopilot.model) return null;
  return {
    providers: [{
      id: 'relay', label: 'Relay', type: 'openai',
      baseUrl: s.autopilot.apiUrl, models: [s.autopilot.model], apiKey,
    }],
  };
}
