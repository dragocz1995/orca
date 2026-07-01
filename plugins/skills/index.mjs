// Bundled reference plugin: exposes markdown skills to the brain. Hand-written ESM (no build step) so
// it doubles as the canonical example of the plugin format. It reads .md skills from its own `skills/`
// directory using pi's loader, and registers each so the brain's system prompt advertises them.
import { loadSkillsFromDir } from '@earendil-works/pi-coding-agent';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export function register(ctx) {
  const here = dirname(fileURLToPath(import.meta.url));
  const { skills } = loadSkillsFromDir({ dir: join(here, 'skills'), source: 'orca-plugin:skills' });
  for (const skill of skills) ctx.registerSkill(skill);
  ctx.logger.info(`registered ${skills.length} skill(s)`);
}
