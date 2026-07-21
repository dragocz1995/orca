import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { loadAgentRegistry, parseAgentFile, NAME_RE as AGENT_NAME_RE } from '../../../brain/agents/agentRegistry.js';
import { builtinToolMetas } from '../../../brain/tools/index.js';
import { promptsPath } from '../../../prompts/index.js';
import { stringify as stringifyYaml } from 'yaml';
import type { ElowenApp, RouteContext } from '../../context.js';
import type { PluginRoutesShared } from './shared.js';

/** ── Sub-agents (subagent plugin): typed sub-agents are one `.md` each (frontmatter name/description/
 *  tools + a body prompt). Built-in explore/plan ship in dist/prompts/agents and are read-only; user
 *  agents live next to the DB in <config>/agents and can be created/edited/deleted here. A write or
 *  delete hot-reloads the plugins, so the sub-agent catalog refreshes for new conversations. ── */
export function registerAgentRoutes(app: ElowenApp, ctx: RouteContext, shared: PluginRoutesShared): void {
  const { d } = ctx;
  const { notAdmin } = shared;

  // User agents sit beside plugins-data under the config dir (both hang off dirname(dbPath) — see bootstrap).
  const userAgentsDir = (): string | null => (d.pluginDataRoot ? join(dirname(d.pluginDataRoot), 'agents') : null);
  const builtinAgentsDir = (): string => promptsPath('agents');
  const isBuiltinAgent = (name: string): boolean => existsSync(join(builtinAgentsDir(), `${name}.md`));
  // Normalize the tools spec: a preset keyword, or an explicit tool-name list.
  const agentToolsValue = (tools: unknown): string | string[] => {
    if (Array.isArray(tools)) return tools.map((t) => String(t).trim()).filter(Boolean);
    const v = typeof tools === 'string' ? tools.trim() : '';
    return v || 'inherit';
  };
  // Serialize the frontmatter via the YAML library, NOT string interpolation — a description containing a
  // colon-space or a leading '#' (both common) would otherwise produce invalid YAML that parseAgentFile
  // rejects, blocking a legitimate save with a misleading error.
  const buildAgentBody = (name: string, description: string, tools: unknown, body: string): string => {
    const frontmatter = stringifyYaml({ name, description: description.replaceAll('\n', ' '), tools: agentToolsValue(tools) }).trimEnd();
    return `---\n${frontmatter}\n---\n\n${body.trim()}\n`;
  };

  app.get('/plugins/agents/list', (c) => {
    if (notAdmin(c)) return c.json({ error: 'forbidden' }, 403);
    const reg = loadAgentRegistry({ builtinDir: builtinAgentsDir(), userDir: userAgentsDir() ?? undefined });
    // A user file body is returned so the editor can prefill; built-in bodies are read-only, so they are
    // left off the payload (and kept smaller).
    const out = [...reg.values()].map((a) => ({
      name: a.name,
      description: a.description,
      tools: a.toolsSpec,
      source: a.source,
      canDelete: a.source === 'user',
      ...(a.source === 'user' ? { body: a.body } : {}),
    }));
    return c.json(out);
  });

  // Create or overwrite a user sub-agent. A name shadowing a built-in is refused (built-ins are
  // read-only); the composed file is validated with the real registry parser before it is written, so an
  // invalid tools spec / frontmatter never lands on disk.
  app.put('/plugins/agents/:name', async (c) => {
    if (notAdmin(c)) return c.json({ error: 'forbidden' }, 403);
    const name = c.req.param('name');
    if (!AGENT_NAME_RE.test(name)) return c.json({ error: 'name must be kebab-case (a-z, 0-9, dashes), max 64 chars' }, 400);
    if (isBuiltinAgent(name)) return c.json({ error: `a built-in agent named "${name}" already exists and is read-only` }, 400);
    const userDir = userAgentsDir();
    if (!userDir) return c.json({ error: 'agents dir unavailable' }, 503);
    const b = (await c.req.json().catch(() => null)) as { description?: unknown; tools?: unknown; body?: unknown } | null;
    const description = typeof b?.description === 'string' ? b.description.trim() : '';
    const body = typeof b?.body === 'string' ? b.body : '';
    if (description === '' || body.trim() === '') return c.json({ error: 'description and body must be non-empty' }, 400);
    // Bound both fields so a single agent file cannot be grown without limit (the description rides the
    // sub-agent catalog in every delegate tool description; the body becomes the child's system prompt).
    if (description.length > 4096) return c.json({ error: 'description must be at most 4096 characters' }, 400);
    if (body.length > 65536) return c.json({ error: 'body must be at most 65536 characters' }, 400);
    // An explicit tool list must name tools that actually exist — an unknown name is not a narrower
    // toolset, it silently no-ops at delegation-time intersection and leaves the child unable to act.
    // Validate against the LIVE toolset: the native brain tools (Elowen*/Memory*) plus every plugin tool
    // in the merged registry. Preset keywords (read-only/all/inherit) arrive as a string, not an array,
    // and are validated by parseAgentFile below instead.
    const toolsRaw = b?.tools;
    if (Array.isArray(toolsRaw)) {
      const registry = await d.plugins?.get();
      const known = new Set<string>([
        ...builtinToolMetas().map((m) => m.name),
        ...(registry?.tools.map((t) => t.name) ?? []),
      ]);
      const requested = toolsRaw.map((t) => String(t).trim()).filter(Boolean);
      const unknownTools = requested.filter((toolName) => !known.has(toolName));
      if (unknownTools.length) return c.json({ error: `unknown tool(s): ${unknownTools.join(', ')}` }, 400);
    }
    const composed = buildAgentBody(name, description, b?.tools, body);
    if (!parseAgentFile(composed, 'user', join(userDir, `${name}.md`))) {
      return c.json({ error: 'invalid agent definition — check the tools value (read-only / all / inherit or a tool list) and the body' }, 400);
    }
    mkdirSync(userDir, { recursive: true });
    writeFileSync(join(userDir, `${name}.md`), composed, 'utf-8');
    await d.brain?.reloadPlugins();
    return c.json({ ok: true }, 201);
  });

  app.delete('/plugins/agents/:name', async (c) => {
    if (notAdmin(c)) return c.json({ error: 'forbidden' }, 403);
    const name = c.req.param('name');
    if (!AGENT_NAME_RE.test(name)) return c.json({ error: 'invalid agent name' }, 400);
    if (isBuiltinAgent(name)) return c.json({ error: 'built-in agents cannot be deleted' }, 400);
    const userDir = userAgentsDir();
    const file = userDir ? join(userDir, `${name}.md`) : null;
    if (!file || !existsSync(file)) return c.json({ error: 'unknown agent' }, 404);
    unlinkSync(file);
    await d.brain?.reloadPlugins();
    return c.json({ ok: true });
  });
}
