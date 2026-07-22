import { defineTool } from '@earendil-works/pi-coding-agent';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

/** The minimal live-session surface the tool needs to read the registry and change the active slice —
 *  typed structurally (a subset of both PI's `AgentSession` and `ExtensionAPI`) so the search/activation
 *  logic stays unit-testable without a real session. */
export interface ToolActivationTarget {
  getAllTools(): { name: string; description?: string }[];
  getActiveToolNames(): string[];
  setActiveToolsByName(names: string[]): void;
}

/** Per-session state shared between the composition path, the `ToolSearch` tool and `applyToolVisibility`.
 *  Created host-side at spawn (with the computed `deferred` set), then given its live `session` reference
 *  once PI has built it. `activated` accumulates the deferred tools the model has fetched so far, so every
 *  subsequent turn's visibility pass keeps them advertised. */
export interface ToolSearchHandle {
  /** Registered-tool names withheld from the initial active set (empty when deferral is inert). */
  readonly deferred: Set<string>;
  /** Deferred tools the model has already fetched via ToolSearch — re-added to the active set each turn. */
  readonly activated: Set<string>;
  /** The live PI session, wired once created; undefined until then (the tool reports a clear error). */
  session?: ToolActivationTarget;
}

/** Create a fresh handle for a session whose deferral policy withholds `deferred`. */
export function createToolSearchHandle(deferred: Set<string>): ToolSearchHandle {
  return { deferred, activated: new Set(), session: undefined };
}

const DEFAULT_MAX_RESULTS = 5;
const MAX_MAX_RESULTS = 25;

/** Split a bridged MCP tool name (`mcp__server__tool`) into lowercase search parts. Double and single
 *  underscores both separate — a server or tool fragment may itself contain `_`. */
function nameParts(name: string): string[] {
  return name
    .replace(/^mcp__/, '')
    .split(/__+/)
    .flatMap((seg) => seg.split('_'))
    .map((p) => p.toLowerCase())
    .filter(Boolean);
}

interface Candidate { name: string; description: string }

/** Score one candidate against the query terms. Exact name-part hit weighs most, then partial name-part,
 *  then a description substring — the same ordering Claude Code's ToolSearch uses, trimmed to what we need. */
function scoreCandidate(cand: Candidate, terms: string[]): number {
  const parts = nameParts(cand.name);
  const desc = cand.description.toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (parts.includes(term)) score += 10;
    else if (parts.some((p) => p.includes(term))) score += 5;
    if (desc.includes(term)) score += 2;
  }
  return score;
}

/** Result of resolving a query against the deferred set: the tool names to activate. Pure — no side
 *  effects — so it is unit-testable in isolation from the session. */
export function resolveToolSearch(
  query: string,
  candidates: readonly Candidate[],
  maxResults: number,
): string[] {
  const trimmed = query.trim();

  // `select:A,B,C` — activate these exact deferred tools by name (case-insensitive).
  const select = /^select:(.+)$/i.exec(trimmed);
  if (select) {
    const wanted = (select[1] ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    return candidates.filter((c) => wanted.includes(c.name.toLowerCase())).map((c) => c.name);
  }

  const rawTerms = trimmed.toLowerCase().split(/\s+/).filter(Boolean);
  if (rawTerms.length === 0) return [];
  // `+term` marks a term as REQUIRED: a candidate must match it (in name parts or description) to qualify.
  const required = rawTerms.filter((t) => t.startsWith('+') && t.length > 1).map((t) => t.slice(1));
  const scoringTerms = rawTerms.map((t) => (t.startsWith('+') && t.length > 1 ? t.slice(1) : t));

  const eligible = candidates.filter((c) => {
    if (required.length === 0) return true;
    const parts = nameParts(c.name);
    const desc = c.description.toLowerCase();
    return required.every((term) => parts.some((p) => p.includes(term)) || desc.includes(term));
  });

  return eligible
    .map((c) => ({ name: c.name, score: scoreCandidate(c, scoringTerms) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults)
    .map((s) => s.name);
}

/** The `<available_tools_deferred>` awareness block appended to the system prompt: one line per deferred
 *  tool (name + trimmed description) so the model learns what it can fetch via ToolSearch WITHOUT carrying
 *  the full parameter schemas. Stable for the life of a session (the bridged MCP set does not change
 *  mid-session), so it is prompt-cache friendly. Returns '' when nothing is deferred. */
export function formatDeferredToolsBlock(
  all: readonly { name: string; description?: string }[],
  deferred: Set<string>,
): string {
  const lines = all
    .filter((t) => deferred.has(t.name))
    .map((t) => {
      const desc = (t.description ?? '').replace(/\s+/g, ' ').trim().slice(0, 140);
      return `- ${t.name}${desc ? `: ${desc}` : ''}`;
    });
  if (lines.length === 0) return '';
  return [
    '<available_tools_deferred>',
    'These tools exist in this session but are advertised by NAME ONLY to keep the prompt light — their full',
    'parameter schema is withheld until you fetch it. To call one, first run ToolSearch (e.g.',
    'ToolSearch({"query":"select:<name>"}) or a keyword query); it becomes callable on your next turn.',
    ...lines,
    '</available_tools_deferred>',
  ].join('\n');
}

const ok = (text: string, details: Record<string, unknown> = {}) => ({ content: [{ type: 'text' as const, text }], details });

/** The `ToolSearch` tool. Always active in the prompt; it fetches full schemas for deferred tools and
 *  activates them for the next turn via the handle's live session. Modelled on Claude Code's ToolSearch:
 *  `select:` for direct pick, keywords for search, `+term` for a required term. */
export function toolSearchTool(handle: ToolSearchHandle): ToolDefinition {
  return defineTool({
    name: 'ToolSearch',
    label: 'Search tools',
    description: [
      'Fetch and activate deferred tools so you can call them. Some tools (bridged external MCP tools)',
      'are advertised by NAME ONLY in a <available_tools_deferred> block — their full parameter schema is',
      'withheld until you fetch it here, and until then they cannot be invoked. Give a query; matching',
      'tools become callable ON YOUR NEXT TURN (their schemas are added to the prompt).',
      'Query forms: "select:mcp__github__create_issue,mcp__github__list_issues" fetches those exact tools;',
      '"github issue" keyword-searches names and descriptions; "+github create" requires "github" and ranks',
      'by "create". If nothing is deferred this tool is a no-op.',
    ].join(' '),
    parameters: Type.Object({
      query: Type.String({ description: 'Keywords, or "select:<name>[,<name>...]" for an exact fetch, or "+term" to require a term.' }),
      max_results: Type.Optional(Type.Number({ description: `Max tools to activate (default ${DEFAULT_MAX_RESULTS}, capped at ${MAX_MAX_RESULTS}).` })),
    }),
    execute: async (_id, p: { query: string; max_results?: number }) => {
      const session = handle.session;
      if (!session) return ok('ToolSearch is not available in this session.');
      if (handle.deferred.size === 0) {
        return ok('No deferred tools in this session — every tool is already active and callable directly.');
      }
      const max = Math.max(1, Math.min(MAX_MAX_RESULTS, Math.floor(p.max_results ?? DEFAULT_MAX_RESULTS)));
      // Only deferred tools are searchable — an already-active tool needs no fetch.
      const candidates: Candidate[] = session.getAllTools()
        .filter((t) => handle.deferred.has(t.name))
        .map((t) => ({ name: t.name, description: t.description ?? '' }));
      const matched = resolveToolSearch(p.query, candidates, max);
      if (matched.length === 0) {
        return ok(`No deferred tools matched "${p.query}". ${handle.deferred.size} tool(s) are deferred; try different keywords or "select:<exact-name>".`, { matched: [] });
      }
      // Record for future turns and activate now (union with the current active set). Effect lands next
      // turn (PI rebuilds the prompt on the boundary); the per-turn visibility pass keeps them advertised.
      for (const name of matched) handle.activated.add(name);
      const active = new Set(session.getActiveToolNames());
      for (const name of matched) active.add(name);
      session.setActiveToolsByName([...active]);
      return ok(`Activated ${matched.length} tool(s): ${matched.join(', ')}. They are callable on your next turn.`, { matched });
    },
  });
}
