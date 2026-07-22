import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { Type, type TSchema } from 'typebox';

/** The `reason` feature in one place: the model authors a short status note as the FIRST argument of a
 *  tool call; while the call streams/runs the CLI shows it live next to the spinner (superseding the canned
 *  composeLabel), then it is stripped before the real handler ever sees it. This module owns the three
 *  seams — schema augmentation, argument stripping, and extraction from a streaming partial call — so the
 *  logic never scatters across the brain. The CLI-side label precedence lives in composeLabels.ts. */

const MCP_PREFIX = 'mcp__';

/** Kept short on purpose: it rides EVERY augmented tool schema (prompt-cache cost), so the full rule —
 *  user's language, present tense, always for long tools — lives once in the system prompt (elowen.md). */
export const REASON_DESC =
  "A short present-tense status note IN THE USER'S LANGUAGE saying what this call does (e.g. 'Čtu "
  + "konfiguraci'). Write it FIRST; it is shown live next to the spinner and is not part of your answer.";

/** The optional-string property prepended to each tool's input schema. */
const REASON_PROP = Type.Optional(Type.String({ description: REASON_DESC }));

/** Tools that never carry a `reason`: `ToolSearch` is a quick fetch (nothing to narrate), and `mcp__*`
 *  schemas are externally owned/bridged — reconstructing them risks dropping `$defs`/nested nuance, so they
 *  are left untouched. Everything else (native Elowen, Memory and plugin tools) is augmented. */
export function isReasonExcluded(name: string): boolean {
  return name === 'ToolSearch' || name.startsWith(MCP_PREFIX);
}

/** Prepend an optional `reason` string to a tool's OBJECT input schema so the model may author it first.
 *  Rebuilt via `Type.Object` (not a spread) so the TypeBox `[Kind]` symbol is set correctly; the existing
 *  properties keep their own optionality, so `required` is reproduced faithfully. Non-object schemas and
 *  excluded tools pass through untouched. */
export function withReason(tool: ToolDefinition): ToolDefinition {
  if (isReasonExcluded(tool.name)) return tool;
  const params = tool.parameters as { type?: unknown; properties?: Record<string, TSchema>; additionalProperties?: boolean | TSchema } | undefined;
  if (!params || params.type !== 'object' || !params.properties) return tool;
  const opts = params.additionalProperties !== undefined ? { additionalProperties: params.additionalProperties } : undefined;
  const parameters = Type.Object({ reason: REASON_PROP, ...params.properties }, opts);
  return { ...tool, parameters } as ToolDefinition;
}

/** Wrap a tool's `execute` so `reason` is removed from the arguments before the real handler runs — the
 *  model's rationale is a UI hint, never an argument any tool understands. Clones (never mutates) PI's args
 *  object, so the reason still persists in the stored call. Applied to EVERY tool as defense-in-depth,
 *  including excluded ones that never advertise it. */
export function stripReason(tool: ToolDefinition): ToolDefinition {
  if (typeof tool.execute !== 'function') return tool;
  const run = tool.execute.bind(tool);
  const execute = (async (...args: Parameters<ToolDefinition['execute']>) => {
    const params = args[1];
    if (params && typeof params === 'object' && 'reason' in params) {
      const { reason: _reason, ...rest } = params as Record<string, unknown>;
      args[1] = rest as typeof args[1];
    }
    return run(...args);
  }) as ToolDefinition['execute'];
  return { ...tool, execute };
}

/** The model-authored `reason` on a streaming tool call's partial arguments, when present and non-empty.
 *  Validated as unknown→string at this boundary — partial JSON can hold anything mid-stream. */
export function extractReason(args: unknown): string | undefined {
  if (!args || typeof args !== 'object') return undefined;
  const r = (args as { reason?: unknown }).reason;
  return typeof r === 'string' && r.trim() ? r : undefined;
}
