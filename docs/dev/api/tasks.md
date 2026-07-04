# Tasks

Routes: `src/api/routes/tasks.ts`, schemas: `src/api/schemas/tasks.ts`

## `GET /tasks`

List tasks scoped to the caller's accessible projects. Optional `?project_id=N` filter.

## `POST /tasks`

Create a task. Validates `exec` against global and personal allow-lists. Optional `id` (auto-generated from project basename if omitted), `deps` array.

## `GET /tasks/ready`

List tasks whose dependencies are all satisfied (ready to start).

## `GET /tasks/deps`

List all dependency edges.

## `GET /tasks/:id/usage`

Token/cost usage for a task's agent run. Reads from the CLI's session storage.

## `GET /usage/by-model`

Aggregate token/cost usage per model (exec spec). Optional `?project_id=N` and `?from=&to=` ISO-8601 window.

## `POST /usage/reset`

Reset all usage snapshots. Admin-only, irreversible.

## `GET /tasks/:id/conversation`

Embedded-brain worker conversation transcript. Empty for CLI-run tasks.

## `PATCH /tasks/:id`

Update a task. Agent-scoped tokens may only set `status`, `result_summary`, `outcome` (close only). Human tokens can edit exec, title, type, priority, description, deps, parent, scheduled_at, autostart.

## `GET /tasks/:id/changed/diff`

Diff of one file from a task's frozen change list. Query param: `?path=`.

## `GET /tasks/:id/commits`

Commit history for a task (`git log base..head`).

## `GET /tasks/:id/commit/:hash/diff`

Single-commit diff for one file. Query param: `?path=`.

## `POST /tasks/:id/approve-gate`

Human approval of an escalated phase. Releases blocked dependents and resumes a stalled mission.

## `POST /tasks/:id/ask`

An agent posts a free-text question for the autopilot. Returns an ask ID for long-polling. Max 200 asks per task.

## `GET /tasks/:id/ask/:askId`

Long-poll an ask's reply. Returns `{}` every ~25s if unanswered. Optional `?timeoutMs=` (max 30s).

## `POST /tasks/:id/ask/:askId/reply`

Human reply to an agent's question. Resolves the pending exchange.

## `GET /asks/pending`

All asks currently parked on a human. Enriched with task title + epic. Not in the agent allow-list.

## `GET /tasks/:id/guide`

The context-aware control guide an agent fetches with `orca help`. Agent-allow-listed.

## `GET /tasks/:id/deps`

Dependency edges for one task.

## `DELETE /tasks/:id`

Delete a task. With `?subtree=1`, deletes the whole mission (epic + children + deps + notes + events).

## `POST /admin/cleanup`

Wipe all operational data (tasks, missions, events, agents). Stops all live sessions. Admin-only, irreversible.

## `POST /tasks/plan`

Plan a mission. Supports manual phases (`phases` array) or autopilot decomposition (LLM relay or agent Pilot). Options: `goal`, `name`, `exec`, `project_id`, `engage`, `autonomy`, `maxSessions`, `prEnabled`, `dryRun`, `autoModel`, `prompt`.

## `GET /plan/:jobId`

Poll a plan job's status. Agent tokens bypass project access (the job ID is the capability).

## `POST /plan/:jobId/submit`

Submit parsed phases for an async plan job (Pilot agent backend).

## `POST /tasks/:epicId/phases`

Insert phases into an existing epic. Manual (`phases` array) or LLM replan (`goal`). Triggers an active mission tick.