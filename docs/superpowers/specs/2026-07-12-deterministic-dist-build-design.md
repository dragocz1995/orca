# Deterministic Dist Build Design

**Status:** Approved in conversation on 2026-07-12.

## Problem

Elowen's TypeScript build writes into `dist/` without first removing the previous output. When a
source module is deleted, `tsc` does not delete the JavaScript emitted by an earlier build. The
production checkout therefore still contains `layout.js`, `runtime.js`, `shell.js`, and
`streamController.js` even though their TypeScript sources and import edges no longer exist.

The running CLI does not import those files, but the build is history-dependent and `package.json`
includes the whole `dist/` directory in the package payload. A correct build from the same commit
must produce the same file set regardless of what an older checkout emitted.

Knip 6.17.1 can report unused files, but the main Knip project intentionally analyzes source files,
respects `.gitignore`, and excludes `dist/`. Adding generated output to that graph would duplicate
the source graph and require a second, fragile list of runtime and dynamic entrypoints. Knip remains
the source dead-code owner; build-output integrity receives a purpose-built invariant.

## Decision

Add one small build-integrity module with two commands:

- `clean` removes only the repository's resolved `dist/` directory after validating the repository
  root and target boundary;
- `verify` compares emitted JavaScript under `dist/` with the JavaScript paths implied by the
  TypeScript inputs under `src/`, failing on either missing or orphaned output.

Wire these commands through npm's `prebuild` and `postbuild` lifecycle. The existing `build` body
continues to compile TypeScript and copy the schema, prompts, and plugins. Every normal build,
tmux build, private deploy, and `prepublishOnly` run therefore starts clean and finishes with an
independent parity check.

The checker owns only TypeScript-emitted `.js` files. Copied `dist/plugins/**`, `dist/prompts/**`,
and `dist/store/schema.sql` remain governed by the existing copy steps and are not misclassified as
compiler output.

## Safety and failure behavior

- The cleaner derives the repository root from its own script location; it does not accept an
  arbitrary deletion path from CLI input.
- It validates the package identity and requires the deletion target to be exactly the direct
  `dist` child of that root.
- Cleaning happens before compilation. If compilation fails, no stale executable build remains to
  be mistaken for the failed revision.
- Verification reports sorted missing and orphaned paths and exits non-zero. It never repairs or
  deletes individual files.
- Knip's `--fix --allow-remove-files` is not used on generated output because dynamic imports can
  make graph-based deletion unsafe.

## Regression coverage

Focused tests use an isolated temporary project and prove that:

1. `clean` removes a seeded stale artifact without touching files outside `dist/`;
2. `verify` accepts a matching `src`/`dist` file set;
3. `verify` rejects a missing emitted file;
4. `verify` rejects an orphaned emitted file;
5. copied non-JavaScript assets do not affect parity;
6. an actual repository build leaves no JavaScript file without a corresponding TypeScript source.

After implementation, run the focused tests, build, Knip, dependency-cruiser, lint, typecheck, and
the relevant CLI architecture tests. Confirm the four legacy files are absent, commit each logical
change separately, restart the approved production services, and verify daemon health, web HTTP,
CLI version, and the deployed file set.

## Small source cleanup

The same cleanup wave removes two independently verified unused surfaces without changing behavior:

- `subagentSessions()` stops computing the unused `running` property;
- the uncalled `SnapshotLaneLease.lane` and `cancel()` API, together with the private owner method
  reachable only through that API, are removed.

These edits receive their own scoped commit and remain separate from the build-integrity commit.

## Non-goals

- No changes to the CLI render, layout, stream, transcript, or terminal lifecycle behavior.
- No npm publication or branch push.
- No inclusion of the unrelated dirty `package-lock.json` or later web work in these commits.
