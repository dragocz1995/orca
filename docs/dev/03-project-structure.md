# Project Structure

## `src/` — Daemon core

```
src/
├── advisor/            Per-user advisor service (tmux-spawned CLI agent)
├── api/                REST API (Hono)
│   ├── routes/         14 route families (see docs/dev/api/)
│   ├── schemas/        Zod validation schemas for each family
│   ├── services/       PlanService, ReviewService, SessionService, AskService, GuideService, SkillService
│   ├── auth.ts         Bearer-only auth middleware
│   ├── context.ts      RouteContext (shared deps + access predicates)
│   ├── deps.ts         ServerDeps interface (everything injected into the API)
│   ├── eventProject.ts Resolve events to project IDs (for tenancy scoping)
│   ├── middleware.ts    Auth guards + agent capability gate + project access gate
│   ├── server.ts       createServer() — builds the Hono app
│   ├── sse.ts          EventBus + OrcaEvent types
│   ├── validation.ts   parseBody helper (Zod → clean 400)
│   └── version.ts      ORCA_VERSION + installed-at timestamps
├── brain/              Embedded brain (PI agent)
│   ├── brainService.ts Start/stop/send/stream/compact
│   ├── worker/         BrainWorkerService — runs `orca:` tasks in-process
│   ├── config.ts       Resolves brain providers from Orca config
│   ├── models.ts       Lists available models, probes OpenAI-compatible endpoints
│   ├── oauth.ts        BrainOAuthManager — connect Anthropic/Copilot/OpenAI accounts
│   ├── personality.ts  Per-user personality profiles
│   ├── memoryService.ts Vector retrieval + anti-duplication
│   └── ...
├── cli/                `orca` CLI entry point
│   ├── index.ts        Main entry, command routing
│   ├── commands.ts     Subcommand definitions
│   ├── chat/           Interactive chat (PI-based)
│   ├── install/        `orca install` — first-run setup wizard
│   ├── setupWizard.ts  Guided config setup
│   └── ...
├── daemon/             Daemon bootstrap + entry
│   ├── bootstrap.ts    buildApp() — wires everything, starts timer loops
│   ├── index.ts        serve() — starts Hono + WebSocket + timers
│   └── uniqueName.ts   Agent name generation
├── deriver/            Agent pane watcher (auto-approve prompts, detect idle)
├── embeddings/         EmbeddingService + EmbeddingQueue (OpenAI-compatible /v1/embeddings)
├── git/                GitReader — read repo status for the API
├── inference/          RelayClient — LLM API calls for planner/overseer
├── integrations/        CLI detection, GitHub auth, project file ops, usage tracking
├── mcp/                MCP server — lets the advisor control Orca with tools
├── overseer/            Mission orchestration
│   ├── missionEngine.ts Engage/tick/pause/disengage missions
│   ├── missionGit.ts   PR-native git lifecycle (worktrees, commits, PRs)
│   ├── scheduler.ts    Auto-start tasks with met dependencies
│   ├── planner.ts      Goal decomposition (relay or agent backend)
│   ├── pilotAgent.ts   Agent-mode planning (spawns a pilot task)
│   ├── overseerAgent.ts Agent-mode overseer (parks in tmux, polls decisions)
│   ├── decision.ts     Auto-approve/escalate logic per autonomy level
│   ├── decisionQueue.ts Per-mission decision queue
│   ├── stuckDetector.ts Detect dead agents, relaunch or escalate
│   ├── livenessSweep.ts Universal agent liveness sweep
│   └── ...
├── plugins/            Plugin loader + contribution reports
├── prompts/            Markdown prompt templates (planner, overseer, advisor, …)
├── push/               Web-push notifications (VAPID)
├── shared/             Utilities: logger, clock, id, keyedMutex, execs, etc.
├── spawn/              SpawnService — launch agents in tmux
├── store/              SQLite stores (tasks, missions, users, config, brain, memory, …)
├── terminal/           WebSocket terminal stream + ticket store
└── tmux/               TmuxDriver — control tmux sessions programmatically
```

## `web/` — Next.js frontend

```
web/
├── app/
│   ├── api/            BFF proxy (catch-all + login/logout + ws-config)
│   ├── dash/           Dashboard page
│   ├── kanban/         Kanban board
│   ├── tasks/          Task detail view
│   ├── sessions/       Live tmux sessions
│   ├── memory/         Memory management
│   ├── settings/       Admin settings
│   ├── projects/       Project management
│   ├── users/          User management
│   ├── escalations/    Escalated asks inbox
│   ├── timeline/       Activity timeline
│   ├── onboarding/    First-run setup
│   ├── account/        Profile, CLI settings, prompts
│   ├── terminal/       Interactive terminal (WebSocket)
│   └── ...
├── components/         Shared React components
├── modules/            Business logic hooks + data fetching
├── lib/                Utilities (proxy helpers, etc.)
├── deploy/             Deployment configs
├── public/             Static assets
├── tests/              Frontend tests
├── next.config.ts
└── proxy.ts            Cache-Control middleware (no-cache for app shell)
```

## `tests/` — Test suites

```
tests/
├── api/                API route tests (Hono app test harness)
├── brain/              Brain service tests
├── cli/                CLI tests
├── daemon/             Daemon bootstrap tests
├── deriver/            Deriver/pane-watcher tests
├── embeddings/         Embedding service tests
├── inference/          Relay client tests
├── integration/        End-to-end integration tests
├── overseer/           Mission engine, planner, scheduler tests
├── plugins/            Plugin loading tests
├── push/               Push notification tests
├── shared/             Shared utility tests
├── spawn/              Spawn service tests
├── store/              Store unit tests
├── terminal/           Terminal WS tests
├── tmux/               Tmux driver tests
└── helpers/            Test utilities and mock factories
```

## `docs/`

- `docs/site/` — User-facing web docs (served on orca.dragocz.dev)
- `docs/dev/` — Developer docs (you are here; NOT served on the web)
- `docs/dev/api/` — Split API reference per route family

## `plugins/`

Bundled plugins shipped with Orca. Each has a manifest (`orca-plugin.json`) and an ESM entry point. Loaded at daemon startup; toggled via `config.plugins.enabled`.