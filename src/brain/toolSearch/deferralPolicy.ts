/** Deferred-tool policy: decide which of a session's registered tools are withheld from the system
 *  prompt (only their NAME is advertised; the full JSON schema is fetched on demand via the `ToolSearch`
 *  tool, which then activates them for the next turn).
 *
 *  The mechanism this feeds already exists in PI (a session's ACTIVE tool set is a by-name subset of its
 *  REGISTERED tools — `customTools` is the registry, `setActiveToolsByName` the active slice) and Elowen
 *  already drives it per turn for per-sender visibility (see `applyToolVisibility`). Deferral is one more
 *  slice on top: the initial active set omits the deferred names, and `ToolSearch` re-adds them as the
 *  model asks.
 *
 *  DELIBERATELY CONSERVATIVE. Withholding a tool trades a lighter prompt for (a) a broken prompt cache on
 *  the turn the active set changes and (b) one round-trip of latency before a fetched tool is callable.
 *  For Elowen's modest NATIVE toolset that trade is a net loss, so the ONLY tools ever deferred are
 *  bridged external MCP tools (`mcp__<server>__<tool>`), and only once there are enough of them to matter
 *  — a handful cost little and are not worth the cache churn. Below the threshold nothing is deferred and
 *  the session behaves byte-identically to before this module existed. */

/** Prefix every bridged external MCP tool carries (see the `mcp` plugin's `registerBridgedTool`). It is
 *  the sole deferral surface today: native and other plugin tools are never withheld. */
export const MCP_TOOL_PREFIX = 'mcp__';

/** Names/prefixes that must ALWAYS stay active regardless of any future widening of the deferral surface.
 *  `ToolSearch` itself is here because the model needs it in the prompt to fetch anything else; the rest
 *  are the hot-path core whose latency/cache cost of deferral would never be worth it. Matching is exact
 *  or `prefix*` (a trailing `*`). MCP tools never collide with these, so today this is belt-and-suspenders
 *  — it earns its keep only if the deferrable predicate is ever broadened past `mcp__*`. */
export const NEVER_DEFER: readonly string[] = [
  'ToolSearch',
  'Read', 'Edit', 'Write', 'Search', 'Grep', 'Glob', 'ListDir', 'FileInfo', 'GitStatus',
  'Bash', 'ListProcesses', 'ProcessOutput', 'KillProcess',
  'AskUserQuestion',
  'Elowen*', 'Memory*', 'Lsp*', 'Delegate*', 'Workflow*',
];

/** Default: below 11 deferrable tools, defer none. Chosen so a session with one or two small MCP servers
 *  stays untouched (their few tools cost little, and cache/latency churn would not pay for itself), while a
 *  large MCP surface — the case ToolSearch exists for — engages. */
export const DEFAULT_DEFER_THRESHOLD = 10;

export interface DeferralOptions {
  /** Global kill switch. `false` → nothing is ever deferred (the session behaves as before). Default true. */
  enabled?: boolean;
  /** Defer only once the count of deferrable tools EXCEEDS this. Default {@link DEFAULT_DEFER_THRESHOLD}. */
  threshold?: number;
}

/** True when `name` matches an exact entry or a `prefix*` entry of {@link NEVER_DEFER}. */
export function isNeverDeferred(name: string): boolean {
  for (const pattern of NEVER_DEFER) {
    if (pattern.endsWith('*')) {
      if (name.startsWith(pattern.slice(0, -1))) return true;
    } else if (name === pattern) {
      return true;
    }
  }
  return false;
}

/** A tool is deferrable when it is a bridged MCP tool and not pinned by {@link NEVER_DEFER}. */
export function isDeferrable(name: string): boolean {
  return name.startsWith(MCP_TOOL_PREFIX) && !isNeverDeferred(name);
}

/** The set of tool names to withhold from the initial active set for a session whose registry is `all`.
 *  Empty when disabled, or when the deferrable count is at/under the threshold (the common case) — an
 *  empty result means "change nothing", which callers rely on to keep the prompt cache warm. */
export function computeDeferredToolNames(
  all: readonly { name: string }[],
  opts: DeferralOptions = {},
): Set<string> {
  if (opts.enabled === false) return new Set();
  const threshold = opts.threshold ?? DEFAULT_DEFER_THRESHOLD;
  const deferrable = all.map((t) => t.name).filter(isDeferrable);
  if (deferrable.length <= threshold) return new Set();
  return new Set(deferrable);
}
