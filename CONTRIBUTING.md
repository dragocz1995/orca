# Contributing to Elowen

Thanks for your interest in improving Elowen! This guide covers how to get set up
and what we expect from contributions.

## Getting started

Requires **Node ≥ 22** and **tmux**.

```bash
# Daemon
npm install
npm test
npm run build

# Web UI
cd web
npm install
npm test
```

Run the daemon from the source checkout during development:

```bash
npm run serve      # starts the REST API from src/ (no build step)
cd web && npm run dev   # the Next.js dev server, proxying /api to the daemon
```

## Project layout

- `src/` — the daemon: stores, overseer (mission engine, planner, scheduler, decision
  engine, janitor), spawn/tmux, deriver, REST API (`src/api`, split into route families
  under `src/api/routes`, services under `src/api/services`, zod schemas under
  `src/api/schemas`).
- `web/` — the Next.js front end (feature modules under `web/modules`).
- `docs/` — full documentation hub ([`docs/index.md`](./docs/index.md)) with API,
  architecture, concepts, CLI, development, deployment, web UI, and testing guides.

## npm scripts

Run from the repo root unless noted:

| Script | What it does |
| --- | --- |
| `npm test` | The daemon test suite (vitest). |
| `npm run build` | Type-check and emit the daemon to `dist/`. |
| `npm run serve` | Run the daemon from `src/` without building. |
| `npm run lint` | ESLint over the codebase. |
| `npm run typecheck` | `tsc --noEmit` — types only, no output. |
| `npm run deadcode` | knip — unused files/exports/dependencies. |
| `npm run depcruise` | dependency-cruiser — import-boundary + no-cycle rules. |
| `npm run check` | All static gates: lint + deadcode + depcruise + typecheck. |
| `cd web && npm test` | The web test suite. |
| `cd web && npm run dev` | The Next.js dev server. |
| `cd web && npm run build` | Production build of the web UI. |

CI runs the same `lint`/`deadcode`/`depcruise` gates plus both build+test suites, so
running `npm run check` locally before pushing catches most failures early.

## Dev vs. production

- **Development** happens in a source checkout (this repo). Its local SQLite database is a
  throwaway dev database — don't treat it as production data. Build and test here.
- **Production** runs from the **published npm package** `elowen` (installed globally),
  not from a checkout's `dist/`. So a code change reaches a deployment only after a new
  version is published and the global install is updated — building locally is enough for
  development and review.

## Guidelines

- **Tests required.** New behavior needs tests. Run `npm test` (daemon) and
  `cd web && npm test` (web) before opening a PR; both suites and `tsc` must be green.
- **Keep it typed.** TypeScript strict mode, no `any`. No empty `catch` blocks.
- **Root cause, not workarounds.** Fix the underlying issue; avoid dead code and duplication.
- **Validate request bodies** with a zod schema (`src/api/schemas`) via `parseBody`, rather
  than hand-rolled `typeof` checks.
- **Small, focused PRs.** One concern per PR with a clear description.
- **Match the surrounding style.** Follow the conventions already in the file you're editing.

## Troubleshooting

- **`tmux` not found / terminal tests fail.** Install tmux — the real-driver test and live
  sessions shell out to it.
- **Web type or import errors after pulling.** Re-run `npm install` in both the root and
  `web/`; the two have separate dependency trees.
- **`depcruise` or `knip` can't resolve web imports.** They span `web/`, so install its
  dependencies (`cd web && npm install`) before running the root gates.
- **Stale UI not updating live.** The web UI is driven by the daemon's SSE event stream
  (`/events`); if the daemon restarted, the browser EventSource reconnects on its own with
  backoff — a manual refresh is only needed if it stays disconnected.

## Pull requests

1. Fork and create a feature branch.
2. Make your change with tests.
3. Ensure `npm run check`, `npm test`, and `cd web && npm test` pass.
4. Open a PR describing the change and the motivation.

By contributing, you agree that your contributions are licensed under the
[MIT License](./LICENSE).
