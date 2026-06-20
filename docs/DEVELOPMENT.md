# Development

## Prerequisites

- **Node.js** ≥22 (ESM)
- **tmux** ≥3.x (for running agents)
- **npm**

## Setup

```bash
git clone <repo> && cd orca
npm install
npm run build
```

## Development workflow

### Run the daemon (direct TS, no build)

```bash
npm run serve
```

Uses `--experimental-strip-types` for direct TS execution. Starts on `http://localhost:4400`.

### Build + run

```bash
npm run build
node dist/daemon/index.js
```

Compiles TypeScript to `dist/` and copies `src/store/schema.sql` and `src/overseer/autopilotPrompt.md`. The CLI binary is at `dist/cli/index.js`.

### Run tests

```bash
npm test            # single run (~232 daemon tests)
npm run test:watch  # watch mode
```

Tests use Vitest with fake implementations for tmux, clock, and inference — no external dependencies.

### CLI (without global link)

```bash
node dist/cli/index.js ls
node dist/cli/index.js ready
node dist/cli/index.js sessions
node dist/cli/index.js close <taskId> --summary "..." --outcome ok
```

Or link globally: `npm link` then `orca ls`.

The CLI auto-starts the daemon if it isn't running (set `ORCA_AUTOSTART=0` to disable).

### Web frontend

```bash
cd web
npm install
npm run dev     # Next.js dev server (turbopack)
npm test        # Vitest (~236 web tests)
npm run build   # Production build
```

Connects to the daemon at `NEXT_PUBLIC_ORCA_URL` (default `http://localhost:4400`).

**Gotcha:** a stale turbopack dev server on :4500 serves broken CSS chunks. Fix by killing the :4500 pid and running `next start` (not `next dev`).

---

## Project conventions

### Code style

- **TypeScript** strict mode with `noUncheckedIndexedAccess`
- **ESM** only — no CommonJS
- No `any` types
- No static methods — constructor DI everywhere
- No comments in source code
- No dead code, no debug leftovers

### Architecture

- **Thin controllers** (`src/api/`), business logic in services
- **Constructor dependency injection** — all services receive their deps via constructor
- **Interface-driven** — `TmuxDriver`, `Clock`, `InferenceClient` have real and fake implementations
- **Single source of truth** — no parallel logic or duplicate systems

### Naming

- Files: `camelCase.ts`
- Classes: `PascalCase`
- Functions/variables: `camelCase`
- Constants: `UPPER_SNAKE_CASE`
- SQL identifiers: `snake_case`

### i18n (Internationalization)

User-facing strings in the web UI use the `useTranslation()` hook with CS and EN dictionaries:

- Dictionary files in `web/lib/i18n/dictionaries/` — edit `cs.ts` and `en.ts` in parallel
- Every user-facing string must exist in BOTH languages
- The `LanguageProvider` context reads the locale from `localStorage` and provides `t` (translations) + `setLocale`
- New keys should be added under the appropriate namespace (nav, tasks, missions, etc.) in both dictionaries

### Testing

- Tests mirror `src/` structure in `tests/`
- Fake implementations in test files (not shared)
- Deterministic time via `FakeClock`
- No real tmux or network calls in tests
- Web tests in `web/tests/` use Vitest + React Testing Library + MSW

---

## Project structure

```
src/
├── api/              Hono REST router + SSE event bus
│   ├── server.ts     Route definitions (~854 lines)
│   ├── auth.ts       Bearer token auth middleware
│   └── sse.ts        EventBus implementation
├── cli/              CLI client
│   ├── index.ts      Entrypoint with daemon autostart + commands
│   └── client.ts     HTTP client for the daemon API
├── daemon/           Daemon bootstrap
│   ├── index.ts      HTTP server entrypoint
│   ├── bootstrap.ts  DI wiring
│   └── uniqueName.ts Agent name generation
├── deriver/          Agent terminal monitoring
│   ├── deriver.ts    5s poll loop, state detection
│   ├── shellPatterns.ts  Prompt detection per program
│   └── types.ts      Signal types
├── git/              Git integration
│   └── gitReader.ts  Read git status, branches, commits
├── inference/        LLM inference relay
│   ├── client.ts     RelayClient + FakeInference
│   └── types.ts      Inference types
├── integrations/     External integrations
│   ├── hermesInstall.ts  Hermes plugin installer
│   ├── projectFiles.ts   File tree, read/write/diff for Monaco editor
│   ├── cliDetection.ts   CLI detection for onboarding
│   └── usage/            Token/cost reader per executor CLI
├── overseer/         Orchestration engine
│   ├── missionEngine.ts  Tick loop, spawn logic
│   ├── guardrails.ts     Regex-based safety checks
│   ├── routing.ts        Task → agent routing
│   ├── scheduler.ts      Scheduled task execution
│   ├── decision.ts       LLM-based prompt decision engine
│   ├── decisionQueue.ts  Per-mission FIFO of awaitable decisions
│   ├── janitor.ts        Zombie session cleanup
│   ├── planner.ts        AI goal decomposition
│   ├── planJob.ts        Async planning job registry
│   ├── pilotAgent.ts     Pilot agent spawn logic
│   ├── overseerAgent.ts  Parked overseer agent lifecycle
│   └── stuckDetector.ts  Stuck task detection + relaunch
├── shared/           Utilities
│   └── clock.ts      Clock interface (system + fake)
├── spawn/            Agent launcher
│   ├── spawn.ts      SpawnService
│   └── commandBuilder.ts  Agent command construction
├── store/            SQLite data layer
│   ├── db.ts         Database connection
│   ├── schema.sql    Table definitions
│   ├── types.ts      Shared store types
│   ├── taskStore.ts  Task CRUD + dependency tree
│   ├── missionStore.ts  Mission CRUD
│   ├── missionDetail.ts  Composite mission query
│   ├── agentStore.ts    Agent registry
│   ├── readiness.ts     Task readiness computation
│   ├── configStore.ts   Daemon configuration
│   ├── userStore.ts     User management + auth tokens
│   ├── userProjectStore.ts  User ↔ project assignments
│   ├── projectStore.ts  Project CRUD
│   └── eventStore.ts    Activity event log
└── tmux/             tmux abstraction
    ├── types.ts      TmuxDriver interface
    ├── driver.ts     RealTmuxDriver
    └── fakeDriver.ts In-memory fake for tests
tests/                Mirrors src/ structure (~232 tests)
web/                  Next.js frontend (~236 tests)
docs/                 Documentation tree
```

---

## Auth system

Auth is optional. When the server factory receives a `UserStore`, it enables:

- `POST /auth/login` — public endpoint, returns bearer token
- `POST /auth/logout` — revokes current token
- `GET /auth/me` — returns current user
- `PATCH /auth/me` — update profile (name, email, default_exec)
- `POST /auth/me/avatar` — upload avatar image
- `GET /users`, `POST /users`, `PATCH /users/:id`, `DELETE /users/:id` — user management
- `authMiddleware` on all other routes (401 if no valid token)

Passwords use scrypt with random 16-byte salt. Tokens are 32-byte hex strings stored in `auth_tokens` table.

### Multi-tenancy / RBAC

With a `userProjects` store present (multi-user mode), access is gated three ways:

1. **Global gate** — non-admin users must be assigned to the daemon's home project to access task/mission/session/activity/event routes
2. **Per-project gate** — users only see/operate projects they're assigned to
3. **Per-user exec allowlist** — `allowed_execs` restricts which exec strings a non-admin may use

Admins and open/single-user mode (no `userProjects`) pass everything unrestricted.

---

## AI planning (autopilot)

The `POST /tasks/plan` endpoint supports two backends:

### Relay backend (default)

1. **Prompt construction** — `planPrompt(goal, guidance)` builds a system prompt
2. **LLM call** — sends via `RelayClient` using `config.autopilot.model`
3. **Parse** — `parsePhases(text)` extracts JSON array, validates each phase
4. **Task creation** — creates epic + chained child tasks with sequential deps
5. **Optional engage** — if `engage: true`, creates and starts a mission

### Agent backend (Pilot)

When `config.autopilot.pilotExec` is set, spawns a **Pilot** agent in the repo. The Pilot reads the codebase and submits phases via `orca plan submit`. No API key needed for planning.

### Manual mode

Pass `phases: [{title, type?}]` — no LLM, no key needed. Synchronous 201 response.

---

## Adding a new endpoint

1. Add the handler in `src/api/server.ts`
2. Add the corresponding method in `web/lib/orcaClient.ts`
3. Add query/mutation hooks in `web/lib/queries.ts` / `web/lib/mutations.ts`
4. Add TypeScript types in `web/lib/types.ts` if needed
5. Wire any new service dependencies through `src/daemon/bootstrap.ts`
6. Add tests in `tests/`

## Adding a new guardrail

1. Add the guardrail name to `GUARDRAILS` in `src/overseer/guardrails.ts`
2. Add the regex pattern in `PATTERNS`
3. No other changes needed — guardrails are picked up automatically

---

## Configuration

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `ORCA_URL` | `http://localhost:4400` | Daemon URL for CLI |
| `ORCA_TOKEN` | — | API token for CLI requests |
| `ORCA_AUTOSTART` | `1` | Enable CLI daemon autostart |
| `ORCA_DB` | `~/.config/orca/orca.db` | SQLite database path |
| `ORCA_PORT` | `4400` | Daemon HTTP port |
| `ORCA_PROJECT` | `orca` | Default project slug |
| `ORCA_PROJECT_PATH` | `cwd` | Default project working directory |
| `ORCA_RELAY_URL` | — | LLM relay base URL |
| `ORCA_RELAY_KEY` | — | LLM relay API key |
| `ORCA_RELAY_MODEL` | `gpt-4o-mini` | LLM relay model |
| `ORCA_BOOTSTRAP_USER` | — | Initial admin username |
| `ORCA_BOOTSTRAP_PASS` | — | Initial admin password |
| `ORCA_ALLOW_OPEN` | — | Allow open (no auth) mode when set to `1` |
| `NEXT_PUBLIC_ORCA_URL` | `http://localhost:4400` | Daemon URL for web UI |

### Runtime config

Stored in SQLite `settings` table. Managed via `GET/PUT /config` API:

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
    "prompt": "Decompose the following goal into ordered implementation phases..."
  },
  "providers": {
    "claude-code": { "bin": "claude", "args": "" },
    "opencode": { "bin": "opencode", "args": "" },
    "codex": { "bin": "codex", "args": "" }
  }
}
```

---

## Database

SQLite with WAL mode. Schema in `src/store/schema.sql`.

### Tables

```sql
projects  (id, slug, path, notes)
tasks     (id, project_id, title, type, status, priority, parent_id, labels, description, scheduled_at, autostart, result_summary, outcome, closed_at, created_at)
task_deps (task_id, depends_on_id)
agents    (id, project_id, name, program, model, last_active_ts)
missions  (id, epic_id, autonomy, max_sessions, cleared_guardrails, state, started_at)
settings  (id, data)  -- JSON blob for runtime config
users     (id, username, password_hash, is_admin, allowed_execs, name, email, default_exec, avatar, created_at)
auth_tokens (token, user_id, created_at)
events    (id, ts, type, target, detail)
user_projects (user_id, project_id)
```

---

## Guardrails

Tasks are blocked if their title or labels match sensitive patterns:

| Guardrail | Pattern |
|---|---|
| `schema` | `schema` |
| `migration` | `migrat*` |
| `auth` | `auth`, `login`, `password`, `token` |
| `payments` | `payment`, `billing`, `stripe`, `invoice` |
| `destructive` | `delete`, `drop`, `truncate`, `rm -rf`, `destroy` |

Blocked tasks are skipped by the mission engine unless the guardrail is cleared in the mission's `cleared_guardrails`. An overseer LLM gate can further deny dispatch.

---

## Agent routing

Tasks specify executors via labels (`exec:<spec>`). Resolution (`src/overseer/routing.ts`):

- `exec:sonnet` → `{ program: 'claude-code', model: 'sonnet' }`
- `exec:opencode:<model>` → `{ program: 'opencode', model: '<model>' }`
- `exec:codex:<model>` → `{ program: 'codex', model: '<model>' }`
- `exec:claude:<model>` → `{ program: 'claude-code', model: '<model>' }`
- Value contains `/` (e.g. `ollama/deepseek-v4-flash`) → `{ program: 'opencode', model: value }`
- No label → configured fallback (default: `claude-code` / `sonnet`)

Every exec must be in `config.allowedExecs` or the API rejects it.
