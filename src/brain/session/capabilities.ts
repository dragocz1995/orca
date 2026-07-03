import type { ToolDefinition } from '@earendil-works/pi-coding-agent';

/** What kind of session the tools are composed for — the explicit form of the security invariant that
 *  used to hide behind a `channel: !trusted` double negation. Every kind here is actually produced:
 *  `owner-chat` covers both the operator's own chat AND their trusted automation (cron turns resolve
 *  to it, since automation IS the operator). */
type SessionKind =
  /** The operator's own authenticated chat, or their owner-authored automation (cron) — full orca_*
   *  control-plane tools. */
  | 'owner-chat'
  /** A platform channel driven by OTHER people — the owner's full-scope orca_* API tools are
   *  withheld; only Policy-guarded plugin tools load. */
  | 'foreign-channel'
  /** An orca-exec task worker — its one control-plane tool (close-own-task) is baked in by the
   *  caller; plugin tools ride along, but never the owner's orca_* API tools. */
  | 'task-worker';

export interface CapabilitySpec {
  kind: SessionKind;
  /** Built lazily so the owner's API token is never even minted for sessions that must not have it. */
  orcaTools?: () => ToolDefinition[];
  /** The owner's PRIVATE long-term memory tools — composed ONLY for 'owner-chat'. NOTE: this kind gate
   *  is a narrowing, not the security boundary. A TRUSTED platform channel (admin-role sender) also
   *  maps to 'owner-chat' (owner-anchored + shared), so the REAL guard is the execute-time owner check
   *  inside each memory tool (currentIdentity().owner===true && platform==='orca'); a foreign/channel
   *  turn or a task-worker is refused there even though the tool was composed in. */
  memoryTools?: () => ToolDefinition[];
  pluginTools: ToolDefinition[];
  /** Per-role tool allowlist (tool names; '*' = everything). Undefined = no restriction. */
  toolFilter?: string[];
}

/** Compose the tool set for one session. THE security invariant lives here: `foreign-channel` and
 *  `task-worker` sessions NEVER receive the owner's orca_* control-plane tools — a foreign sender
 *  reaching the owner's full-scope API token would be a privilege escalation. */
export function composeSessionTools(spec: CapabilitySpec): ToolDefinition[] {
  const ownerChat = spec.kind === 'owner-chat';
  const orcaTools = ownerChat ? (spec.orcaTools?.() ?? []) : [];
  // Memory tools ride only owner-chat (like orca_*); the per-tool owner check still gates a trusted
  // channel that maps to owner-chat. The role toolFilter never applies here — it scopes plugin tools.
  const memoryTools = ownerChat ? (spec.memoryTools?.() ?? []) : [];
  let pluginTools = spec.pluginTools;
  if (spec.toolFilter && !spec.toolFilter.includes('*')) {
    const allow = new Set(spec.toolFilter);
    pluginTools = pluginTools.filter((t) => allow.has(t.name));
  }
  return [...orcaTools, ...memoryTools, ...pluginTools];
}
