# Orca Documentation

[![CI](https://github.com/dragocz1995/orcasynth/actions/workflows/ci.yml/badge.svg)](https://github.com/dragocz1995/orcasynth/actions/workflows/ci.yml)

## Quick links

| Document | Contents |
|---|---|
| [README.md](../README.md) | Top-level project overview, quick start, tech stack |
| [API.md](API.md) | Full REST API reference with request/response examples and status codes |
| [ARCHITECTURE.md](ARCHITECTURE.md) | System architecture, module descriptions, data flow, timer loops |
| [CLI.md](CLI.md) | CLI commands (ls, ready, sessions, close, plan submit, overseer poll/decide) |
| [CONCEPTS.md](CONCEPTS.md) | Domain model: tasks, missions, autonomy levels, overseer, deriver, agent routing, event bus |
| [DEVELOPMENT.md](DEVELOPMENT.md) | Setup guide, conventions, project structure, configuration, adding endpoints |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Production deployment: systemd, Docker, nginx reverse proxy, env vars, troubleshooting |
| [GUIDES.md](GUIDES.md) | Advanced patterns: task↔session binding, goal decomposition, overseer gate, deriver prompt detection, scheduled tasks, stuck detector, post-done review, async planning jobs, event store, executor routing |
| [SECURITY.md](SECURITY.md) | Auth model, decision engine, user management, multi-tenancy RBAC, infrastructure security |
| [TESTING.md](TESTING.md) | Test architecture, fakes, writing tests, daemon + web test commands |
| [WEB.md](WEB.md) | Web UI pages, components, data layer, real-time updates, design system, i18n |

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
              │         │   Routing      │
              │         │   + Decision   │
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

Additional parallel loops: **Deriver** (5s), **Scheduler** (30s), **Janitor** (60s), **Stuck detector** (60s), **Overseer watchdog** (60s), **Token purge** (1h).

## Key concepts

- **Tasks** — units of work, tree structure via `parent_id`, dependency DAG via `task_deps`
- **Missions** — group tasks under an epic with autonomy level (L0–L3) and `max_sessions` cap (folded into Tasks UI)
- **Autonomy levels** — L0–L3 gate auto-spawn and prompt handling
- **Overseer** — decision gate: relay LLM or parked per-mission agent; centralized `gateVerdict()` threshold
- **Pilot** — repo-aware planning agent; submits phases via `orca plan submit`; prompt in `prompts/pilot.md`
- **Autopilot** — two backends: relay LLM or CLI agent (Pilot); phases from `prompts/planner.md` template
- **Per-model descriptions & autoModel** — write capability descriptions per model in Settings; flip "Autopilot picks the model" and the planner selects the best model per phase from those descriptions, validated against the allow-list
- **Deriver** — polls tmux panes every 5s, detects agent state via `shellPatterns.ts`, auto-approves via overseer gate
- **Event bus** — SSE for real-time UI updates; `GET /events`
- **Session info** — `classifySession()` classifies every `orca-*` session (agent / pilot / overseer) with structured identity
- **Projects** — built-in Monaco editor with file tree, read/write/diff; project picker in task/autopilot modals

## Prompt templates

All LLM prompts are stored as Markdown templates under `prompts/` and rendered at runtime via `src/prompts/index.ts` with `{{placeholder}}` variable substitution. The build copies the entire `prompts/` directory into `dist/prompts/`.

| Template | Used by |
|---|---|
| `planner.md` | Autopilot goal→phases decomposition (relay backend) |
| `planner-fallback.md` | Planner when no custom template is saved |
| `pilot.md` | Pilot agent (CLI-based planning) |
| `overseer.md` | Parked overseer agent (per-mission decision loop) |
| `worker.md` | Worker agent (general task execution) |
| `worker-phase.md` | Phase agent (epic child task execution) |
| `worker-epic-close.md` | Final-phase agent (also closes the parent epic) |
| `decision-header.md` | Overseer decision prompt header |
| `decision-prompt.md` | Overseer prompt-gate decision body |


## Timer loops

| Loop | Interval | Purpose |
|---|---|---|---|
| Overseer (engine tick) | 90 s | Tick active missions: pick ready tasks, spawn agents |
| Scheduler | 30 s | Launch due scheduled/autostart tasks |
| Janitor | 60 s | Kill zombie tmux sessions whose task is already closed/cancelled |
| Stuck detector | 60 s | Revert tasks whose agent died without `orca close` (bounded, escalate after 2 relaunch attempts) |
| Deriver | 5 s | Poll tmux panes, detect agent state, auto-approve known prompts via overseer gate |
| Overseer watchdog | 60 s | Re-park missing overseer agents for active/stalled missions (crash recovery) |
| Token purge | 1 h | Delete expired auth tokens (TTL from `config.security.tokenTtlDays`) |

See [ARCHITECTURE.md](ARCHITECTURE.md) for module details.

## Run / build / test

```bash
# Daemon
npm install && npm run build        # compile TS → dist/, copy schema.sql + prompts/
npm run serve                       # dev mode (direct TS via --experimental-strip-types)
npm test                            # daemon tests (~418)
node dist/daemon/index.js           # production start

# Web
cd web && npm install
npm run dev                         # Next.js dev server (turbopack)
npm test                            # web tests (~270)
npm run build && npm start          # production
```

CI runs both daemon and web jobs in parallel on every push/PR to `main` — see [`.github/workflows/ci.yml`](../.github/workflows/ci.yml).

## Codebase audit

A comprehensive security + robustness audit was performed across all layers (API, overseer, store, spawn, deriver, integrations, CLI, web data, web UI). The executive summary identifies 1 high, ~38 medium, and ~160 low-severity findings across 6 cross-cutting themes (auth surface, async error handling, zombie states, stringly-typed contracts, duplication, memory leaks).
