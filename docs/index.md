# Orca Documentation

## Quick links

- [README.md](../README.md) — Top-level project overview, quick start, tech stack
- [API.md](API.md) — Full REST API reference with request/response examples and status codes
- [ARCHITECTURE.md](ARCHITECTURE.md) — System architecture, module descriptions, data flow, timer loops
- [CLI.md](CLI.md) — CLI commands (ls, ready, sessions, close, plan submit, overseer poll/decide)
- [CONCEPTS.md](CONCEPTS.md) — Domain model: tasks, missions, autonomy levels, guardrails, deriver, agent routing, event bus
- [DEVELOPMENT.md](DEVELOPMENT.md) — Setup guide, conventions, project structure, configuration, adding endpoints
- [DEPLOYMENT.md](DEPLOYMENT.md) — Production deployment: systemd, Docker, nginx reverse proxy, env vars, troubleshooting
- [GUIDES.md](GUIDES.md) — Advanced patterns: task↔session binding, goal decomposition, overseer gate, terminal repaint, ANSI parsing, task flow graph, calendar, toast, provider config, scheduled tasks, post-done review, async planning jobs
- [SECURITY.md](SECURITY.md) — Auth model, guardrails, decision engine, user management, multi-tenancy RBAC, infrastructure security
- [TESTING.md](TESTING.md) — Test architecture, fakes, writing tests, daemon + web test commands
- [WEB.md](WEB.md) — Web UI pages, components, data layer, real-time updates, design system, i18n


## Architecture overview

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
              ┌───────┼───────────────────────┐
              ▼       ▼                       ▼
      ┌──────────────┐   ┌──────────────────┐   ┌──────────────┐
      │  TaskStore   │   │  MissionEngine   │   │   EventBus   │
      │  (CRUD)      │   │  (90s tick)      │   │  (SSE push)  │
      └──────┬───────┘   └──────┬───────────┘   └──────────────┘
             │                  │
             │         ┌────────▼────────┐
             │         │   Guardrails    │
             │         │   + Routing     │
             │         │   + Decision    │
             │         └────────┬────────┘
             │                  │
             │         ┌────────▼────────┐
             │         │  SpawnService   │
             │         │  (tmux launch)  │
             │         └────────┬────────┘
             │                  │
             │         ┌────────▼────────┐
             │         │    Deriver      │
             │         │  (5s poll loop) │
             │         └────────┬────────┘
             │                  │
             ▼                  ▼
      ┌──────────────────────────────────────┐
      │           SQLite (WAL)               │
      │  tasks / missions / agents / users   │
      └──────────────────────────────────────┘
```

Additional parallel loops: **Scheduler** (30s), **Janitor** (60s), **Stuck detector** (60s).

## Key concepts

- **Tasks** — units of work, tree structure via `parent_id`, dependency DAG via `task_deps`
- **Missions** — group tasks under an epic with autonomy level (L0–L3) and `max_sessions` cap
- **Guardrails** — regex-based safety checks (schema, migration, auth, payments, destructive)
- **Overseeer** — decision gate: relay LLM or parked per-mission agent
- **Pilot** — repo-aware planning agent; submits phases via `orca plan submit`
- **Autopilot** — two backends: relay LLM or CLI agent (Pilot)
- **Deriver** — polls tmux panes every 5s, detects agent state, auto-approves known prompts
- **Event bus** — SSE for real-time UI updates; `GET /events`

## Timer loops

| Loop | Interval | Purpose |
|---|---|---|
| Overseer (engine tick) | 90 s | Tick active missions: pick ready tasks, check guardrails, spawn agents |
| Scheduler | 30 s | Launch due scheduled/autostart tasks |
| Janitor | 60 s | Kill zombie tmux sessions whose task is already closed/cancelled |
| Stuck detector | 60 s | Revert tasks whose agent died without `orca close` (bounded, escalate after 2 relaunch attempts) |
| Deriver | 5 s | Poll tmux panes, detect agent state, auto-approve known prompts |

## Run / build / test

```bash
# Daemon
npm install && npm run build        # compile TS → dist/
npm run serve                       # dev mode (direct TS)
npm test                            # daemon tests (~232)
node dist/daemon/index.js           # production start

# Web
cd web && npm install
npm run dev                         # Next.js dev server
npm test                            # web tests (~236)
npm run build && npm start          # production
```
