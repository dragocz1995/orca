import { compact } from '@earendil-works/pi-coding-agent';
import type { ExtensionAPI, ModelRegistry } from '@earendil-works/pi-coding-agent';
import type { Api, Model } from '@earendil-works/pi-ai';

interface CodexCompactionFallbackOptions {
  model: Model<Api>;
  /** Distinct same-provider default resolved from the live BrainRuntimeConfig before PI is created. */
  fallbackModel?: Model<Api>;
  registry: Pick<ModelRegistry, 'getApiKeyAndHeaders'>;
  preparation: Parameters<typeof compact>[0];
  customInstructions?: string;
  signal?: AbortSignal;
  /** Current PI session effort, read at compaction time so live reasoning changes stay intact. */
  thinkingLevel?: Parameters<typeof compact>[6];
  compactFn?: typeof compact;
}

const errorText = (error: unknown): string => error instanceof Error ? error.message : String(error);

async function runCompaction(
  o: CodexCompactionFallbackOptions,
  model: Model<Api>,
): Promise<Awaited<ReturnType<typeof compact>>> {
  const auth = await o.registry.getApiKeyAndHeaders(model);
  if (!auth.ok) throw new Error(auth.error);
  if (!auth.apiKey) throw new Error(`No API key for provider: ${model.provider}`);
  return (o.compactFn ?? compact)(
    o.preparation, model, auth.apiKey, auth.headers, o.customInstructions, o.signal,
    o.thinkingLevel, undefined, auth.env,
  );
}

/** ChatGPT can occasionally resolve a public Codex model to an internal deployment slug that is no
 * longer registered for standalone summary requests. Keep the chosen model for normal chat and try it
 * first for compaction; only the provider's explicit Model-not-found response retries the exact same PI
 * compaction through the already-resolved configured provider default. Other failures remain visible. */
export async function compactCodexWithModelFallback(
  o: CodexCompactionFallbackOptions,
): Promise<Awaited<ReturnType<typeof compact>>> {
  try {
    return await runCompaction(o, o.model);
  } catch (error) {
    if (!/\bmodel not found\b/i.test(errorText(error))) throw error;
    const fallback = o.fallbackModel;
    if (!fallback || fallback.provider !== o.model.provider || fallback.id === o.model.id) {
      throw new Error(
        `Compaction model '${o.model.provider}/${o.model.id}' is unavailable and no distinct configured fallback model is available`,
        { cause: error },
      );
    }
    try {
      return await runCompaction(o, fallback);
    } catch (fallbackError) {
      throw new Error(`Codex compaction fallback failed after ${errorText(error)}: ${errorText(fallbackError)}`, { cause: fallbackError });
    }
  }
}

/** Inline PI extension used only for Codex models. Returning a CompactionResult keeps PI's own cut-point,
 * persistence and overflow-retry lifecycle intact; the captured fallback is a route decision made from
 * live config, while `ctx.model` remains authoritative after every resume/model-switch respawn. */
export function codexCompactionModelFallback(
  fallbackModel?: Model<Api>,
  thinkingLevel?: () => Parameters<typeof compact>[6],
): (pi: ExtensionAPI) => void {
  return (pi) => {
    pi.on('session_before_compact', async (event, ctx) => {
      const model = ctx.model;
      if (!model || model.provider !== 'openai-codex') return undefined;
      const compaction = await compactCodexWithModelFallback({
        model, fallbackModel, registry: ctx.modelRegistry, preparation: event.preparation,
        customInstructions: event.customInstructions, signal: event.signal,
        thinkingLevel: thinkingLevel?.(),
      });
      return { compaction };
    });
  };
}
