# Testing

## Run all tests

```bash
npm test
```

Uses Vitest. Configuration in `vitest.config.ts`.

## Run a specific test file

```bash
npx vitest run tests/api/auth.test.ts
```

## Watch mode

```bash
npm run test:watch
```

## Test structure

Tests live in `tests/` mirroring `src/`:

```
tests/
├── api/                Route handler tests
├── brain/              Brain service tests
├── cli/                CLI tests
├── daemon/             Bootstrap tests
├── deriver/            Deriver tests
├── embeddings/         Embedding tests
├── inference/          LLM relay client tests
├── integration/        End-to-end integration tests
├── overseer/           Mission engine, planner, scheduler tests
├── plugins/            Plugin loading tests
├── push/               Push notification tests
├── shared/             Utility tests
├── spawn/              Spawn service tests
├── store/              SQLite store tests
├── terminal/           Terminal WebSocket tests
└── tmux/               Tmux driver tests
```

## Test harness for API routes

API route tests build a Hono app with `createServer()` using in-memory SQLite (`:memory:`) and mock/stub deps. Key patterns:

- `ServerDeps` accepts optional overrides — unset stores/features degrade gracefully (routes return `503` or `400`).
- `TestClock` replaces `SystemClock` so tests control time.
- Mock `TmuxDriver` avoids requiring tmux.
- `AuthMiddleware` is tested with `UserStore` backed by in-memory DB.

## Key test conventions

- Each test file is self-contained: creates its own DB, stores, and app.
- Tests use `describe`/`it` blocks.
- Assertions use Vitest's `expect`.
- No real tmux, no real LLM calls — all external deps are mocked.
- Stores are tested with in-memory SQLite to avoid file I/O.