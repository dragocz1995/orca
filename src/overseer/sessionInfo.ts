/** Structured identity of a live agent tmux session, derived from the daemon's own naming
 *  convention. The daemon owns how it names sessions, so classifying them here keeps the role a
 *  first-class fact the API exposes — clients never reverse-engineer meaning from the raw name. */
type SessionRole = 'overseer' | 'pilot' | 'agent' | 'advisor';

export interface SessionInfo {
  /** The tmux session id (`elowen-…`) — the stable handle for all session operations. */
  name: string;
  role: SessionRole;
  /** Friendly agent name (`Patricita`); empty for the overseer, which has no agent persona. */
  agent: string;
  /** The mission this overseer governs (role `overseer` only). */
  missionId?: string;
  /** The owning user (role `advisor` only) — `elowen-advisor-<userId>`. */
  userId?: number;
  /** The project this session runs in. Not derivable from the name — the `/sessions` route fills it
   *  from the agent store (which records every spawned agent's project), left undefined here. */
  projectId?: number;
}

const ELOWEN = 'elowen-';
const OVERSEER = 'overseer-';
const PILOT = 'pilot-';
const ADVISOR = 'advisor-';

/** Classify a live session name into its role + identity. Mirrors the spawn-time conventions:
 *  overseer → `elowen-overseer-<missionId>`, pilot → `elowen-pilot-<name>`, advisor → `elowen-advisor-<userId>`,
 *  worker → `elowen-<name>`. */
export function classifySession(name: string): SessionInfo {
  const bare = name.startsWith(ELOWEN) ? name.slice(ELOWEN.length) : name;
  if (bare.startsWith(OVERSEER)) return { name, role: 'overseer', agent: '', missionId: bare.slice(OVERSEER.length) };
  if (bare.startsWith(PILOT)) return { name, role: 'pilot', agent: bare.slice(PILOT.length) };
  if (bare.startsWith(ADVISOR)) {
    const userId = Number(bare.slice(ADVISOR.length));
    return { name, role: 'advisor', agent: '', userId: Number.isInteger(userId) ? userId : undefined };
  }
  return { name, role: 'agent', agent: bare };
}
