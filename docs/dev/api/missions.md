# Missions

Routes: `src/api/routes/missions.ts`, schemas: `src/api/schemas/missions.ts`

## `GET /missions`

List live missions + disengaged missions with pending PRs. Scoped to the caller's accessible projects. Each mission includes PR metadata.

## `GET /missions/:id`

Mission detail with phase breakdown. Project-gated.

## `GET /missions/:id/changed-files`

Aggregate per-file churn summary across all phases. Sorted by total churn desc.

## `POST /missions`

Engage a mission. Body: `{ epicId, autonomy?, maxSessions? }`.

## `PATCH /missions/:id`

Mission actions. Body: `{ action: 'pause' | 'resume' }`.

## `DELETE /missions/:id`

Disengage a mission (stop agents, clean up).

## `POST /missions/:id/pr`

Manually open a PR for a PR-native mission. Returns the PR URL on success.

## `POST /missions/:id/merge-pr`

Squash-merge the PR. Returns 422 with a reason if the PR is not mergeable.

## `GET /missions/:id/overseer/next`

Long-poll for the next overseer decision. Blocks until a decision is needed or heartbeat. Optional `?timeoutMs=` (max 30s). Project-gated by the mission's epic.

## `POST /missions/:id/overseer/decide`

Submit an overseer verdict. Body: `{ id, approve, confidence, rationale, choice?, message?, restart? }`. Project-gated.