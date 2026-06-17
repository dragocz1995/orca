# Orca

**AI agent orchestration daemon** — spawns, monitors, and manages autonomous AI coding agents (Claude Code, OpenCode, Codex) in isolated tmux sessions. Features a REST API, CLI client, and real-time web UI.

## Quick start

```bash
npm install && npm run build
npm run serve
```

Starts the daemon on `http://localhost:4400`.

## Architecture overview

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────┐
│  CLI client │────▶│   REST API (Hono) │◀────│  Web UI     │
│  orca ls    │     │   port 4400       │     │  Next.js     │
└─────────────┘     └────────┬─────────┘     └─────────────┘
                             │
                    ┌────────▼─────────┐
                    │   MissionEngine  │  — tick cycle, autonomy levels
                    │   Guardrails     │  — schema/auth/payment blocking
                    │   Routing        │  — task → agent assignment
                    └────────┬─────────┘
                             │
                    ┌────────▼─────────┐
                    │   SpawnService   │  — launches agents in tmux
                    │   Deriver        │  — monitors agent output
                    └────────┬─────────┘
                             │
                    ┌────────▼─────────┐
                    │   SQLite store   │  — tasks, missions, agents
                    └──────────────────┘
```

The daemon runs a tick loop every 90 seconds: checks ready tasks, evaluates guardrails, spawns agents up to `max_sessions`, and monitors their progress via tmux pane capture.

## Tech stack

| Layer | Technology |
|---|---|
| Runtime | Node.js ≥22 (ESM) |
| API | Hono + `@hono/node-server` |
| Database | SQLite via `better-sqlite3` (WAL mode) |
| Terminal | tmux (session management, pane capture) |
| Frontend | Next.js 16, React 19, Tailwind CSS 4 |
| Tests | Vitest |
| CLI | Native Node CLI (`bin/orca`) |

## Project structure

```
src/
├── api/          # Hono REST router + SSE event bus
├── cli/          # orca CLI client
├── daemon/       # Entrypoint + DI bootstrap
├── deriver/      # Agent terminal monitoring
├── inference/    # LLM inference relay (reserved)
├── overseer/     # Mission engine, guardrails, routing
├── shared/       # Utilities (Clock abstraction)
├── spawn/        # Agent launcher (tmux)
├── store/        # SQLite data layer
└── tmux/         # tmux driver (real + fake)
tests/            # Mirrors src/ structure
web/              # Next.js frontend
docs/             # Design docs, specs, follow-ups
```

## CLI

```bash
# List tasks
orca ls

# List ready tasks (dependencies fulfilled)
orca ready

# List active sessions
orca sessions
```

The CLI auto-starts the daemon if it isn't already running.

## REST API

The daemon exposes a Hono server on port 4400:

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Health check |
| `GET` | `/tasks` | List tasks |
| `POST` | `/tasks` | Create task |
| `GET` | `/tasks/ready` | Tasks with all deps met |
| `GET` | `/tasks/:id` | Task detail |
| `PATCH` | `/tasks/:id` | Update task |
| `POST` | `/tasks/:id/deps` | Add dependency |
| `GET` | `/tasks/:id/tree` | Task dependency tree |
| `GET` | `/sessions` | List active sessions |
| `POST` | `/sessions` | Spawn agent session |
| `GET` | `/sessions/:name/stream` | SSE terminal stream |
| `GET` | `/missions` | List missions |
| `POST` | `/missions` | Create mission |
| `GET` | `/events` | SSE event bus |

## Missions & guardrails

**Missions** group related tasks under an epic with a defined autonomy level (L0–L3) and `max_sessions` cap. The engine ticks active missions, spawns agents for ready tasks, and respects guardrails.

**Guardrails** block tasks that touch sensitive domains until explicitly cleared:

- `schema` — database schema changes
- `auth` — authentication/authorization
- `payments` — payment logic
- `destructive` — destructive operations (rm, drop, truncate)

Guardrails are regex-matched against task titles and labels. Cleared per-mission via the `cleared_guardrails` field.

## Frontend

Next.js web UI at `web/` with:

- **Dashboard** — task list, mission overview
- **Terminal** — real-time tmux stream via SSE + Xterm.js
- **Mission control** — create and monitor missions

```bash
cd web && npm install && npm run dev
```

## Development

```bash
# Build daemon
npm run build

# Run tests
npm test

# Watch mode
npm run test:watch

# Run daemon directly (development)
npm run serve
```

Test architecture uses fake implementations (`FakeTmuxDriver`, `FakeClock`) to avoid real tmux or LLM dependencies.

## Configuration

Environment variables and configuration options (see `src/daemon/bootstrap.ts`):

- `dbPath` — SQLite database path
- `relay` — LLM inference relay endpoint (optional, reserved for future use)
- `project` — project metadata (id, slug, path)

## Follow-ups

See [FOLLOWUPS.md](docs/FOLLOWUPS.md) for deferred features:
1. Wire the inference module for LLM-driven decisions
2. Concurrency hardening (`max_sessions > 1`)
3. Extended API surface (task trees, agent management)
