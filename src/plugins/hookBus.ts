import type { PluginHook, PluginHookName } from './api.js';

/** Minimal logger surface the bus needs — a warn sink for isolated hook failures. */
export interface HookBusLogger { warn(msg: string): void }

interface HookBusDeps {
  /** Every hook registered across all plugins (the flat `PluginRegistry.hooks` list). */
  hooks: PluginHook[];
  /** Where isolated hook failures (throws + timeouts) are reported. Optional — silent when absent. */
  logger?: HookBusLogger;
  /** Per-hook wall-clock budget in ms; a hook that outruns it is skipped. Default 2000. */
  timeoutMs?: number;
}

/** A typed, OBSERVATIONAL dispatcher for plugin lifecycle hooks.
 *
 *  Policy (v1, fail-open): every hook for a name runs concurrently; each is bounded by a per-hook
 *  timeout. A hook that throws or times out is logged via `logger.warn` and SKIPPED — it can never
 *  reject `emit()` nor block its siblings. Hooks observe/annotate only; they are NOT wired into the
 *  brain hot path in this phase. Invocation points get added later against `pluginProvider.get()`. */
export class PluginHookBus {
  private readonly hooks: PluginHook[];
  private readonly logger?: HookBusLogger;
  private readonly timeoutMs: number;

  constructor(deps: HookBusDeps) {
    this.hooks = deps.hooks;
    this.logger = deps.logger;
    this.timeoutMs = deps.timeoutMs ?? 2000;
  }

  /** All hooks subscribed to a given lifecycle point (introspection for the runtime endpoint). */
  listFor(name: PluginHookName): PluginHook[] {
    return this.hooks.filter((h) => h.name === name);
  }

  /** Fire every hook registered for `name` with `payload`, concurrently and fail-open. Always resolves;
   *  a throwing or hanging hook is warned about and skipped, never propagated. */
  async emit(name: PluginHookName, payload: unknown): Promise<void> {
    const matching = this.listFor(name);
    if (matching.length === 0) return;
    await Promise.allSettled(matching.map((hook) => this.runOne(name, hook, payload)));
  }

  /** Run a single hook under a timeout. Resolves either way — a rejection/timeout is turned into a
   *  logged warning so `Promise.allSettled` in `emit` never sees a meaningful failure. */
  private runOne(name: PluginHookName, hook: PluginHook, payload: unknown): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        this.logger?.warn(`hook "${name}" timed out after ${this.timeoutMs}ms (skipped)`);
        resolve();
      }, this.timeoutMs);
    });
    const invoke = (async () => {
      try {
        await hook.run(payload);
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        this.logger?.warn(`hook "${name}" threw (skipped): ${detail}`);
      }
    })();
    return Promise.race([invoke, timeout]).finally(() => {
      if (timer !== undefined) clearTimeout(timer);
    });
  }
}
