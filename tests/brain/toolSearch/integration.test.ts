import { describe, it, expect } from 'vitest';
import { Type } from 'typebox';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { composeSessionTools, applyToolVisibility, type ToolVisibilityTarget } from '../../../src/brain/session/capabilities.js';
import { computeDeferredToolNames } from '../../../src/brain/toolSearch/deferralPolicy.js';
import { createToolSearchHandle, toolSearchTool } from '../../../src/brain/toolSearch/toolSearchTool.js';

/** A minimal but real ToolDefinition (execute is a fn, so both composition gates wrap it). */
const stub = (name: string, description = name): ToolDefinition => ({
  name,
  label: name,
  description,
  parameters: Type.Object({}),
  execute: async () => ({ content: [{ type: 'text' as const, text: 'ok' }], details: {} }),
});

/** A fake PI session backed by the composed tool list — mirrors what the factory wires onto the handle. */
function sessionFrom(composed: ToolDefinition[], activeNames: string[]): ToolVisibilityTarget & { calls: string[][] } {
  const state = { active: [...activeNames], calls: [] as string[][] };
  return {
    calls: state.calls,
    getAllTools: () => composed.map((t) => ({ name: t.name, description: t.description })),
    getActiveToolNames: () => state.active,
    setActiveToolsByName: (names: string[]) => { state.active = [...names]; state.calls.push(names); },
  };
}

/** End-to-end through the REAL composition path: policy → compose → factory active-split → ToolSearch
 *  execute → per-turn visibility. This is the "payload" check — real tool-name lists, not mocks. */
describe('tool-search end to end (real composition path)', () => {
  // 12 bridged MCP tools (above the default threshold of 10) + the native/plugin core.
  const mcp = Array.from({ length: 12 }, (_, i) => stub(`mcp__github__op_${i}`, `GitHub operation ${i}`));
  const nativeCore = [stub('Read'), stub('Edit'), stub('Bash'), stub('DiscordApi')];
  const pluginTools = [...nativeCore, ...mcp];

  it('withholds the MCP tools from the initial active set but keeps them in the registry', () => {
    const deferred = computeDeferredToolNames(pluginTools);
    expect(deferred.size).toBe(12);

    const handle = createToolSearchHandle(deferred);
    const composed = composeSessionTools({
      kind: 'owner-chat',
      toolSearch: () => [toolSearchTool(handle)],
      pluginTools,
    });

    // Registry (customTools) holds everything, including ToolSearch and all MCP tools.
    const registry = composed.map((t) => t.name);
    expect(registry).toContain('ToolSearch');
    for (const t of mcp) expect(registry).toContain(t.name);

    // Factory active-split: the INITIAL active slice drops the deferred names.
    const initialActive = registry.filter((n) => !handle.deferred.has(n));
    expect(initialActive).toContain('ToolSearch');
    expect(initialActive).toContain('Read');
    for (const t of mcp) expect(initialActive).not.toContain(t.name);

    // Wire the session (as the factory does) and drive ToolSearch to fetch two MCP tools.
    handle.session = sessionFrom(composed, initialActive);
    const search = composed.find((t) => t.name === 'ToolSearch')!;
    return search.execute('id', { query: 'select:mcp__github__op_3,mcp__github__op_7' }, undefined, undefined, {} as never)
      .then(() => {
        expect(handle.activated.has('mcp__github__op_3')).toBe(true);
        expect(handle.activated.has('mcp__github__op_7')).toBe(true);
        // The next turn's visibility pass keeps the two fetched tools advertised and the other ten hidden.
        applyToolVisibility(handle.session as ToolVisibilityTarget, new Set(pluginTools.map((t) => t.name)), undefined, handle);
        const active = (handle.session as ReturnType<typeof sessionFrom>);
        const finalActive = active.getActiveToolNames();
        expect(finalActive).toContain('mcp__github__op_3');
        expect(finalActive).toContain('mcp__github__op_7');
        expect(finalActive).not.toContain('mcp__github__op_0');
        expect(finalActive).not.toContain('mcp__github__op_5');
        expect(finalActive).toContain('Read');
        expect(finalActive).toContain('ToolSearch');
      });
  });

  it('below the threshold nothing is deferred and no ToolSearch tool is composed', () => {
    const few = [...nativeCore, ...Array.from({ length: 4 }, (_, i) => stub(`mcp__x__op_${i}`))];
    const deferred = computeDeferredToolNames(few);
    expect(deferred.size).toBe(0);
    // The spawner only composes ToolSearch when deferred.size > 0, so here it is absent.
    const composed = composeSessionTools({ kind: 'owner-chat', toolSearch: undefined, pluginTools: few });
    expect(composed.map((t) => t.name)).not.toContain('ToolSearch');
  });
});
