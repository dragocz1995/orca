import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ElowenApp, RouteContext } from '../../context.js';
import type { PluginRoutesShared } from './shared.js';

/** ── Skills (skills plugin): bundled .md skills ship inside the plugin folder, user skills live in
 *  the plugin's writable data dir (where the CreateSkill tool writes). Managed one file per skill;
 *  a successful write/delete hot-reloads the plugins so new conversations pick the change up. ── */
export function registerSkillRoutes(app: ElowenApp, ctx: RouteContext, shared: PluginRoutesShared): void {
  const { d } = ctx;
  const { notAdmin } = shared;

  const SKILL_NAME_RE = /^[a-z0-9][a-z0-9-]{1,63}$/; // mirrors NAME_RE in plugins/skills/index.mjs
  const userSkillsDir = (): string | null => (d.pluginDataRoot ? join(d.pluginDataRoot, 'skills') : null);
  // The loader only ever loads the FIRST `skills` plugin folder across the scan roots — mirror that.
  const bundledSkillsDir = (): string | null => {
    for (const dir of d.pluginDirs ?? []) {
      const pluginDir = join(dir, 'skills');
      if (existsSync(pluginDir)) return join(pluginDir, 'skills');
    }
    return null;
  };
  // Same cheap frontmatter probe the plugin's ListSkills tool uses — full YAML parsing is overkill
  // for one known single-line field.
  const skillDescription = (file: string): string => {
    try { return /description:\s*(.+)/.exec(readFileSync(file, 'utf-8').slice(0, 400))?.[1]?.trim() ?? ''; }
    catch { return ''; }
  };
  // PI's `disable-model-invocation: true` frontmatter flag: the skill is excluded from progressive
  // disclosure (not advertised to the model) but still invocable explicitly via `/skill:name`.
  const skillDisableModelInvocation = (file: string): boolean => {
    try { return /^disable-model-invocation:\s*true\b/im.test(readFileSync(file, 'utf-8').slice(0, 400)); }
    catch { return false; }
  };
  // Render the skill .md file body — frontmatter (with the optional flag) followed by the content.
  const buildSkillBody = (name: string, description: string, content: string, disableModelInvocation: boolean): string => {
    const fm = [`name: ${name}`, `description: ${description.replaceAll('\n', ' ')}`];
    if (disableModelInvocation) fm.push('disable-model-invocation: true');
    return `---\n${fm.join('\n')}\n---\n\n${content}\n`;
  };
  // Parse an existing user skill back into its editable parts, so a PATCH can update just one field.
  const readSkillFile = (file: string): { description: string; content: string; disableModelInvocation: boolean } => {
    const raw = readFileSync(file, 'utf-8');
    const m = /^---\n([\s\S]*?)\n---\n?/.exec(raw);
    const front = m?.[1] ?? '';
    const body = (m ? raw.slice(m[0].length) : raw).replace(/^\n+/, '').replace(/\n+$/, '');
    return {
      description: /description:\s*(.+)/.exec(front)?.[1]?.trim() ?? '',
      content: body,
      disableModelInvocation: /^disable-model-invocation:\s*true\b/im.test(front),
    };
  };

  app.get('/plugins/skills/list', (c) => {
    if (notAdmin(c)) return c.json({ error: 'forbidden' }, 403);
    const out: { name: string; description: string; source: 'bundled' | 'user'; scope: string; location: string; active: boolean; canDelete: boolean; disableModelInvocation: boolean; content?: string; missingRequirement?: string }[] = [];
    for (const { dir, source } of [
      { dir: bundledSkillsDir(), source: 'bundled' as const },
      { dir: userSkillsDir(), source: 'user' as const },
    ]) {
      if (!dir || !existsSync(dir)) continue;
      for (const f of readdirSync(dir).filter((f) => f.endsWith('.md'))) {
        const file = join(dir, f);
        // User skills carry their body so the web editor can prefill an edit; bundled skills are
        // read-only, so their (larger) content is left off the list payload.
        const parsed = source === 'user' ? readSkillFile(file) : null;
        out.push({
          name: f.replace(/\.md$/, ''),
          description: parsed?.description ?? skillDescription(file),
          source,
          scope: source === 'bundled' ? 'bundled/system' : 'user-defined',
          location: file,
          active: d.config.get().plugins.enabled.includes('skills'),
          canDelete: source === 'user',
          disableModelInvocation: parsed?.disableModelInvocation ?? skillDisableModelInvocation(file),
          ...(parsed ? { content: parsed.content } : {}),
        });
      }
    }
    return c.json(out);
  });

  // Create (or overwrite) a user skill — the same file format the plugin's CreateSkill tool writes.
  // A name shadowing a bundled skill is refused: the plugin registers both copies and the duplicate
  // would silently fight over the system prompt.
  app.post('/plugins/skills', async (c) => {
    if (notAdmin(c)) return c.json({ error: 'forbidden' }, 403);
    const userDir = userSkillsDir();
    if (!userDir) return c.json({ error: 'plugin data dir unavailable' }, 503);
    const b = (await c.req.json().catch(() => null)) as { name?: unknown; description?: unknown; content?: unknown; disableModelInvocation?: unknown } | null;
    const name = typeof b?.name === 'string' ? b.name.trim() : '';
    const description = typeof b?.description === 'string' ? b.description.trim() : '';
    const content = typeof b?.content === 'string' ? b.content : '';
    const disableModelInvocation = b?.disableModelInvocation === true;
    if (!SKILL_NAME_RE.test(name)) return c.json({ error: 'name must be kebab-case (a-z, 0-9, dashes), max 64 chars' }, 400);
    if (description === '' || content.trim() === '') return c.json({ error: 'description and content must be non-empty' }, 400);
    const bundled = bundledSkillsDir();
    if (bundled && existsSync(join(bundled, `${name}.md`))) return c.json({ error: `a bundled skill named "${name}" already exists` }, 400);
    mkdirSync(userDir, { recursive: true });
    writeFileSync(join(userDir, `${name}.md`), buildSkillBody(name, description, content, disableModelInvocation), 'utf-8');
    await d.brain?.reloadPlugins(); // skills feed the brain's system prompt — apply live
    return c.json({ ok: true }, 201);
  });

  // Edit a user skill (bundled skills are read-only). Partial: any of description/content/the
  // disable-model-invocation flag may be omitted to keep its current value. The flag toggle lets an
  // operator hide a skill from progressive disclosure while leaving `/skill:name` invocation intact.
  app.patch('/plugins/skills/:name', async (c) => {
    if (notAdmin(c)) return c.json({ error: 'forbidden' }, 403);
    const name = c.req.param('name');
    if (!SKILL_NAME_RE.test(name)) return c.json({ error: 'invalid skill name' }, 400);
    const bundled = bundledSkillsDir();
    if (bundled && existsSync(join(bundled, `${name}.md`))) return c.json({ error: 'bundled skills cannot be edited' }, 400);
    const userDir = userSkillsDir();
    const file = userDir ? join(userDir, `${name}.md`) : null;
    if (!file || !existsSync(file)) return c.json({ error: 'unknown skill' }, 404);
    const b = (await c.req.json().catch(() => null)) as { description?: unknown; content?: unknown; disableModelInvocation?: unknown } | null;
    const cur = readSkillFile(file);
    const description = typeof b?.description === 'string' ? b.description.trim() : cur.description;
    const content = typeof b?.content === 'string' ? b.content : cur.content;
    const disableModelInvocation = typeof b?.disableModelInvocation === 'boolean' ? b.disableModelInvocation : cur.disableModelInvocation;
    if (description === '' || content.trim() === '') return c.json({ error: 'description and content must be non-empty' }, 400);
    writeFileSync(file, buildSkillBody(name, description, content, disableModelInvocation), 'utf-8');
    await d.brain?.reloadPlugins();
    return c.json({ ok: true });
  });

  app.delete('/plugins/skills/:name', async (c) => {
    if (notAdmin(c)) return c.json({ error: 'forbidden' }, 403);
    const name = c.req.param('name');
    if (!SKILL_NAME_RE.test(name)) return c.json({ error: 'invalid skill name' }, 400);
    const bundled = bundledSkillsDir();
    if (bundled && existsSync(join(bundled, `${name}.md`))) return c.json({ error: 'bundled skills cannot be deleted' }, 400);
    const userDir = userSkillsDir();
    const file = userDir ? join(userDir, `${name}.md`) : null;
    if (!file || !existsSync(file)) return c.json({ error: 'unknown skill' }, 404);
    unlinkSync(file);
    await d.brain?.reloadPlugins();
    return c.json({ ok: true });
  });
}
