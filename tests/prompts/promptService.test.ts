import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from '../../src/store/db.js';
import { UserPromptStore } from '../../src/store/userPromptStore.js';
import { PromptService } from '../../src/prompts/promptService.js';
import { rawTemplate } from '../../src/prompts/index.js';

let prompts: PromptService;
let store: UserPromptStore;

beforeEach(() => {
  store = new UserPromptStore(openDb(':memory:'));
  prompts = new PromptService(store);
});

describe('PromptService.render', () => {
  it('ships a structured autonomous owner-chat contract without losing dynamic placeholders', () => {
    const template = rawTemplate('advisor');
    const requiredSections = [
      'identity',
      'relationship_and_communication',
      'elowen_control_plane',
      'operating_model',
      'autonomous_delivery_loop',
      'engineering_standard',
      'technology_policy',
      'scope_and_foresight',
      'authority_and_safety',
      'verification_and_definition_of_done',
      'working_with_the_user',
    ];

    expect(template.startsWith('<elowen_advisor>')).toBe(true);
    expect(template.endsWith('</elowen_advisor>')).toBe(true);
    for (const section of requiredSections) {
      expect(template).toContain(`<${section}>`);
      expect(template).toContain(`</${section}>`);
    }
    for (const placeholder of ['{{agentName}}', '{{userName}}', '{{personality}}']) {
      expect(template.split(placeholder)).toHaveLength(2);
    }
    const openTags: string[] = [];
    for (const match of template.matchAll(/<\/?([a-z][a-z0-9_]*)\b[^>]*>/g)) {
      if (match[0].startsWith('</')) expect(openTags.pop()).toBe(match[1]);
      else if (!match[0].endsWith('/>')) openTags.push(match[1]!);
    }
    expect(openTags).toEqual([]);
    expect(template).toContain('root cause');
    expect(template).toContain('maintained, stable, secure');
    expect(template).toContain('AGENTS.md');
    expect(template).not.toContain('Do exactly what was asked — no more, no less');

    const rendered = prompts.render('advisor', {
      agentName: 'Elowen',
      userName: 'Alice',
      personality: 'Communicate as a pragmatic senior engineer.',
    }, 1);
    expect(rendered).toContain('<name>Elowen</name>');
    expect(rendered).toContain('<user>Alice</user>');
    expect(rendered).toContain('<communication_style>Communicate as a pragmatic senior engineer.</communication_style>');
    expect(rendered).not.toMatch(/\{\{(?:agentName|userName|personality)\}\}/);
  });

  it('uses the file default when the user has no override', () => {
    expect(prompts.render('advisor', { userName: 'Alice' }, 1)).toBe(rawTemplate('advisor').replaceAll('{{userName}}', 'Alice'));
  });

  it('uses the file default when no userId is given', () => {
    store.set(1, 'advisor', 'CUSTOM {{userName}}');
    expect(prompts.render('advisor', { userName: 'Bob' })).toContain('<elowen_advisor>'); // default advisor text, not CUSTOM
  });

  it("uses the user's override and substitutes vars", () => {
    store.set(1, 'worker', 'Hello {{agentName}}, do {{taskId}}.');
    expect(prompts.render('worker', { agentName: 'a1', taskId: 't9' }, 1)).toBe('Hello a1, do t9.');
  });

  it('isolates overrides per user', () => {
    store.set(1, 'worker', 'USER ONE');
    expect(prompts.render('worker', {}, 2)).toBe(rawTemplate('worker'));
  });

  it('renders nested CLI prompt templates', () => {
    expect(prompts.render('cli/plan-mode', {}, 1)).toContain('<proposed_plan>');
    store.set(1, 'cli/plan-mode', 'CUSTOM PLAN MODE');
    expect(prompts.render('cli/plan-mode', {}, 1)).toBe('CUSTOM PLAN MODE');
  });

  it('ignores an override for a non-editable template name', () => {
    store.set(1, 'planner-fallback', 'SHOULD NOT WIN');
    expect(prompts.render('planner-fallback', {}, 1)).toBe(rawTemplate('planner-fallback'));
  });

  it('appends (never replaces) the advisor override — the system identity stays intact', () => {
    store.set(1, 'advisor', 'Always answer in Czech for {{userName}}.');
    const out = prompts.render('advisor', { userName: 'Filip' }, 1);
    expect(out.startsWith(rawTemplate('advisor').replaceAll('{{userName}}', 'Filip'))).toBe(true);
    expect(out).toContain('<user_preferences source="account">');
    expect(out).toContain('Always answer in Czech for Filip.');
    expect(out.endsWith('</user_preferences>')).toBe(true);
  });

  it('does not change the shared-channel override envelope', () => {
    store.set(1, 'advisor-channel', 'Keep channel replies brief.');
    const out = prompts.render('advisor-channel', {}, 1);
    expect(out).toContain('## User preferences (added by the user)');
    expect(out).not.toContain('<user_preferences');
    expect(out).toContain('Keep channel replies brief.');
  });
});
