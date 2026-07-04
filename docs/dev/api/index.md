# API Reference

The daemon exposes a REST+WebSocket API on port 4400 (configurable via `ORCA_PORT`). The web UI proxies to it through a BFF (backend-for-frontend) that injects the session token as a `Bearer` header.

## Authentication

All endpoints (except `/health`, `/setup`, `POST /auth/login`, `GET /push/vapid-public-key`, `GET /ws/terminal`, and signed avatar URLs) require a `Bearer` token in the `Authorization` header.

Agent-scoped tokens are further restricted to a capability allow-list: they may close their task, submit plans, poll overseer decisions, read task/session listings, leave handoff notes, and ask the autopilot. They cannot reach admin surfaces.

## Tenancy

Non-admin users are scoped to their assigned projects. Project-scoped routes (`/tasks`, `/missions`, `/sessions`, `/activity`, `/events`, `/usage`) check membership. Admins and single-user mode see everything.

## SSE event stream

`GET /events` streams `OrcaEvent` objects with SSE. Each event is filtered per subscriber by project access. Types: `signal`, `mission`, `task`, `review`, `decision`, `message`, `ask`, `change`, `plan`.

## Route families

| Family | File | Prefix | Description |
|--------|------|--------|-------------|
| Auth | `auth.ts` | `/auth`, `/users` | Login, profile, password, avatars, user CRUD, project assignments |
| Tasks | `tasks.ts` | `/tasks`, `/plan`, `/usage` | Task CRUD, plan/replan, usage, ask/guide, admin cleanup |
| Projects | `projects.ts` | `/projects`, `/fs` | Project CRUD, file editor, git surface |
| Activity | `activity.ts` | `/activity`, `/notes` | Activity timeline, handoff notes |
| Sessions | `sessions.ts` | `/sessions` | tmux session lifecycle, keystrokes, terminal stream |
| Advisor | `advisor.ts` | `/advisor` | Per-user advisor start/stop/status |
| Brain | `brain.ts` | `/brain` | Embedded AI chat, models, sessions, stream |
| Integrations | `integrations.ts` | `/integrations` | CLI detection, GitHub auth status |
| Missions | `missions.ts` | `/missions` | Mission lifecycle, overseer long-poll, PR operations |
| Config | `config.ts` | `/config`, `/system`, `/events`, `/mcp`, `/push` | Config, system, SSE, MCP, web-push |
| Plugins | `plugins.ts` | `/plugins` | Plugin management, skills, cron jobs, OAuth, Discord channels |
| Personality | `personality.ts` | `/personality` | Per-user personality profiles |
| Memory | `memory.ts` | `/memory` | Per-user memory CRUD, categories, embeddings, retrieval |

Detailed endpoint docs per family:

- [Auth](auth.md)
- [Tasks](tasks.md)
- [Projects](projects.md)
- [Activity](activity.md)
- [Sessions](sessions.md)
- [Advisor](advisor.md)
- [Brain](brain.md)
- [Integrations](integrations.md)
- [Missions](missions.md)
- [Config](config.md)
- [Plugins](plugins.md)
- [Personality](personality.md)
- [Memory](memory.md)