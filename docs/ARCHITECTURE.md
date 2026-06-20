# Architecture

## Overview

Orca is a self-hosted AI agent orchestration daemon. It manages a queue of tasks, spawns AI coding agents (Claude Code, OpenCode, Codex) in isolated tmux sessions, monitors their progress, and enforces safety guardrails. A **Next.js dashboard** (`web/`) drives everything over the HTTP API. Daemon code is plain TypeScript (Hono + `better-sqlite3`), no framework magic.

## Core runtime

```
bootstrap → open DB → instantiate stores/services → create Hono server → startup reconcile → start loops
```

The daemon starts a set of independent timer loops:

| Loop | Interval | Purpose |
|---|---|---|
| Overseer (engine tick) | 90 s | Tick active missions: pick ready tasks, check guardrails, spawn agents |
| Scheduler | 30 s | Launch due scheduled/autostart tasks |
| Janitor | 60 s | Kill zombie tmux sessions whose task is already closed/cancelled |
| Stuck detector | 60 s | Revert tasks whose agent died without `orca close` (bounded), escalate after 2 relaunch attempts |
| Deriver | 5 s | Poll tmux panes, detect agent state (working, needs_input, complete), auto-approve known prompts |

### Startup reconcile

On boot the daemon runs two one-shot recovery passes before the loops start:

1. **Zombie reconcile** — tasks left `in_progress` whose tmux session is gone are reverted to `open` so they can be picked up again. No grace or relaunch counter: a restart isn't an agent death, so it shouldn't spend the budget.

2. **Overseer reconcile** — when an agent overseer is configured, re-park one per active mission (their tmux sessions died with the daemon) and kill orphan overseer sessions whose mission is no longer active.

## Request / spawn flow

```
HTTP request
  → api/server.ts (route handler, auth via Bearer token)
  → overseer/missionEngine.ts (mission tick: pick ready tasks)  OR  overseer/scheduler.ts (scheduled/autostart)
  → spawn/spawn.ts  SpawnService.launch()
  → spawn/commandBuilder.ts  buildAgentCommand()  (cd + env + cli + prompt)
  → tmux/driver.ts  spawn()  →  tmux new-session  (session = orca-<agentName>)
```

The agent works in the tmux pane, then calls `node <cli> close <taskId> …` back to the daemon (`PATCH`/close path) to mark its task done.

## Modules

### `src/daemon/` — Entry point

- `index.ts` — starts HTTP server on port 4400
- `bootstrap.ts` — DI container: opens DB, instantiates all services, wires them together, starts timer loops
- `uniqueName.ts` — generates agent session names from a curated list (Nova, Atlas, Iris, …), cycles with numeric suffix on wrap

### `src/api/` — REST API (Hono)

- `server.ts` — route definitions (~854 lines): tasks, missions, sessions, projects, users, auth, config, integrations, file editor, git surface, planner, plan jobs, overseer decision routes
- `sse.ts` — `EventBus` for real-time SSE notifications (terminal output, task state changes, plan job status)
- `auth.ts` — Bearer token middleware, also accepts `?token=` query param for SSE

### `src/overseer/` — Orchestration logic

- `missionEngine.ts` — tick loop, session counting, guardrail enforcement, task-to-agent dispatch, engage/pause/resume/disengage, stalled detection
- `guardrails.ts` — regex-based detection of sensitive operations (schema, migration, auth, payments, destructive)
- `routing.ts` — maps `exec:<spec>` labels to agent programs (claude-code, opencode, codex)
- `scheduler.ts` — launches due scheduled tasks across all projects (30s poll)
- `janitor.ts` — sweeps zombie sessions whose task is closed/cancelled (60s)
- `stuckDetector.ts` — reverts tasks whose agent died without closing, bounded relaunch (`stuck:<n>` label), escalates to blocked after maxRelaunch (60s)
- `decision.ts` — LLM-based prompt and task approval overseer with local destructive heuristic
- `decisionQueue.ts` — per-mission FIFO: engine/deriver enqueue decisions, parked overseer polls and resolves; timeout escalates conservatively
- `overseerAgent.ts` — lifecycle of the parked per-mission overseer agent (long-poll loop)
- `pilotAgent.ts` — spawns the planning agent for agent-mode plan jobs (reads repo, submits plan via `orca plan submit`)
- `planner.ts` — AI goal decomposition for `POST /tasks/plan` (relay backend)
- `planJob.ts` — async planning job registry (shared state between relay and agent backends)

### `src/spawn/` — Agent spawning

- `spawn.ts` — `SpawnService` creates tmux sessions with agent commands
- `commandBuilder.ts` — builds the shell command per agent type (claude-code with `--dangerously-skip-permissions`, opencode TUI, codex with bypass flag)

### `src/deriver/` — Agent monitoring

- `deriver.ts` — polls tmux panes every 5s, interprets output with `shellPatterns.ts`, detects agent state (working, needs_input, complete), auto-approves known prompts for L2/L3 missions
- `shellPatterns.ts` — regex patterns for detecting permission prompts per program
- `types.ts` — `DerivedSignal` type definitions

### `src/tmux/` — tmux abstraction

- `types.ts` — `TmuxDriver` interface
- `driver.ts` — `RealTmuxDriver` wrapping tmux CLI commands (spawn, sendKeys, capturePane, capturePaneAnsi, list, kill, resize)
- `fakeDriver.ts` — `FakeTmuxDriver` for tests (in-memory session simulation)

### `src/store/` — Data layer

SQLite with WAL mode (`better-sqlite3`). Tables:

| Table | Purpose |
|---|---|
| `projects` | Registered projects |
| `tasks` | Task queue (tree structure via `parent_id`) |
| `task_deps` | Task dependencies (DAG) |
| `agents` | Agent session registry (per-project unique names) |
| `missions` | Mission definitions, autonomy level, guardrail config |
| `settings` | Daemon configuration (JSON blob) |
| `users` | User accounts (scrypt password hashes, admin flag, per-user exec allow-list) |
| `auth_tokens` | Session tokens for bearer auth |
| `events` | Activity event log (state changes, signals) |
| `user_projects` | User ↔ project assignments (RBAC many-to-many) |

Store modules: `db.ts`, `taskStore.ts`, `missionStore.ts`, `agentStore.ts`, `eventStore.ts`, `configStore.ts`, `userStore.ts`, `projectStore.ts`, `userProjectStore.ts`, `readiness.ts`, `missionDetail.ts`, `schema.sql`, `types.ts`.

### `src/inference/` — LLM relay

- `client.ts` — `RelayClient` for OpenAI-compatible APIs, `FakeInference` for tests
- `types.ts` — `InferenceClient` interface and `RelayConfig`

### `src/git/` — Git integration

- `gitReader.ts` — reads git status, branches, and recent commits for project paths

### `src/integrations/` — External integrations

- `hermesInstall.ts` — installs the bundled orca plugin into a same-host Hermes instance
- `projectFiles.ts` — safe file tree, read, write, and diff operations for the Monaco editor
- `cliDetection.ts` — detects installed agent CLIs (claude, opencode, codex) for the onboarding wizard
- `usage/` — reads token/cost usage from each executor CLI's local session storage (portable, no relay)

### `src/cli/` — CLI client

Commands: `orca ls`, `orca ready`, `orca sessions`, `orca close`, `orca plan submit`, `orca overseer poll`, `orca overseer decide`. Auto-detects and starts the daemon if not running.

### `src/shared/` — Utilities

- `clock.ts` — `Clock` interface with `SystemClock` (real) and `FakeClock` (test) implementations

## Guardrails

Tasks are blocked if their title or labels match sensitive patterns:

| Guardrail | Matched patterns |
|---|---|
| `schema` | `schema` |
| `migration` | `migrat` |
| `auth` | `auth`, `login`, `password`, `token` |
| `payments` | `payment`, `billing`, `stripe`, `invoice` |
| `destructive` | `delete`, `drop`, `truncate`, `rm -rf`, `destroy` |

Cleared per-mission via `cleared_guardrails` array. Autonomy L2/L3 permits tasks matching cleared guardrails; L0/L1 blocks them regardless.

An additional **overseer LLM gate** (when configured) consults an LLM or parked agent for guardrail-triggering tasks before dispatch. A denial or destructive verdict escalates the task to `blocked`.

## Autonomy levels

| Level | Name | Behavior |
|---|---|---|
| L0 | Manual | Guardrail-triggering tasks blocked regardless of clearance |
| L1 | Semi-autonomous | Same as L0 — no auto-spawn by the engine |
| L2 | Autonomous | Agent operates within cleared guardrails, auto-approves known prompts |
| L3 | Full autonomy | Same as L2 — prompts auto-cleared, no human needed |

L2/L3 auto-spawn ready tasks on the engine tick. L0/L1 won't auto-spawn — tasks must be launched manually via the API.

## Autopilot modes

`POST /tasks/plan` supports two backends:

1. **Relay backend** (default) — the planner LLM (`config.autopilot.model`) decomposes the goal via `RelayClient`. Requires an API key.

2. **Agent backend** — when `config.autopilot.pilotExec` is set, spawns a **Pilot** agent in the repo. The Pilot reads the codebase and submits its plan via `orca plan submit`. No API key needed for planning (the agent brings its own model).

A **parked Overseer agent** (`config.autopilot.overseerExec`) can replace the relay-based decision backend: one long-polling agent per active mission answers task/prompt/review decisions through the `decisionQueue`.

## Data flow

```
                                    ┌───────────┐
                                    │   Client   │
                                    │ (CLI/Web)  │
                                    └─────┬─────┘
                                          │ HTTP/SSE
                                          ▼
                               ┌──────────────────┐
                               │   Hono Server    │
                               │   port 4400      │
                               └──────┬───────────┘
                                      │
              ┌───────────────────────┼───────────────────────┐
              ▼                       ▼                       ▼
      ┌──────────────┐      ┌──────────────────┐     ┌──────────────┐
      │  TaskStore   │      │  MissionEngine   │     │   EventBus   │
      │  (CRUD)      │      │  (90s tick)      │     │  (SSE push)  │
      └──────┬───────┘      └──────┬───────────┘     └──────────────┘
             │                     │
             │            ┌────────▼────────┐
             │            │   Guardrails    │
             │            │   + Routing     │
             │            │   + Decision    │
             │            └────────┬────────┘
             │                     │
             │            ┌────────▼────────┐
             │            │  SpawnService   │
             │            │  (tmux launch)  │
             │            └────────┬────────┘
             │                     │
             │            ┌────────▼────────┐
             │            │    Deriver      │
             │            │  (5s poll loop) │
             │            └────────┬────────┘
             │                     │
             ▼                     ▼
      ┌──────────────────────────────────────┐
      │           SQLite (WAL)               │
      │  tasks / missions / agents / users   │
      └──────────────────────────────────────┘
```

Additional parallel loops (not pictured):
- **Scheduler** (30s) — reads tasks directly from TaskStore
- **Janitor** (60s) — reads tmux sessions, checks task status
- **Stuck detector** (60s) — reads tmux sessions + TaskStore, reverts/escalates

## Access control / multi-tenancy

With a `userProjects` store present (multi-user mode):

- A global middleware rejects non-admins not assigned to the daemon's project on the tasks/missions/sessions/activity/events surface (403).
- Per-route `canAccessProject` / `accessibleProjects` / `resolveTarget` / `missionAccessible` filter list endpoints and gate item operations + project file/git endpoints.
- A per-user model allow-list (`allowed_execs`) restricts which exec a non-admin may use.
- Admins and open/single-user mode (no `userProjects`) pass everything unrestricted.

## Testing

Tests use Vitest with fake implementations:

- `FakeTmuxDriver` — in-memory session simulation
- `FakeClock` — deterministic time control
- `FakeInference` — predictable LLM responses

This allows full integration-style tests without real tmux or network dependencies.

Daemon tests: ~232 `it`/`test` cases in `tests/`. Web tests: ~236 cases in `web/tests/` (Vitest + React Testing Library).
