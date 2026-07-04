# Contributing

## Quick start

1. Fork the repo
2. Create a feature branch from `main`
3. Make your changes
4. Ensure `npm run check` passes (lint + deadcode + depcruise + typecheck)
5. Ensure `npm test` passes
6. Open a pull request

## Code style

- TypeScript strict mode. No `any`.
- Constructor dependency injection — no static methods for services.
- No dead code, no debug leftovers, no duplication.
- Single source of truth for each concept.
- Fix the narrow caller, not the shared code. If a bug affects one consumer of a shared module, fix that consumer — don't widen the shared module's surface.

## Commit messages

Use conventional commit prefixes:

- `feat:` — new feature
- `fix:` — bug fix
- `docs:` — documentation
- `refactor:` — code restructuring
- `test:` — tests
- `chore:` — maintenance

Keep subject lines imperative, ≤ 72 chars. Keep commits focused and atomic.

## Pull requests

- One logical change per PR.
- Describe what and why, not how.
- Link related issues.
- Ensure CI passes before requesting review.

## Release process

1. Update `version` in `package.json`.
2. Run `npm run build && npm run build:web` (prepares `dist/` and `web-dist/`).
3. Commit, tag, push.
4. `npm publish` from the repo root.

## Branch naming

- `feat/<short-description>` for features
- `fix/<short-description>` for bug fixes
- `docs/<short-description>` for documentation

## Translations

All user-facing text in the web UI uses `__('key')` translation calls. Always provide both Czech (`cs`) and English (`en`) translations for any new keys.