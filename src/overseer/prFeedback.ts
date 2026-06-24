import type { MissionPrStore } from '../store/missionPrStore.js';
import type { MissionStore } from '../store/missionStore.js';
import type { MissionGit } from './missionGit.js';

export interface PrFeedbackDeps {
  prs: MissionPrStore;
  missions: MissionStore;
  missionGit: MissionGit;
  /** Re-engage a mission so the freshly-appended fix phase gets dispatched. Bound to engine.engage. */
  engage: (input: { epicId: string; autonomy: string; maxSessions: number }) => Promise<unknown>;
}

/**
 * Poll every mission with an open PR for new "changes requested" feedback. When a review appends a fix
 * phase, re-engage the mission so an agent applies the fix in the worktree (the next commit/push then
 * updates the PR). A merged/closed PR is dropped from the watch set by ingestReviews. Returns the
 * mission ids that were re-engaged. Cheap when there are no open PRs (the set is empty).
 */
export async function sweepPrFeedback(d: PrFeedbackDeps): Promise<string[]> {
  const reengaged: string[] = [];
  for (const rec of d.prs.withOpenPr()) {
    const res = await d.missionGit.ingestReviews(rec.mission_id);
    if (res.action !== 'fix-created') continue;
    const mission = d.missions.get(rec.mission_id);
    if (!mission) continue;
    await d.engage({ epicId: mission.epic_id, autonomy: mission.autonomy, maxSessions: mission.max_sessions });
    reengaged.push(rec.mission_id);
  }
  return reengaged;
}
