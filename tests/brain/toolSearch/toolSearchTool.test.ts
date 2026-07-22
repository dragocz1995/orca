import { describe, it, expect } from 'vitest';
import {
  resolveToolSearch,
  formatDeferredToolsBlock,
  createToolSearchHandle,
  toolSearchTool,
  type ToolActivationTarget,
} from '../../../src/brain/toolSearch/toolSearchTool.js';

const CANDIDATES = [
  { name: 'mcp__github__create_issue', description: 'Create a new GitHub issue in a repo' },
  { name: 'mcp__github__list_issues', description: 'List issues on a GitHub repository' },
  { name: 'mcp__slack__post_message', description: 'Send a message to a Slack channel' },
];

describe('resolveToolSearch', () => {
  it('select:<names> activates those exact tools, case-insensitively', () => {
    const got = resolveToolSearch('select:mcp__github__create_issue,mcp__slack__post_message', CANDIDATES, 5);
    expect(got).toEqual(['mcp__github__create_issue', 'mcp__slack__post_message']);
  });

  it('select: ignores names not in the deferred candidate set', () => {
    const got = resolveToolSearch('select:mcp__github__create_issue,mcp__nope__x', CANDIDATES, 5);
    expect(got).toEqual(['mcp__github__create_issue']);
  });

  it('keyword search ranks name-part hits above description-only hits', () => {
    const got = resolveToolSearch('github', CANDIDATES, 5);
    expect(got).toEqual(['mcp__github__create_issue', 'mcp__github__list_issues']);
  });

  it('keyword search matches on description too', () => {
    const got = resolveToolSearch('slack', CANDIDATES, 5);
    expect(got).toEqual(['mcp__slack__post_message']);
  });

  it('+term makes a term required (excludes tools that lack it, even if other terms match)', () => {
    // "+slack issue" requires slack: the github tools match "issue" but lack "slack" → excluded; only the
    // slack tool qualifies.
    expect(resolveToolSearch('+slack issue', CANDIDATES, 5)).toEqual(['mcp__slack__post_message']);
    // "+github create" requires github, ranks by create → the create tool first.
    expect(resolveToolSearch('+github create', CANDIDATES, 5)[0]).toBe('mcp__github__create_issue');
  });

  it('respects max_results', () => {
    expect(resolveToolSearch('github', CANDIDATES, 1)).toEqual(['mcp__github__create_issue']);
  });

  it('empty / non-matching query yields nothing', () => {
    expect(resolveToolSearch('   ', CANDIDATES, 5)).toEqual([]);
    expect(resolveToolSearch('zzzznomatch', CANDIDATES, 5)).toEqual([]);
  });
});

describe('formatDeferredToolsBlock', () => {
  it('lists deferred tools with trimmed descriptions', () => {
    const deferred = new Set(['mcp__github__create_issue']);
    const block = formatDeferredToolsBlock(CANDIDATES, deferred);
    expect(block).toContain('<available_tools_deferred>');
    expect(block).toContain('- mcp__github__create_issue: Create a new GitHub issue in a repo');
    // A non-deferred candidate is not listed.
    expect(block).not.toContain('mcp__slack__post_message');
  });

  it('is empty when nothing is deferred', () => {
    expect(formatDeferredToolsBlock(CANDIDATES, new Set())).toBe('');
  });
});

/** A fake activation target recording setActiveToolsByName calls. */
function fakeSession(active: string[]): ToolActivationTarget & { calls: string[][] } {
  const state = { active: [...active], calls: [] as string[][] };
  return {
    calls: state.calls,
    getAllTools: () => CANDIDATES,
    getActiveToolNames: () => state.active,
    setActiveToolsByName: (names) => { state.active = [...names]; state.calls.push(names); },
  };
}

async function run(tool: ReturnType<typeof toolSearchTool>, query: string) {
  return tool.execute('id', { query }, undefined, undefined, {} as never);
}

describe('toolSearchTool.execute', () => {
  it('activates matched tools and records them on the handle', async () => {
    const deferred = new Set(CANDIDATES.map((c) => c.name));
    const handle = createToolSearchHandle(deferred);
    handle.session = fakeSession(['Read', 'ToolSearch']);
    const res = await run(toolSearchTool(handle), 'github');
    expect(handle.activated.has('mcp__github__create_issue')).toBe(true);
    expect(handle.activated.has('mcp__github__list_issues')).toBe(true);
    // The active set now includes the fetched tools (union with what was active).
    const target = handle.session as ReturnType<typeof fakeSession>;
    expect(target.calls).toHaveLength(1);
    expect(target.calls[0]).toEqual(['Read', 'ToolSearch', 'mcp__github__create_issue', 'mcp__github__list_issues']);
    expect((res.details as { matched: string[] }).matched).toHaveLength(2);
  });

  it('is a clear no-op when nothing is deferred', async () => {
    const handle = createToolSearchHandle(new Set());
    handle.session = fakeSession(['Read']);
    const res = await run(toolSearchTool(handle), 'github');
    expect((handle.session as ReturnType<typeof fakeSession>).calls).toHaveLength(0);
    expect(res.content[0].text).toMatch(/no deferred tools/i);
  });

  it('reports when a query matches nothing without touching the active set', async () => {
    const deferred = new Set(CANDIDATES.map((c) => c.name));
    const handle = createToolSearchHandle(deferred);
    handle.session = fakeSession(['Read']);
    const res = await run(toolSearchTool(handle), 'zzzznomatch');
    expect((handle.session as ReturnType<typeof fakeSession>).calls).toHaveLength(0);
    expect(res.content[0].text).toMatch(/no deferred tools matched/i);
  });
});
