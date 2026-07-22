import { describe, it, expect } from 'vitest';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { initialActiveToolNames } from '../../../src/brain/session/factory.js';

const tool = (name: string) => ({ name } as ToolDefinition);
const REG = ['Read', 'ToolSearch', 'mcp__gh__a', 'mcp__gh__b'].map(tool);

describe('initialActiveToolNames (factory active/registry split)', () => {
  it('drops deferred names from the active slice but the registry (input) is untouched', () => {
    const active = initialActiveToolNames(REG, new Set(['mcp__gh__a', 'mcp__gh__b']));
    expect(active).toEqual(['Read', 'ToolSearch']);
    // Caller still passes the FULL list as customTools; this only computes the active subset.
    expect(REG.map((t) => t.name)).toEqual(['Read', 'ToolSearch', 'mcp__gh__a', 'mcp__gh__b']);
  });

  it('no deferral (undefined) → every tool starts active, byte-identical order', () => {
    expect(initialActiveToolNames(REG, undefined)).toEqual(['Read', 'ToolSearch', 'mcp__gh__a', 'mcp__gh__b']);
  });

  it('an empty deferred set → every tool active (the common case stays unchanged)', () => {
    expect(initialActiveToolNames(REG, new Set())).toEqual(['Read', 'ToolSearch', 'mcp__gh__a', 'mcp__gh__b']);
  });
});
