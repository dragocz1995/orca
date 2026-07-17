import { describe, it, expect } from 'vitest';
import { AuthStorage } from '@earendil-works/pi-coding-agent';
import { registerKimiOAuth } from '../../src/brain/providers.js';

/**
 * The cold-boot contract, and why this lives in a file of its own.
 *
 * PI's OAuth registry is a MODULE-GLOBAL map. It seeds itself with Anthropic/Copilot/Codex at import time,
 * so those are loginable the instant the daemon boots; Kimi only exists once we register it. Nothing on the
 * sign-in path builds a ModelRegistry — `/brain/oauth/:type/start` goes straight to `AuthStorage.login` —
 * and on a fresh install with no provider configured nothing else builds one either. So the very first
 * "Sign in with Kimi" is precisely the one that breaks without `registerKimiOAuth` at bootstrap.
 *
 * Because that map is global, ANY test that calls `buildBrainRegistry` registers Kimi for the rest of the
 * process — which is exactly how the first version of this test passed while a cold daemon was broken.
 * Vitest isolates module state per file, so keeping this file free of `buildBrainRegistry` is what gives
 * the assertion its meaning. Do not add one here.
 */
describe('Kimi OAuth registration on a cold process', () => {
  it('makes Kimi loginable without any registry having been built', () => {
    const auth = AuthStorage.inMemory();
    // Precondition: PI does not ship Kimi as a built-in. If this ever fails, PI adopted it upstream and
    // registerKimiOAuth (and probably registerKimiCatalog's whole reason to exist) should be revisited.
    expect(auth.getOAuthProviders().map((p) => p.id)).not.toContain('kimi-coding');

    registerKimiOAuth(auth);

    const kimi = auth.getOAuthProviders().find((p) => p.id === 'kimi-coding');
    expect(kimi?.name).toBe('Kimi');
    // The built-ins must survive registration rather than being replaced by it.
    expect(auth.getOAuthProviders().map((p) => p.id)).toEqual(
      expect.arrayContaining(['anthropic', 'github-copilot', 'openai-codex', 'kimi-coding']),
    );
  });

  it('registers process-wide, so a later AuthStorage sees it too', () => {
    // The daemon builds one AuthStorage at bootstrap, but the credential lookup that matters can run
    // against another instance; the global map is what ties them together.
    registerKimiOAuth(AuthStorage.inMemory());
    expect(AuthStorage.inMemory().getOAuthProviders().map((p) => p.id)).toContain('kimi-coding');
  });
});
