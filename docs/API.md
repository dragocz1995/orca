# API Reference

The Orca daemon exposes a REST API on port 4400. All endpoints return JSON. The API supports CORS for the web frontend.

**Base URL:** `http://localhost:4400`

---

## Health

```http
GET /health
```

Public — no authentication required.

**Response `200`**
```json
{ "ok": true }
```

---

## Authentication

### Login

```http
POST /auth/login
Content-Type: application/json

{
  "username": "admin",
  "password": "secret"
}
```

Returns a bearer token for subsequent requests. Public — no auth required.

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

Revokes the current bearer token. Requires `Authorization: Bearer <token>` header.

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
{ "user": { "id": 1, "username": "admin", "created_at": "2026-06-17 12:00:00" } }
```

### Auth header

All endpoints except `/health` and `POST /auth/login` require authentication:

```
Authorization: Bearer <token>
```

Or via query parameter (used by SSE connections):
```
GET /events?token=<token>
```

---

## Users

### List users

```http
GET /users
```

**Response `200`**
```json
[
  { "id": 1, "username": "admin", "created_at": "2026-06-17 12:00:00" }
]
```

### Create user

```http
POST /users
Content-Type: application/json

{
  "username": "dev",
  "password": "secure-pass"
}
```

**Response `201`**
```json
{ "id": 2, "username": "dev", "created_at": "2026-06-17 14:00:00" }
```

**Error `409`**
```json
{ "error": "username taken" }
```

### Delete user

```http
DELETE /users/:id
```

Cannot delete the last user.

**Response `200`**
```json
{ "ok": true }
```

**Error `400`**
```json
{ "error": "cannot delete the last user" }
```

---

## Projects

### List projects

```http
GET /projects
```

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

**Response `201`**
```json
{ "id": 1, "slug": "my-project", "path": "/var/www/my-project", "notes": "Optional pilot info" }
```

**Error `409`**
```json
{ "error": "slug taken" }
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

---

## Tasks

### List tasks

```http
GET /tasks
```

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
  "id": "my-project-custom-id"
}
```

All fields except `title` are optional. If `id` is omitted, one is generated as `<project-slug>-<random-hex>`.

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

### Get task

```http
GET /tasks/:id
```

**Response `200`**
```json
{
  "id": "my-project-a1b2c3d4",
  "title": "Implement login page",
  "status": "in_progress",
  "labels": ["exec:claude-code"]
}
```

Returns `null` body with 200 if the task doesn't exist.

### Update task

```http
PATCH /tasks/:id
Content-Type: application/json

{ "status": "in_progress" }
```

Supports partial updates:
- `status` — triggers SSE event
- `exec` — sets executor label (`exec:<program>`)
- `title`, `type`, `priority` — updates metadata

**Response `200`**
```json
{ "id": "my-project-a1b2c3d4", "status": "in_progress", ... }
```

### Delete task

```http
DELETE /tasks/:id
```

Sets status to `cancelled` and publishes SSE event.

**Response `200`**
```json
{ "ok": true }
```

### List ready tasks

```http
GET /tasks/ready
```

Returns tasks whose dependencies are all fulfilled. Accepts optional `?limit=N` query parameter.

**Response `200`**
```json
[
  { "id": "task-1", "title": "Fix header", "status": "open", ... }
]
```

### AI plan

```http
POST /tasks/plan
Content-Type: application/json

{
  "goal": "Build a login page with OAuth support",
  "exec": "sonnet",
  "autonomy": "L3",
  "maxSessions": 1,
  "engage": true
}
```

Uses the configured autopilot LLM to decompose a goal into ordered implementation phases. Each phase becomes a task, chained sequentially via dependencies. Optionally engages a mission immediately.

Requires autopilot API key to be configured.

**Response `201`**
```json
{
  "epic": { "id": "my-project-...", "title": "Build a login page...", "type": "epic", ... },
  "phases": [
    { "id": "my-project-...", "title": "Set up OAuth provider", "status": "open", ... },
    { "id": "my-project-...", "title": "Create login form", "status": "open", ... }
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
{ "error": "autopilot_key_missing" }
```

---

## Sessions

### List sessions

```http
GET /sessions
```

Returns tmux session names from the host.

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

`exec` must be in the configured `allowedExecs` list. Creates a tmux session named `orca-<agentName>`, sets the task status to `in_progress`, and launches the agent.

**Response `201`**
```json
{ "session": "orca-SwiftLake0" }
```

**Error `400`**
```json
{ "error": "exec not allowed" }
```

### Stream session output

```http
GET /sessions/:name/stream
```

Server-Sent Events stream of the tmux pane content. Polls every second.

```
event: pane
data: {"pane": "\u001b[0m\u001b[1m>\u001b[0m \u001b[32morca\u001b[0m ..."}
```

The stream stays alive even if the session dies (returns empty frames).

### Kill session

```http
DELETE /sessions/:name
```

**Response `200`**
```json
{ "ok": true }
```

### Send keys

```http
POST /sessions/:name/keys
Content-Type: application/json

{ "keys": ["y", "Enter"] }
```

Sends keystrokes to the tmux session (e.g., to approve agent prompts, interrupt with `["C-c"]`).

**Response `200`**
```json
{ "ok": true }
```

### Capture pane

```http
GET /sessions/:name/pane
```

Returns the last 60 lines of the session's tmux pane.

**Response `200`**
```json
{ "pane": "> orca ready\n1. Fix header\n2. Add footer\n" }
```

---

## Missions

### List active missions

```http
GET /missions
```

**Response `200`**
```json
[
  {
    "id": "m-epic-1",
    "epic_id": "epic-1",
    "autonomy": "L2",
    "max_sessions": 1,
    "cleared_guardrails": "schema,test",
    "state": "active",
    "started_at": "2026-06-17 12:00:00"
  }
]
```

### Get mission detail

```http
GET /missions/:id
```

Returns the mission with its epic, task tree, dependencies, and progress breakdown.

**Response `200`**
```json
{
  "mission": { "id": "m-epic-1", "state": "active", ... },
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

Triggers an immediate `tick` cycle after creation.

**Response `201`**
```json
{
  "id": "m-epic-1",
  "epic_id": "epic-1",
  "autonomy": "L2",
  "max_sessions": 1,
  "cleared_guardrails": "schema",
  "state": "active",
  "started_at": "2026-06-17 12:00:00"
}
```

### Pause / Resume mission

```http
PATCH /missions/:id
Content-Type: application/json

{ "action": "pause" }
```

Actions: `pause` | `resume`

`resume` triggers an immediate tick cycle.

**Response `200`**
```json
{ "id": "m-epic-1", "state": "paused", ... }
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

---

## Activity log

```http
GET /activity
```

Returns a time-ordered event log. Optional filters:

| Query param | Description |
|---|---|
| `limit` | Max events to return |
| `type` | Filter by event type: `task`, `mission`, `signal` |

**Response `200`**
```json
[
  { "id": 1, "type": "task", "target": "task-1", "detail": "created", "ts": "2026-06-17T12:00:00.000Z" },
  { "id": 2, "type": "signal", "target": "orca-SwiftLake0", "detail": "working", "ts": "2026-06-17T12:05:00.000Z" }
]
```

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
  "autopilot": {
    "model": "mimo-v2.5",
    "apiUrl": "https://ai.coresynth.io/v1",
    "apiKeySet": false
  }
}
```

### Update config

```http
PUT /config
Content-Type: application/json

{
  "allowedExecs": ["sonnet"],
  "autopilot": { "apiKey": "sk-..." }
}
```

All fields are partial — only specified fields are updated.

**Response `200`**
```json
{ "allowedExecs": ["sonnet"], "autopilot": { ... } }
```

---

## Events (SSE)

```http
GET /events?token=<token>
```

Server-Sent Events stream for real-time updates. Events are published by the daemon when state changes occur. Requires auth token as query parameter (since EventSource doesn't support custom headers).

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

---

## Status codes

| Code | Meaning |
|---|---|
| `200` | Success |
| `201` | Created |
| `400` | Bad request (invalid input, exec not allowed) |
| `401` | Unauthorized (missing or invalid token) |
| `404` | Not found |
| `409` | Conflict (duplicate slug/username) |
| `502` | Bad gateway (AI plan parsing failed) |
| `500` | Internal error |

## Error format

```json
{ "error": "exec not allowed" }
```
