import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  computeDeferredToolNames,
  isDeferrable,
  isNeverDeferred,
  MCP_TOOL_PREFIX,
  DEFAULT_DEFER_THRESHOLD,
} from '../../../src/brain/toolSearch/deferralPolicy.js';
import { builtinToolMetas, BUILTIN_TOOL_PLAN_SAFE } from '../../../src/brain/tools/index.js';

/** N bridged MCP tools named mcp__srv__tool_<i>. */
const mcpTools = (n: number, server = 'srv') =>
  Array.from({ length: n }, (_, i) => ({ name: `mcp__${server}__tool_${i}` }));

const NATIVE = [
  { name: 'Read' }, { name: 'Edit' }, { name: 'Bash' }, { name: 'ElowenCreateTask' },
  { name: 'MemorySearch' }, { name: 'Delegate' }, { name: 'ToolSearch' },
];

describe('isNeverDeferred', () => {
  it('pins ToolSearch and hot-path core by exact name', () => {
    expect(isNeverDeferred('ToolSearch')).toBe(true);
    expect(isNeverDeferred('Read')).toBe(true);
    expect(isNeverDeferred('Bash')).toBe(true);
  });
  it('pins built-in families by prefix', () => {
    expect(isNeverDeferred('ElowenCreateTask')).toBe(true);
    expect(isNeverDeferred('MemorySearch')).toBe(true);
    expect(isNeverDeferred('DelegateStatus')).toBe(true);
  });
  it('does not pin an arbitrary MCP tool', () => {
    expect(isNeverDeferred('mcp__github__create_issue')).toBe(false);
  });
});

describe('isDeferrable', () => {
  it('only bridged MCP tools are deferrable', () => {
    expect(isDeferrable('mcp__github__create_issue')).toBe(true);
    expect(isDeferrable('Read')).toBe(false);
    expect(isDeferrable('DiscordApi')).toBe(false); // a plugin tool, but not mcp__
  });
});

describe('computeDeferredToolNames', () => {
  it('defers nothing when MCP tools are at/under the threshold', () => {
    const all = [...NATIVE, ...mcpTools(DEFAULT_DEFER_THRESHOLD)];
    expect(computeDeferredToolNames(all).size).toBe(0);
  });

  it('defers every MCP tool once the count EXCEEDS the threshold', () => {
    const mcp = mcpTools(DEFAULT_DEFER_THRESHOLD + 1);
    const deferred = computeDeferredToolNames([...NATIVE, ...mcp]);
    expect(deferred.size).toBe(mcp.length);
    for (const t of mcp) expect(deferred.has(t.name)).toBe(true);
  });

  it('never defers native/plugin tools, even alongside a large MCP surface', () => {
    const deferred = computeDeferredToolNames([...NATIVE, ...mcpTools(30)]);
    for (const t of NATIVE) expect(deferred.has(t.name)).toBe(false);
  });

  it('disabled → defers nothing regardless of count', () => {
    const all = [...NATIVE, ...mcpTools(50)];
    expect(computeDeferredToolNames(all, { enabled: false }).size).toBe(0);
  });

  it('honours a custom threshold', () => {
    const all = [...NATIVE, ...mcpTools(5)];
    expect(computeDeferredToolNames(all, { threshold: 3 }).size).toBe(5);
    expect(computeDeferredToolNames(all, { threshold: 5 }).size).toBe(0);
  });
});

describe('deferral safety invariants', () => {
  it('every built-in brain tool is pinned by NEVER_DEFER (a new built-in cannot be silently deferred)', () => {
    for (const { name } of builtinToolMetas()) {
      expect(isNeverDeferred(name)).toBe(true);
    }
  });

  it('ToolSearch is deliberately NOT plan-safe (deferred MCP tools stay unreachable while planning)', () => {
    expect(BUILTIN_TOOL_PLAN_SAFE).not.toContain('ToolSearch');
  });

  it('MCP_TOOL_PREFIX still matches the mcp plugin\'s bridged-tool naming (SSOT guard)', () => {
    // The plugin lives outside the TS graph, so the prefix cannot be imported — assert the literal it
    // builds names with instead. A drift here would silently stop ToolSearch from deferring MCP tools.
    const src = readFileSync(join(__dirname, '../../../plugins/mcp/index.mjs'), 'utf-8');
    expect(MCP_TOOL_PREFIX).toBe('mcp__');
    expect(src).toContain('`mcp__${sanitize(serverName)}__${sanitize(tool.name)}`');
  });
});
