import { createAdmin, isFirstRun, login } from '../setup.js';
import { PREFERRED_DEFAULT } from '../../brain/providers.js';
import { orcaExec } from '../../shared/execs.js';
import { apiJson } from './http.js';
import { API_KEY_PROVIDERS, OPENROUTER_BASE, RECOMMENDED_EMBEDDING_MODEL } from './constants.js';
import { deriveSlug, uniqueSlug } from './slug.js';
import { writeMarker } from './marker.js';
import { webBaseUrl } from '../installInfo.js';
import { getBrainProviders, keepProvider } from './steps/shared.js';
import type { BrainProviderType } from '../../store/configStore.js';
import type { WizardCtx } from './types.js';

/** Non-interactive `orca setup` — the same daemon-API onboarding as the wizard, driven entirely by flags /
 *  env instead of prompts. Lets agents and CI reach a working setup headlessly (and is how the whole flow
 *  is E2E-tested, since the modal TUI needs a real TTY). Prints a readiness matrix and exits non-zero on a
 *  hard failure (bad/missing required input), so a caller can branch on it. */
export async function runHeadlessSetup(base: string, env: NodeJS.ProcessEnv, args: string[]): Promise<void> {
  const o = parseFlags(args, env);
  const ctx: WizardCtx = { base, isTTY: false, debug: o.debug, fetchFn: fetch, answers: {} };

  // ── Account ──────────────────────────────────────────────────────────────────────────────────
  const first = await isFirstRun(fetch, base);
  if (first) {
    if (!o.adminPassword) return die('First run needs an admin password: --admin-password <pw> (or ORCA_ADMIN_PASSWORD).');
    try { ctx.token = await createAdmin(fetch, base, { username: o.adminUser, password: o.adminPassword }); }
    catch (e) { return die(`Creating the admin failed: ${msg(e)}`); }
    ctx.answers.account = { username: o.adminUser, created: true, signedIn: true };
    ok('account', `${o.adminUser} (created)`);
  } else if (o.adminPassword) {
    try { ctx.token = await login(fetch, base, { username: o.adminUser, password: o.adminPassword }); }
    catch (e) { return die(`Signing in failed: ${msg(e)}`); }
    ctx.answers.account = { username: o.adminUser, created: false, signedIn: true };
    ok('account', `${o.adminUser} (signed in)`);
  } else if (o.project || o.provider || o.memory !== 'skip') {
    // An admin already exists and we have config work to do, but no password to authenticate with.
    return die('An admin already exists — pass --admin-password to sign in for the remaining steps.');
  }

  // ── Project ──────────────────────────────────────────────────────────────────────────────────
  if (o.project) {
    const existing = (await apiJson<{ slug: string }[]>(ctx, 'GET', '/projects')).data ?? [];
    const slug = o.projectSlug || uniqueSlug(deriveSlug(o.project), new Set(existing.map((e) => e.slug)));
    const r = await apiJson(ctx, 'POST', '/projects', { slug, path: o.project, notes: '' });
    if (r.ok) { ctx.answers.project = { slug, path: o.project, connected: true }; ok('project', `${slug} → ${o.project}`); }
    else if (r.status === 409) ok('project', `already registered (${o.project})`);
    else warn('project', `couldn't register (${r.status}) — ${o.project}`);
  }

  // ── AI provider ──────────────────────────────────────────────────────────────────────────────
  let aiProviderId = '';
  let aiIsOpenAiKey = false;
  if (o.provider) {
    const preset = o.provider === 'custom' ? null : API_KEY_PROVIDERS.find((x) => x.key === o.provider);
    if (o.provider !== 'custom' && !preset) return die(`Unknown --provider "${o.provider}". Known: ${API_KEY_PROVIDERS.map((x) => x.key).join(', ')}, custom.`);
    const type: BrainProviderType = preset ? preset.type : 'openai';
    const baseUrl = preset ? preset.base : (o.baseUrl || '');
    const label = preset ? preset.label : 'Custom';
    if (!baseUrl) return die('A custom provider needs --base-url <https://…/v1>.');

    const model = await resolveModel(ctx, type, baseUrl, o.apiKey, o.model);
    if (model === null) return die('Could not determine a model — pass --model <id> (or --api-key so /models can be probed).');

    const providers = await getBrainProviders(ctx);
    const id = uniqueId(label, new Set(providers.map((x) => x.id)));
    const entry = { id, label, type, baseUrl, models: model ? [model] : [], ...(o.apiKey ? { apiKey: o.apiKey } : {}) };
    const kept = providers.filter((e) => e.id !== id).map(keepProvider);
    const saved = await apiJson(ctx, 'PUT', '/config', { brain: { providers: [...kept, entry] } });
    if (!saved.ok) return die(`Saving the provider failed (${saved.status}).`);
    aiProviderId = id;
    aiIsOpenAiKey = type === 'openai' && !!o.apiKey;
    ok('ai', `${label}${model ? ` (${model})` : ''}`);

    if (model) {
      const cur = (await apiJson<{ defaults?: Record<string, unknown> }>(ctx, 'GET', '/config')).data?.defaults ?? {};
      await apiJson(ctx, 'PUT', '/config', { defaults: { ...cur, exec: orcaExec(id, model) } });
      ok('tasks', `built-in engine → orca:${id}/${model}`);
    }
    if (aiIsOpenAiKey) await apiJson(ctx, 'PUT', '/config', { autopilot: { providerId: id, ...(model ? { model } : {}) } });
  }

  // ── Memory ───────────────────────────────────────────────────────────────────────────────────
  if (o.memory === 'reuse') {
    if (!aiIsOpenAiKey || !aiProviderId) warn('memory', 'reuse needs an OpenAI-type provider with a key — skipped.');
    else {
      const r = await apiJson(ctx, 'PUT', '/memory/embedding', { providerId: aiProviderId, model: o.embeddingModel, baseUrl: '' });
      r.ok ? ok('memory', `reuse ${aiProviderId} (${o.embeddingModel})`) : warn('memory', `couldn't save embedding config (${r.status})`);
    }
  } else if (o.memory === 'openrouter') {
    if (!o.memoryKey) warn('memory', 'openrouter needs --memory-key — skipped.');
    else {
      const providers = await getBrainProviders(ctx);
      const kept = providers.filter((e) => e.id !== 'openrouter').map(keepProvider);
      const saved = await apiJson(ctx, 'PUT', '/config', { brain: { providers: [...kept, { id: 'openrouter', label: 'OpenRouter', type: 'openai', baseUrl: OPENROUTER_BASE, models: [], apiKey: o.memoryKey }] } });
      const emb = saved.ok ? await apiJson(ctx, 'PUT', '/memory/embedding', { providerId: 'openrouter', model: o.embeddingModel, baseUrl: '' }) : saved;
      emb.ok ? ok('memory', `openrouter (${o.embeddingModel})`) : warn('memory', `couldn't configure OpenRouter embeddings (${emb.status})`);
    }
  }

  // ── Smoke test — proves the agent actually answers. A failure is surfaced AND makes the run exit
  //    non-zero (so a script/agent can branch), even though the config is still saved. ─────────────
  let chatFailed = false;
  if (o.provider && !o.skipTest) {
    const r = await apiJson<{ ok?: boolean; model?: string; error?: string }>(ctx, 'POST', '/brain/test', aiProviderId ? { providerId: aiProviderId } : {});
    if (r.data?.ok) ok('chat', `Orca answered (${r.data.model ?? '?'})`);
    else { chatFailed = true; warn('chat', `agent didn't answer: ${r.data?.error ?? `HTTP ${r.status}`}`); }
  }

  writeMarker(env, { completed: true, skipped: !o.provider, updatedAt: new Date().toISOString() });

  // ── Readiness matrix ───────────────────────────────────────────────────────────────────────────
  const checks = (await apiJson<{ checks?: { label: string; ok: boolean; detail: string; hint?: string }[] }>(ctx, 'GET', '/system/readiness')).data?.checks;
  if (checks?.length) {
    console.log('\nReadiness:');
    for (const c of checks) {
      console.log(`  [${c.ok ? 'ok' : '--'}] ${c.label} — ${c.detail}`);
      if (!c.ok && c.hint) console.log(`         ${c.hint}`);
    }
  }
  if (chatFailed) { console.error('\nSetup saved, but the agent did not answer — fix the provider / key / model above (or pass --model) and re-run.'); process.exit(1); }
  console.log(`\nSetup complete. Talk to Orca: orca chat   ·   Web UI: ${webBaseUrl()}`);
}

// ── flags ────────────────────────────────────────────────────────────────────────────────────────
export interface HeadlessOpts {
  debug: boolean;
  adminUser: string;
  adminPassword?: string;
  project?: string;
  projectSlug?: string;
  provider?: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  memory: 'reuse' | 'openrouter' | 'skip';
  memoryKey?: string;
  embeddingModel: string;
  skipTest: boolean;
}

export function parseFlags(args: string[], env: NodeJS.ProcessEnv): HeadlessOpts {
  const val = (name: string): string | undefined => { const i = args.indexOf(name); return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined; };
  const has = (name: string): boolean => args.includes(name);
  const memory = (val('--memory') ?? 'skip') as HeadlessOpts['memory'];
  return {
    debug: has('--debug'),
    adminUser: val('--admin-user') ?? env.ORCA_ADMIN_USER ?? 'admin',
    adminPassword: val('--admin-password') ?? env.ORCA_ADMIN_PASSWORD,
    project: has('--no-project') ? undefined : (val('--project') ?? process.cwd()),
    projectSlug: val('--project-slug'),
    provider: val('--provider'),
    apiKey: val('--api-key') ?? env.ORCA_API_KEY,
    baseUrl: val('--base-url'),
    model: val('--model'),
    memory: (['reuse', 'openrouter', 'skip'] as const).includes(memory) ? memory : 'skip',
    memoryKey: val('--memory-key') ?? env.ORCA_OPENROUTER_KEY,
    embeddingModel: val('--embedding-model') ?? RECOMMENDED_EMBEDDING_MODEL,
    skipTest: has('--skip-test'),
  };
}

/** Resolve the model: use `--model`, else probe /models for an openai endpoint with a key, else default
 *  Anthropic's flagship. Returns the model, '' (openai custom with no key/model — caller may still save
 *  keyless), or null (unresolvable → hard error). */
export async function resolveModel(ctx: WizardCtx, type: BrainProviderType, baseUrl: string, apiKey: string | undefined, model: string | undefined): Promise<string | null> {
  if (model) return model;
  if (type === 'anthropic') return PREFERRED_DEFAULT.anthropic ?? null;
  if (type === 'openai' && apiKey) {
    const probe = await apiJson<{ models?: string[] }>(ctx, 'POST', '/brain/providers/probe', { baseUrl, apiKey });
    return pickChatModel(probe.data?.models ?? []); // null when the endpoint returned nothing usable
  }
  return null; // openai without a key and without --model
}

/** Model families that are NOT chat/completions — never auto-pick these for the default chat model. */
const NON_CHAT_MODEL = /embed|whisper|tts|audio|speech|transcri|dall-?e|image|vision-ocr|moderation|rerank|guard|babbage|davinci|curie|\bada\b/i;

/** Pick a sensible default chat model from a probed list: the first that isn't an embedding / audio /
 *  image / legacy-completions model, else just the first (better a wrong guess the smoke-test catches
 *  than silently a non-chat model). Null on an empty list. */
function pickChatModel(models: string[]): string | null {
  if (!models.length) return null;
  return models.find((m) => !NON_CHAT_MODEL.test(m)) ?? models[0] ?? null;
}

function uniqueId(label: string, taken: Set<string>): string {
  return uniqueSlug(deriveSlug(label), taken);
}

function ok(step: string, detail: string): void { console.log(`  [ok] ${step}: ${detail}`); }
function warn(step: string, detail: string): void { console.log(`  [!!] ${step}: ${detail}`); }
function die(message: string): void { console.error(`Setup failed: ${message}`); process.exit(1); }
function msg(e: unknown): string { return e instanceof Error ? e.message : String(e); }
