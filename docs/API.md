# API Reference

The Orca daemon exposes a REST API. All endpoints return JSON. CORS is enabled for the web frontend.

**Base URL:** `http://localhost:4400`

---

## Authentication & access control

### Auth header

Every route except `GET /health` and `POST /auth/login` requires authentication:

```
Authorization: Bearer <token>
```

SSE endpoints accept the token as a query parameter (EventSource does not support custom headers):

```
GET /events?token=<token>
```

### Executor validation

Config has a global `allowedExecs` list. If an `exec` string is passed on any request, it must be in
that list or the request is rejected with `400 { "error": "exec not allowed" }`.

Additionally, a **per-user allowlist** may be configured (admin-owned). When a non-admin user has a
non-empty `allowed_execs`, they may only use exec strings from that list. Violations return
`403 { "error": "exec not allowed for user" }`.

### Multi-tenancy / access control

Single-user mode (no `userProjects` store) — all authenticated users see everything.

Multi-user mode (with `userProjects` store) adds three gates:

1. **Global gate** — a non-admin user must be assigned to the daemon's home project to access
   `/tasks`, `/missions`, `/sessions`, `/activity`, or `/events`. Unassigned users get a blanket
   `403 { "error": "forbidden" }` on those route families.

2. **Per-project gate** — even users who pass the global gate may only see/operate projects they
   are explicitly assigned to. The admin sees everything.

3. **Per-user exec allowlist** — the non-admin's `allowed_execs` restricts which exec strings they
   may use. An empty list (or an admin) means unrestricted (subject to the global `allowedExecs`).

---

## Health & setup

### Health check

```http
GET /health
```

Public — no authentication required.

**Response `200`**
```json
{ "ok": true }
```

### Setup status

```http
GET /setup
```

Public — no authentication required. Returns whether the daemon has no users yet (onboarding mode).

**Response `200`**
```json
{ "needsSetup": true }
```

---

## Authentication

### Login

```http
POST /auth/login
Content-Type: application/json

{ "username": "admin", "password": "secret" }
```

Returns a bearer token. Public — no auth required.

**Response `200`**
```json
{
  "token": "a1b2c3d4...",
  "user": { "id": 1, "username": "admin", "created_at": "2026-06-17 12:00:00" }
}
```

**Error `401`**
```json
{ "error": "invalid credentials" }
```

### Logout

```http
POST /auth/logout
```

Revokes the current bearer token.

**Response `200`**
```json
{ "ok": true }
```

### Current user

```http
GET /auth/me
```

Returns the authenticated user.

**Response `200`**
```json
{ "user": { "id": 1, "username": "admin", "name": null, "email": null, ... } }
```

### Update profile

```http
PATCH /auth/me
Content-Type: application/json

{
  "name": "My Name",
  "email": "me@example.com",
  "default_exec": "sonnet"
}
```

Updates the authenticated user's profile. The `default_exec` must be in the daemon's
`allowedExecs` and the user's own `allowed_execs`.

**Response `200`**
```json
{ "name": "My Name", "email": "me@example.com", "default_exec": "sonnet" }
```

**Error `400`**
```json
{ "error": "exec not allowed" }
```

### Upload avatar

```http
POST /auth/me/avatar
Content-Type: multipart/form-data

--boundary
Content-Disposition: form-data; name="avatar"; filename="photo.png"
Content-Type: image/png

<binary data>
--boundary--
```

Uploads a profile avatar. Supported types: PNG, JPEG, WebP, GIF (max 2 MB).

**Response `200`**
```json
{ "avatar": "1.png", ... }
```

**Error `400`**
```json
{ "error": "avatars unavailable" }
```

**Error `400`**
```json
{ "error": "avatar file required" }
```

**Error `413`**
```json
{ "error": "image too large (max 2MB)" }
```

**Error `415`**
```json
{ "error": "unsupported image type" }
```

### Get user avatar

```http
GET /users/:id/avatar?token=<token>
```

Serves the avatar image bytes. Auth token passed as query param so it works as an `<img src="">`.
Returns raw image with correct content-type.

**Response `200`** — binary image data with content-type header.

**Error `404`** — user not found, no avatar, or avatars directory not configured.

---

## Users (admin)

### List users

```http
GET /users
```

**Response `200`**
```json
[
  { "id": 1, "username": "admin", "created_at": "2026-06-17 12:00:00", ... }
]
```

### Create user

```http
POST /users
Content-Type: application/json

{ "username": "dev", "password": "secure-pass" }
```

**Response `201`**
```json
{ "id": 2, "username": "dev", "created_at": "2026-06-17 14:00:00" }
```

**Error `409`**
```json
{ "error": "username taken" }
```

### Edit user

```http
PATCH /users/:id
Content-Type: application/json

{
  "is_admin": true,
  "allowed_execs": ["sonnet", "codex:gpt-5.4"]
}
```

Admin-only. Toggles `is_admin` and/or updates the per-user model allow-list. Cannot demote the last
admin. `allowed_execs` items not in the global `allowedExecs` are silently dropped.

**Response `200`**
```json
{ "id": 2, "username": "dev", "is_admin": true, "allowed_execs": ["sonnet", "codex:gpt-5.4"], ... }
```

**Error `400`**
```json
{ "error": "cannot demote the last admin" }
```

**Error `403`**
```json
{ "error": "forbidden" }
```

**Error `404`**
```json
{ "error": "user not found" }
```

### Delete user

```http
DELETE /users/:id
```

Cannot delete the last user or the admin (admin must be transferred first).

**Response `200`**
```json
{ "ok": true }
```

**Error `400`**
```json
{ "error": "cannot delete the last user" }
```

**Error `400`**
```json
{ "error": "cannot delete the admin" }
```

---

## User ↔ Project assignments (admin)

Assignments gate which projects a non-admin user may see/operate. The admin always has full access.
Only available when `userProjects` store is configured.

### List a user's projects

```http
GET /users/:id/projects
```

**Response `200`**
```json
[1, 3]
```

**Error `403`** — caller is not admin.

### Assign a project

```http
POST /users/:id/projects
Content-Type: application/json

{ "projectId": 3 }
```

**Response `200`**
```json
{ "ok": true }
```

**Error `400`**
```json
{ "error": "projectId required" }
```

### Unassign a project

```http
DELETE /users/:id/projects/:pid
```

**Response `200`**
```json
{ "ok": true }
```

---

## Projects

Multi-project mode. When `projectStore` is absent, only the daemon's home project exists.

### List projects

```http
GET /projects
```

In multi-user mode, non-admin users see only their assigned projects.

**Response `200`**
```json
[
  { "id": 1, "slug": "my-project", "path": "/var/www/my-project", "notes": null }
]
```

### Create project

```http
POST /projects
Content-Type: application/json

{
  "slug": "my-project",
  "path": "/var/www/my-project",
  "notes": "Optional pilot info"
}
```

Admin-only when multi-user auth is on.

**Response `201`**
```json
{ "id": 1, "slug": "my-project", "path": "/var/www/my-project", "notes": "Optional pilot info" }
```

**Error `400`**
```json
{ "error": "projects unavailable" }
```

**Error `403`**
```json
{ "error": "forbidden" }
```

**Error `409`**
```json
{ "error": "slug taken" }
```

### Edit project

```http
PATCH /projects/:id
Content-Type: application/json

{ "path": "/var/www/my-project", "notes": "Updated pilot notes" }
```

Admin-only (when multi-user mode). Updates the path and/or Pilot notes. Slug stays immutable.

**Response `200`**
```json
{ "id": 1, "slug": "my-project", "path": "/var/www/my-project", "notes": "Updated pilot notes" }
```

**Error `400`**
```json
{ "error": "projects unavailable" }
```

**Error `403`**
```json
{ "error": "forbidden" }
```

**Error `404`**
```json
{ "error": "project not found" }
```

### Git info

```http
GET /projects/:id/git
```

Returns git status, branches, and recent commits for the project path.

**Response `200`**
```json
{
  "isRepo": true,
  "status": {
    "branch": "main",
    "dirty": 2,
    "ahead": 1,
    "behind": 0
  },
  "branches": [
    { "name": "main", "current": true },
    { "name": "feature-x", "current": false }
  ],
  "commits": [
    { "hash": "abc123", "subject": "Fix header", "author": "dev", "relative": "2 hours ago" }
  ]
}
```

**Error `400`**
```json
{ "error": "projects unavailable" }
```

**Error `403`**
```json
{ "error": "forbidden" }
```

**Error `404`**
```json
{ "error": "project not found" }
```

---

## Project file editor

Browse, read, and write files in a project root, plus diffs. All paths are validated to stay inside
the project root (symlink-escape safe). Every endpoint gated by `canAccessProject`.

All endpoints return:
- `400` `{ "error": "projects unavailable" }` — project store not configured
- `403` `{ "error": "forbidden" }` — caller cannot access this project
- `404` `{ "error": "project not found" }` — unknown project id

### File tree

```http
GET /projects/:id/files
```

Flat list of files and directories, skipping `.git`, `node_modules`, `.next`, `dist`, etc.

**Response `200`**
```json
[
  { "path": "src", "type": "dir" },
  { "path": "src/index.ts", "type": "file" }
]
```

### Read a file

```http
GET /projects/:id/file?path=src/index.ts
```

Refused for files > 2 MB.

**Response `200`**
```json
{ "path": "src/index.ts", "content": "console.log('hello');\n" }
```

**Error `400`**
```json
{ "error": "path required" }
```
```json
{ "error": "invalid path" }
```

### Write a file

```http
PUT /projects/:id/file
Content-Type: application/json

{ "path": "src/index.ts", "content": "console.log('updated');\n" }
```

**Response `200`**
```json
{ "ok": true }
```

**Error `400`**
```json
{ "error": "path and content required" }
```
```json
{ "error": "invalid path" }
```

### Binary file (image preview)

```http
GET /projects/:id/raw?path=src/logo.png
```

Returns raw file bytes for binary previews. Content-type from extension. Supports PNG, JPEG, WebP,
GIF, SVG, ICO, BMP, AVIF.

**Response `200`** — binary image data.

**Error `400`**
```json
{ "error": "path required" }
```

**Error `415`**
```json
{ "error": "not previewable" }
```

### Create file

```http
POST /projects/:id/new-file
Content-Type: application/json

{ "path": "src/new.ts" }
```

Creates an empty file.

**Response `200`**
```json
{ "ok": true }
```

**Error `400`**
```json
{ "error": "path required" }
```

### Create directory

```http
POST /projects/:id/dir
Content-Type: application/json

{ "path": "src/components" }
```

**Response `200`**
```json
{ "ok": true }
```

**Error `400`**
```json
{ "error": "path required" }
```

### Rename / move

```http
POST /projects/:id/rename
Content-Type: application/json

{ "from": "src/old.ts", "to": "src/new.ts" }
```

**Response `200`**
```json
{ "ok": true }
```

**Error `400`**
```json
{ "error": "from and to required" }
```

### Copy

```http
POST /projects/:id/copy
Content-Type: application/json

{ "from": "src/original.ts", "to": "src/backup.ts" }
```

**Response `200`**
```json
{ "ok": true }
```

**Error `400`**
```json
{ "error": "from and to required" }
```

### Delete entry

```http
DELETE /projects/:id/entry?path=src/old.ts
```

**Response `200`**
```json
{ "ok": true }
```

**Error `400`**
```json
{ "error": "path required" }
```

### Per-file working diff

```http
GET /projects/:id/diff?path=src/index.ts
```

**Response `200`**
```json
{ "diff": "diff --git a/src/index.ts b/src/index.ts\n…" }
```

**Error `400`**
```json
{ "error": "path required" }
```

### File at HEAD

```http
GET /projects/:id/head?path=src/index.ts
```

Content of a file as it exists in the latest commit (before working-tree changes).

**Response `200`**
```json
{ "content": "console.log('original');\n" }
```

**Error `400`**
```json
{ "error": "path required" }
```

### Changed files

```http
GET /projects/:id/changed
```

Returns the list of files changed in the working tree.

**Response `200`**
```json
{ "changed": ["src/index.ts", "README.md"] }
```

### Full working diff

```http
GET /projects/:id/changes
```

Combined diff of all unstaged changes.

**Response `200`**
```json
{ "diff": "diff --git a/…\n…" }
```

### Commit files + diff

```http
GET /projects/:id/commit/:hash
```

**Response `200`**
```json
{ "files": ["src/index.ts"], "diff": "diff --git …" }
```

### File diff in a commit

```http
GET /projects/:id/commit/:hash/diff?path=src/index.ts
```

**Response `200`**
```json
{ "diff": "diff --git …" }
```

**Error `400`**
```json
{ "error": "path required" }
```

---

## Tasks

The basic unit of work. Each task belongs to a project and has a `type`, `status`, `priority`, and
optional parent/child relationships (dependencies).

### List tasks

```http
GET /tasks
```

In multi-user mode, returns only tasks belonging to the caller's accessible projects.

**Response `200`**
```json
[
  {
    "id": "my-project-a1b2c3d4",
    "project_id": 1,
    "title": "Implement login page",
    "type": "task",
    "status": "open",
    "priority": "P2",
    "labels": [],
    "parent_id": null,
    "description": "",
    "scheduled_at": null,
    "autostart": 0,
    "result_summary": null,
    "outcome": null,
    "closed_at": null,
    "created_at": "2026-06-17 12:00:00"
  }
]
```

### Create task

```http
POST /tasks
Content-Type: application/json

{
  "title": "Add dark mode",
  "type": "task",
  "priority": "P3",
  "id": "my-project-custom-id",
  "description": "Add dark mode support to the app",
  "scheduled_at": "2026-06-20T10:00:00Z",
  "autostart": 1,
  "deps": ["other-task-id"],
  "project_id": 1
}
```

Only `title` is required. If `id` is omitted, one is generated as `<project-slug>-<random-hex>`.
`deps` optionally sets task dependencies immediately. `project_id` defaults to the caller's home
project; arbitrary projects require access.

**Response `201`**
```json
{
  "id": "my-project-custom-id",
  "project_id": 1,
  "title": "Add dark mode",
  "type": "task",
  "status": "open",
  "priority": "P3",
  "labels": [],
  "parent_id": null,
  "created_at": "2026-06-17 12:00:00"
}
```

**Error `403`**
```json
{ "error": "forbidden" }
```

**Error `404`**
```json
{ "error": "project not found" }
```

### Update task

```http
PATCH /tasks/:id
Content-Type: application/json

{ "status": "in_progress" }
```

Supports partial updates:
- `status` — triggers SSE event. Setting `"closed"` also accepts `result_summary` and `outcome`.
- `exec` — sets executor label (`exec:<program>`)
- `title`, `type`, `priority`, `description` — updates metadata
- `scheduled_at` — schedule for future execution
- `autostart` — auto-launch when scheduled_at arrives
- `deps` — replace task dependencies with the given array

When a task with a parent (epic child) is closed and the config has `autopilot.reviewOnDone`
+ `autopilot.overseerExec`, a **post-done review** decision is enqueued for the parked Overseer
agent. If the verdict rejects the result (or flags it destructive), dependent phases are blocked
until a human intervenes.

**Response `200`**
```json
{ "id": "my-project-a1b2c3d4", "status": "in_progress", ... }
```

**Error `404`**
```json
{ "error": "task not found" }
```

**Error `403`**
```json
{ "error": "forbidden" }
```

### Delete task

```http
DELETE /tasks/:id
```

Removes the task, all dependency rows, and history from the database. Publishes a `cancelled` SSE event.

**Response `200`**
```json
{ "ok": true }
```

**Error `404`**
```json
{ "error": "task not found" }
```

**Error `403`**
```json
{ "error": "forbidden" }
```

### List ready tasks

```http
GET /tasks/ready
```

Returns tasks whose dependencies are all fulfilled. Accepts optional `?limit=N`.

**Response `200`**
```json
[
  { "id": "task-1", "title": "Fix header", "status": "open", ... }
]
```

### List all dependencies

```http
GET /tasks/deps
```

All task dependency edges.

**Response `200`**
```json
[
  { "task_id": "phase-b", "depends_on_id": "phase-a" }
]
```

### Get task dependencies

```http
GET /tasks/:id/deps
```

**Response `200`**
```json
["dependency-task-id-1", "dependency-task-id-2"]
```

### Task usage (tokens + cost)

```http
GET /tasks/:id/usage
```

Token/cost usage for the task's agent run, read from the executor CLI's local session storage
(opencode / claude / codex). Portable — no relay needed. `null` when no matching session is found.

**Response `200`**
```json
{
  "inputTokens": 12000,
  "outputTokens": 3400,
  "totalTokens": 15400,
  "costUsd": 0.045,
  "contextWindow": 200000,
  "model": "claude-sonnet-4-20250514"
}
```

`{ "usage": null }` when no session matches.

**Error `404`**
```json
{ "error": "not found" }
```

**Error `403`**
```json
{ "error": "forbidden" }
```

---

## Planning (AI plan decomposition)

### Create plan (autopilot + manual)

```http
POST /tasks/plan
Content-Type: application/json

{
  "goal": "Build a login page with OAuth support",
  "exec": "sonnet",
  "autonomy": "L3",
  "maxSessions": 1,
  "engage": true,
  "phases": [],
  "dryRun": false,
  "prompt": "",
  "project_id": 1
}
```

Decomposes a goal into ordered implementation phases. Each phase becomes a task, chained
sequentially via dependencies. Optionally engages a mission immediately.

**Autopilot mode** (no `phases` supplied) is **asynchronous** — returns a plan job (`202`) that you
poll at `GET /plan/:jobId` or watch via the `plan` SSE event. Two backends:

- **Relay backend** (default): the planner LLM decomposes the goal inline before the first async
  tick resolves the job. API key (`autopilot.apiKey`) must be set.
- **Agent backend** (`config.autopilot.pilotExec` set): the **Pilot** spawns as a repo-aware CLI
  agent that submits phases via `POST /plan/:jobId/submit`. No API key needed.

**Manual mode** (`phases` array supplied): bypasses the LLM entirely. Phases are persisted
synchronously and the endpoint returns `201` immediately.

`dryRun: true` records phases as a preview without persisting (playground). `prompt` overrides the
saved autopilot prompt template. `project_id` targets a non-home project.

**Response `202`** (autopilot — relay or agent backend)
```json
{ "jobId": "pj-1a2b3c", "epicId": "my-project-..." }
```

The `epicId` is present immediately for the relay path; for the agent backend it arrives once the
Pilot submits.

**Response `201`** (manual mode)
```json
{
  "epic": { "id": "my-project-...", "title": "Build a login page...", "type": "epic", ... },
  "phases": [
    { "id": "my-project-...", "title": "Set up OAuth provider", "status": "open", ... }
  ],
  "mission": { "id": "m-...", "state": "active", ... }
}
```

**Error `400`**
```json
{ "error": "goal required" }
```

**Error `400`**
```json
{ "error": "exec not allowed" }
```

**Error `403`**
```json
{ "error": "exec not allowed for user" }
```

**Error `400`**
```json
{ "error": "autopilot_key_missing" }
```

**Error `502`**
```json
{ "error": "plan_parse_failed" }
```

### Poll plan job

```http
GET /plan/:jobId
```

Returns the current state of an async planning job.

**Response `200`**
```json
{
  "id": "pj-1a2b3c",
  "epicId": "my-project-...",
  "goal": "Build a login page with OAuth support",
  "status": "done",
  "phases": [
    { "title": "Set up OAuth provider", "type": "feature" }
  ]
}
```

`status` is `planning` | `done` | `failed`.

**Error `404`**
```json
{ "error": "not found" }
```

**Error `403`**
```json
{ "error": "forbidden" }
```

### Submit plan (Pilot agent)

```http
POST /plan/:jobId/submit
Content-Type: application/json

{
  "phases": [
    { "title": "Set up database", "type": "chore" },
    { "title": "Create endpoints", "type": "feature" }
  ]
}
```

Used by the **Pilot agent** to submit phases for an async planning job.

**Response `200`**
```json
{ "id": "pj-1a2b3c", "epicId": "my-project-...", "phases": [...], "status": "done" }
```

**Error `404`**
```json
{ "error": "not found" }
```

**Error `403`**
```json
{ "error": "forbidden" }
```

**Error `400`**
```json
{ "error": "invalid phases" }
```

### Insert / replan phases on an existing epic

```http
POST /tasks/:epicId/phases
Content-Type: application/json

{
  "phases": [{ "title": "Add rate limiting", "type": "feature" }],
  "goal": "harden the auth flow",
  "exec": "sonnet",
  "prompt": ""
}
```

Appends new phases to an existing epic. Two modes:

- **Manual insert** (supply `phases` array): no LLM, no API key needed. Persisted synchronously.
  Returns `201`.
- **Replan** (supply `goal` string): the autopilot decomposes the residual goal. Async path —
  returns `202` with a `jobId` scoped to this epic. Supports both relay and agent Pilot backends.

New phases are chained to run **after** the epic's current tail phases (leaves that nothing else
depends on), then sequentially among themselves. If a mission is already active on the epic
(`m-<epicId>`), it is ticked immediately. `exec`, when given, is set on every new phase.

**Response `201`** (manual insert)
```json
{
  "epic": { "id": "my-project-...", "type": "epic", ... },
  "phases": [ { "id": "my-project-...", "title": "Add rate limiting", "status": "open", ... } ]
}
```

**Response `202`** (replan — async)
```json
{ "jobId": "pj-1a2b3c", "epicId": "my-project-..." }
```

**Error `404`**
```json
{ "error": "epic not found" }
```

**Error `400`**
```json
{ "error": "phases or goal required" }
```

**Error `400`**
```json
{ "error": "exec not allowed" }
```

**Error `403`**
```json
{ "error": "exec not allowed for user" }
```

**Error `400`**
```json
{ "error": "autopilot_key_missing" }
```

**Error `502`**
```json
{ "error": "plan_parse_failed" }
```

---

## Sessions

Sessions correspond to tmux sessions running a single coding agent on a single task.

### List sessions

```http
GET /sessions
```

Returns tmux session names filtered to the `orca-` prefix.

**Response `200`**
```json
["orca-SwiftLake0", "orca-CalmRidge1"]
```

### Spawn session

```http
POST /sessions
Content-Type: application/json

{
  "taskId": "my-project-a1b2c3d4",
  "exec": "sonnet"
}
```

Creates a tmux session named `orca-<agentName>`, sets the task `in_progress`, and launches the
agent. The agent spawns in the task's own project directory. `exec` is validated against the global
`allowedExecs` and the per-user `allowed_execs`.

**Response `201`**
```json
{ "session": "orca-SwiftLake0" }
```

**Error `400`**
```json
{ "error": "exec not allowed" }
```

**Error `403`**
```json
{ "error": "exec not allowed for user" }
```

**Error `404`**
```json
{ "error": "task not found" }
```

**Error `403`**
```json
{ "error": "forbidden" }
```

### Stream session output

```http
GET /sessions/:name/stream
```

Server-Sent Events stream of the tmux pane content (ANSI, last 200 lines, polled every second).

```
event: pane
data: {"pane": "\u001b[0m\u001b[1m>\u001b[0m \u001b[32morca\u001b[0m ..."}
```

The stream stays alive even if the session dies (returns empty frames).

### Capture pane

```http
GET /sessions/:name/pane?ansi=1
```

Returns the last 60 lines of the session's pane. When `?ansi=1`, ANSI escape codes are preserved.

**Response `200`**
```json
{ "pane": "> orca ready\n1. Fix header\n2. Add footer\n" }
```

### Send keys

```http
POST /sessions/:name/keys
Content-Type: application/json

{ "keys": ["y", "Enter"] }
```

Sends keystrokes to the tmux session (e.g., approve agent prompts, interrupt with `["C-c"]`).

**Response `200`**
```json
{ "ok": true }
```

### Resize terminal

```http
POST /sessions/:name/resize
Content-Type: application/json

{ "cols": 120, "rows": 40 }
```

Resizes the tmux window (clamped to 20–500 cols, 5–200 rows).

**Response `200`**
```json
{ "ok": true }
```

**Error `400`**
```json
{ "error": "cols and rows required" }
```

### Kill session

```http
DELETE /sessions/:name
```

**Response `200`**
```json
{ "ok": true }
```

---

## Missions

A mission drives an epic's child tasks through the autopilot loop — picking ready tasks, spawning
agents, and processing approvals/guardrails. Missions are identified by `m-<epicId>`.

### List active missions

```http
GET /missions
```

In multi-user mode, filtered to the caller's accessible projects.

**Response `200`**
```json
[
  {
    "id": "m-epic-1",
    "epic_id": "epic-1",
    "autonomy": "L2",
    "max_sessions": 1,
    "cleared_guardrails": ["schema"],
    "state": "active",
    "started_at": "2026-06-17 12:00:00"
  }
]
```

### Get mission detail

```http
GET /missions/:id
```

Returns the mission with its epic, full task tree, dependencies, and progress breakdown.

**Response `200`**
```json
{
  "mission": { "id": "m-epic-1", "state": "active", "cleared_guardrails": ["schema"], ... },
  "epic": { "id": "epic-1", "title": "Build login page", ... },
  "tasks": [
    { "id": "...", "title": "Set up OAuth", "status": "closed" },
    { "id": "...", "title": "Create login form", "status": "in_progress" }
  ],
  "deps": [
    { "taskId": "...", "dependsOnId": "..." }
  ],
  "progress": {
    "total": 5, "open": 1, "inProgress": 1,
    "blocked": 0, "closed": 3, "cancelled": 0
  }
}
```

**Error `404`**
```json
{ "error": "mission not found" }
```

**Error `403`**
```json
{ "error": "forbidden" }
```

### Create mission (engage)

```http
POST /missions
Content-Type: application/json

{
  "epicId": "epic-1",
  "autonomy": "L2",
  "maxSessions": 1,
  "clearedGuardrails": ["schema"]
}
```

Triggers an immediate tick cycle — picks ready tasks and spawns agents up to `maxSessions`.

**Response `201`**
```json
{
  "id": "m-epic-1",
  "epic_id": "epic-1",
  "autonomy": "L2",
  "max_sessions": 1,
  "cleared_guardrails": ["schema"],
  "state": "active",
  "started_at": "2026-06-17 12:00:00"
}
```

**Error `403`**
```json
{ "error": "forbidden" }
```

### Pause / Resume mission

```http
PATCH /missions/:id
Content-Type: application/json

{ "action": "pause" }
```

Actions: `pause` | `resume`

`pause` kills running agents and reverts their tasks to `open`. `resume` triggers an immediate tick.

**Response `200`**
```json
{ "id": "m-epic-1", "state": "paused", ... }
```

**Error `404`**
```json
{ "error": "mission not found" }
```

**Error `403`**
```json
{ "error": "forbidden" }
```

### Disengage mission

```http
DELETE /missions/:id
```

Sets state to `disengaged` and kills all associated agent sessions.

**Response `200`**
```json
{ "ok": true }
```

**Error `404`**
```json
{ "error": "mission not found" }
```

**Error `403`**
```json
{ "error": "forbidden" }
```

### Overseer long-poll (parked agent)

Used by the parked per-mission Overseer agent when `config.autopilot.overseerExec` is set. The agent
blocks on `next` until a decision is needed (or a heartbeat), then answers via `decide`. No model
output is parsed — the agent posts a structured verdict; the local destructive heuristic is
authoritative and applied at enqueue time.

```http
GET /missions/:id/overseer/next?timeoutMs=30000
```

Blocks until a decision is pending, then returns the decision request. Returns `{}` on a heartbeat
(nothing pending). `timeoutMs` caps the long-poll (max 30 000).

**Response `200`**
```json
{ "id": "d-abc", "kind": "task", "context": { ... } }
```
`kind` ∈ `task` | `prompt` | `review`

**Error `403`**
```json
{ "error": "forbidden" }
```

```http
POST /missions/:id/overseer/decide
Content-Type: application/json

{ "id": "d-abc", "approve": true, "confidence": 0.8, "rationale": "looks safe" }
```

Resolves the awaiting decision.

**Response `200`**
```json
{ "ok": true }
```

**Error `400`**
```json
{ "error": "id required" }
```

**Error `403`**
```json
{ "error": "forbidden" }
```

**Error `404`**
```json
{ "error": "no such decision" }
```

---

## Activity log

```http
GET /activity
```

Time-ordered event log.

| Query param | Description |
|---|---|
| `limit` | Max events to return |
| `type` | Filter: `task`, `mission`, `signal`, `plan` |

**Response `200`**
```json
[
  { "id": 1, "type": "task", "target": "task-1", "detail": "created", "ts": "2026-06-17T12:00:00.000Z" },
  { "id": 2, "type": "signal", "target": "orca-SwiftLake0", "detail": "working", "ts": "2026-06-17T12:05:00.000Z" }
]
```

When no event store is configured, returns `[]`.

---

## Config

### Get config

```http
GET /config
```

**Response `200`**
```json
{
  "allowedExecs": ["sonnet", "codex:gpt-5.4", "ollama/deepseek-v4-flash"],
  "customModels": [],
  "hiddenPresets": [],
  "defaults": { "exec": "sonnet", "autonomy": "L3", "maxSessions": 1 },
  "autopilot": {
    "model": "gpt-4o-mini",
    "overseerModel": "",
    "pilotExec": "",
    "overseerExec": "",
    "reviewOnDone": false,
    "apiUrl": "https://api.openai.com/v1",
    "apiKeySet": false,
    "notes": "",
    "prompt": "..."
  },
  "providers": {
    "claude-code": { "bin": "claude", "args": "" },
    "opencode": { "bin": "opencode", "args": "" },
    "codex": { "bin": "codex", "args": "" }
  }
}
```

Per-role reasoning backends (all default off — unchanged relay behaviour):

| Field | Effect |
|---|---|
| `autopilot.pilotExec` | When set (e.g. `claude:opus`), the **Pilot** runs as a repo-aware CLI agent that submits its plan via `orca plan submit`. Empty → relay model decomposes inline. |
| `autopilot.overseerExec` | When set, the **Overseer** runs as a parked per-mission CLI agent that long-polls `GET /missions/:id/overseer/next`. Empty → decisions use the relay (`overseerModel` / `model`). |
| `autopilot.reviewOnDone` | When `true` (and `overseerExec` is set), each closed mission phase enqueues a post-done review for the Overseer. Default `false`. |

### Update config

```http
PUT /config
Content-Type: application/json

{ "allowedExecs": ["sonnet"], "autopilot": { "apiKey": "sk-..." } }
```

Admin-only (when users exist). All fields are partial — only specified fields are updated. During
setup (no users yet) it is open so onboarding can save providers before the first admin exists.

**Response `200`**
```json
{ "ok": true }
```

**Error `403`**
```json
{ "error": "forbidden" }
```

---

## Events (SSE)

```http
GET /events?token=<token>
```

Server-Sent Events stream for real-time updates. Auth token as query parameter.

### Event types

**task**
```
event: task
data: {"type": "task", "taskId": "my-project-a1b2c3d4", "status": "in_progress"}
```

**mission**
```
event: mission
data: {"type": "mission", "missionId": "m-epic-1", "state": "active"}
```

**signal** (from deriver)
```
event: signal
data: {"type": "signal", "session": "orca-Agent0", "signal": {"type": "working"}}
```

Signal types: `working`, `needs_input`, `complete`.

**plan** (async planning job)
```
event: plan
data: {"type": "plan", "jobId": "pj-1a2b3c", "status": "done", "epicId": "my-project-...", "phases": [...]}
```

Emitted as a plan job transitions `planning` → `done` | `failed`.

---

## Integrations

### Hermes plugin status

```http
GET /integrations/hermes/status?home=/var/www/.hermes
```

Reports whether the Orca plugin is installed and enabled in a same-host Hermes instance.

**Response `200`**
```json
{
  "home": "/var/www/.hermes",
  "exists": true,
  "pluginsDir": true,
  "pluginInstalled": true,
  "enabled": true
}
```

### Install Hermes plugin

```http
POST /integrations/hermes/install
Content-Type: application/json

{
  "home": "/var/www/.hermes",
  "url": "http://localhost:4400",
  "token": "a1b2c3d4..."
}
```

Copies the bundled `hermes-plugin/orca/` into the Hermes plugins directory, writes per-instance
config (url + token), and enables the plugin in Hermes's `config.yaml`. Backs up the config first.

**Response `201`**
```json
{
  "pluginDir": "/var/www/.hermes/plugins/orca",
  "copied": true,
  "alreadyEnabled": false,
  "enabled": true,
  "backedUp": true,
  "status": { "home": "/var/www/.hermes", "pluginInstalled": true, "enabled": true }
}
```

**Error `400`**
```json
{ "error": "url and token required" }
```

### CLI detection

```http
GET /integrations/cli-status
```

Detects which agent CLIs (claude, opencode, codex) are installed and usable, and whether the daemon
has enough configuration to operate. Used by the onboarding wizard.

**Response `200`**
```json
{
  "clis": [
    { "name": "claude", "installed": true, "path": "/usr/local/bin/claude", "version": "1.2.3" },
    { "name": "opencode", "installed": false, "path": null, "version": null },
    { "name": "codex", "installed": true, "path": "/usr/bin/codex", "version": "0.5.0" }
  ],
  "ready": true,
  "missing": []
}
```

---

## Status codes

| Code | Meaning |
|---|---|
| `200` | Success |
| `201` | Created |
| `202` | Accepted (async plan job) |
| `400` | Bad request (invalid input, exec not allowed, missing fields) |
| `401` | Unauthorized (missing or invalid token) |
| `403` | Forbidden (not accessible for this user/project, exec not allowed for user) |
| `404` | Not found |
| `409` | Conflict (duplicate slug/username) |
| `413` | Payload too large (avatar exceeds 2 MB) |
| `415` | Unsupported media type (avatar image type not accepted) |
| `502` | Bad gateway (AI plan parsing failed) |
| `500` | Internal error |

## Error format

```json
{ "error": "descriptive message" }
```
