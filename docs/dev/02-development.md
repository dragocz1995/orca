# Development

## Prerequisites

- Node.js ≥ 22
- npm
- tmux (for agent session management)
- git

## Clone & install

```bash
git clone https://github.com/dragocz1995/orcasynth.git
cd orcasynth
npm install
```

## Build

```bash
npm run build
```

Compiles TypeScript to `dist/`, copies `schema.sql`, `prompts/`, and `plugins/`.

## Type checking

```bash
npm run typecheck
```

Runs `tsc --noEmit`. CI-enforced; must pass before merge.

## Lint

```bash
npm run lint          # check
npm run lint:fix      # auto-fix
```

ESLint with `@typescript-eslint`, React hooks, and unused-imports plugins.

## Dependency graph

```bash
npm run depcruise     # check for circular deps
npm run depgraph      # generate SVG (needs graphviz)
```

## Dead code detection

```bash
npm run deadcode
```

Uses Knip. CI-enforced.

## Full check

```bash
npm run check
```

Runs lint + deadcode + depcruise + typecheck. Equivalent to CI.

## Running the daemon locally

```bash
npm run serve
```

Starts the daemon via `node --experimental-strip-types src/daemon/index.ts`. Uses defaults:
- DB: `~/.config/orca/orca.db`
- Port: 4400 (`ORCA_PORT`)
- Host: `127.0.0.1` (`ORCA_HOST`)

### Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `ORCA_DB` | `~/.config/orca/orca.db` | SQLite database path |
| `ORCA_PORT` | `4400` | Daemon listen port |
| `ORCA_HOST` | `127.0.0.1` | Daemon listen host |
| `ORCA_PROJECT_PATH` | `process.cwd()` | Default project checkout path |
| `ORCA_RELAY_URL` | — | LLM relay base URL |
| `ORCA_RELAY_KEY` | — | LLM relay API key |
| `ORCA_RELAY_MODEL` | `gpt-4o-mini` | LLM relay model |
| `ORCA_BOOTSTRAP_USER` | — | First admin username (setup mode) |
| `ORCA_BOOTSTRAP_PASS` | — | First admin password (setup mode) |
| `ORCA_ALLOW_OPEN` | — | Set to `1` for open/single-user mode |
| `ORCA_CLI` | — | Override the `orca` CLI path for spawned agents |

## Running the web UI

```bash
npm run build:web
cd web && npm install && npm run dev
```

The web app runs on port 3000 by default and proxies API calls to the daemon at `localhost:4400`.

## Commit conventions

- Use conventional commit prefixes: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`.
- Keep commits focused and atomic.
- Write a clear subject line (imperative mood, ≤ 72 chars).

## Code style

- TypeScript strict mode (`strict: true`).
- No `any` types.
- Constructor DI — no static methods for services.
- PHP-style: `declare(strict_types=1)` equivalent is the TS strict config.
- Dead code, debug leftovers, and duplication are forbidden.
- Single source of truth for each concept.