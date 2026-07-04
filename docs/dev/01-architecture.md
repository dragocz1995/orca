# Architecture

Orca is an autonomous agent platform with orchestration. A long-running daemon exposes a REST+WebSocket API (Hono on port 4400), a Next.js web UI proxies to it via a BFF (backend-for-frontend), and the CLI (`orca`) drives both.

## High-level data flow

```
Browser → Next.js BFF (web/) → Daemon API (src/api/) → Stores (src/store/)
CLI (src/cli/) ──────────────────────────────────────↗
Agent (spawned tmux/embedded) ───────────────────────↗
```

The browser never talks to the daemon directly. The BFF (`web/app/api/[...path]/route.ts`) reads an httpOnly session cookie, injects it as a `Bearer` token, and streams the daemon response back — SSE frames included. The token never reaches browser JS.

## Daemon bootstrap (`src/daemon/`)

`buildApp()` in `bootstrap.ts` wires every store, service and timer:

1. Opens SQLite (`:memory:` in tests, `~/.config/orca/orca.db` in production).
2. Creates stores: `TaskStore`, `MissionStore`, `AgentStore`, `ConfigStore`, `UserStore`, `ProjectStore`, `EventStore`, `NoteStore`, `BrainStore`, `PersonalityStore`, `MemoryStore`, `MemoryCategoryStore`, `TaskUsageStore`, `UserProjectStore`, `UserPromptStore`, `UserSettingStore`, `PushSubscriptionStore`, `MissionPrStore`.
3. Builds services: `SpawnService`, `MissionEngine`, `MissionGit`, `Scheduler`, `Deriver`, `BrainService`, `BrainWorkerService`, `AdvisorService`, `EmbeddingService`, `EmbeddingQueue`, `MemoryService`, `MemoryCategorizer`, `PersonalityService`, `PromptService`.
4. Assembles `ServerDeps` and calls `createServer()` (Hono app).
5. Starts timers (see below).

### Timer loops

Started by `startLoops()` (all intervals in milliseconds):

| Loop | Interval | Purpose |
|------|----------|---------|
| Mission engine tick | 90 000 | Tick every active mission (spawn/advance/close phases) |
| Scheduler | 30 000 | Auto-start scheduled tasks, reconcile `ready` |
| Janitor | 60 000 | Reap finished tmux sessions |
| Stuck detector | 60 000 | Revert dead-agent tasks, relaunch (max 2×), then escalate |
| Overseer watchdog | 60 000 | Re-park missing overseers, kill orphan sessions |
| Agent liveness sweep | every `DECISION_SWEEP_MS` | Detect idle agents, nudge/restart/escalate |
| Token purge | 3 600 000 | Purge expired auth tokens |
| Event purge | 3 600 000 | Purge activity events older than 30 days |
| Ticket sweep | 60 000 | Expire unredeemed WebSocket tickets |
| PR feedback sweep | 60 000 | Poll open PRs for actionable review feedback |
| Brain worker watchdog | — | Restart crashed embedded-brain workers |
| Embed queue drain | 30 000 | Fill missing/stale memory vectors in background |

## REST API (`src/api/`)

The Hono app is built in `server.ts`. `createServer()` adds:

- Global CORS
- A Zod/JSON error handler (400 for malformed bodies, 500 fallback)
- `GET /health` and `GET /setup` (unauthenticated)
- Auth + tenancy middleware (Bearer-only; agent-scope capability gate; project-scoped access control)
- 13 route families registered via `registerRoutes()`

See [docs/dev/api/](api/) for the full endpoint reference.

### Auth model

- **Bearer-only**: the daemon never reads tokens from query strings (they leak into logs/referrers).
- **Agent tokens**: scoped to close tasks, submit plans, poll overseer decisions, read task/session listings, and leave handoff notes. Cannot reach admin surfaces (users, config, project registration).
- **Project gating**: non-admin users can only access tasks/missions/sessions in projects assigned to them. Admins see everything.
- **Setup mode**: when no users exist yet, the API is fully open (for onboarding).

### EventBus (`src/api/sse.ts`)

A simple pub/sub that broadcasts `OrcaEvent` objects. The SSE endpoint (`GET /events`) filters events per subscriber by project access. Event types: `signal`, `mission`, `task`, `review`, `decision`, `message`, `ask`, `change`, `plan`.

## Services (`src/api/services/`)

| Service | File | Purpose |
|---------|------|---------|
| `PlanService` | `planService.ts` | Persist plan jobs as epics + child tasks |
| `ReviewService` | `reviewService.ts` | Post-done review: gate, verdict, commit/self-heal/escalate |
| `SessionService` | `sessionService.ts` | Manual session launch (atomic checkout claim + spawn) |
| `AskService` | `askService.ts` | `orca ask` worker↔autopilot exchange |
| `GuideService` | `guideService.ts` | Render the context-aware control guide for `orca help` |
| `SkillService` | `skillService.ts` | Install/verify `orca-workflow` skill into agent providers |

## Overseer (`src/overseer/`)

The overseer is the autopilot's decision engine:

- **MissionEngine** (`missionEngine.ts`): Manages mission lifecycle — engage (spawn agents), tick (advance phases), pause/resume/disengage.
- **MissionGit** (`missionGit.ts`): PR-native git lifecycle — isolated worktrees, per-phase commits, PR open/merge.
- **Scheduler** (`scheduler.ts`): Auto-starts tasks that are `open` and have all dependencies met.
- **Deriver** (`src/deriver/`): Watches tmux panes for agent prompts, auto-approves/escalates based on autonomy level.
- **DecisionQueue** (`decisionQueue.ts`): Per-mission queue the parked overseer agent polls via `GET /missions/:id/overseer/next`.
- **StuckDetector** + **LivenessSweep**: Detect dead agents, relaunch (max 2×), then escalate to human.

## Brain (`src/brain/`)

Per-user embedded AI agent (PI-based). Key pieces:

- **BrainService** (`brainService.ts`): Start/stop/switch model, send messages, subscribe to events, compact context.
- **BrainWorkerService** (`worker/brainWorker.ts`): Runs tasks with `orca:` exec spec as in-process brain sessions (no tmux).
- **BrainStore** (`src/store/brainStore.ts`): Persists conversation history.
- **PersonalityService** (`personalityService.ts`): Per-user, per-platform personality profiles.
- **MemoryService** (`memoryService.ts`): Vector retrieval + anti-duplication for long-term memory.
- **EmbeddingQueue** (`src/embeddings/embedQueue.ts`): Background embed drain for memory vectors.

## Web UI (`web/`)

A Next.js 16 app (App Router). Key directories:

- `web/app/` — Pages: dash, kanban, tasks, sessions, memory, settings, projects, users, escalations, timeline, onboarding, account
- `web/app/api/` — BFF catch-all proxy + login/logout + ws-config
- `web/modules/` — Business logic hooks and data fetching
- `web/components/` — Shared UI components
- `web/lib/proxy.ts` — BFF helper (session cookie → Bearer token injection)

The proxy (`web/app/api/[...path]/route.ts`) validates same-origin on mutating verbs, injects the token, and streams the response. SSE flows through unchanged.