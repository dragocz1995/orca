# Git Project Model Preference Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist a CLI `/model` selection per user and canonical Git project root.

**Architecture:** Keep the preference in the existing typed per-user settings store. Resolve a canonical Git root only after validating the CLI CWD against the user's project policy; use it for model preference only, never for conversation/session addressing.

**Tech Stack:** TypeScript ESM, better-sqlite3 user settings, Vitest.

## Global Constraints

- Exact `cwd` session addressing remains unchanged.
- Resolution order is explicit start, project preference, global setting, then server default.
- A disallowed saved selection silently falls through to the next source.
- Commit every completed logical change locally; never include unrelated worktree changes.

---

### Task 1: Persist typed project selections

**Files:**
- Modify: `src/store/userSettingStore.ts`
- Test: `tests/store/userSettingStore.test.ts`

**Interfaces:**
- Produces: `projectModelPreference(userId, root)` and `setProjectModelPreference(userId, root, selection)`.

- [ ] **Step 1: Write a failing store test** for per-user project-root isolation and corrupt JSON fallback.
- [ ] **Step 2: Run** `npx vitest run tests/store/userSettingStore.test.ts` and confirm it fails because the API is absent.
- [ ] **Step 3: Implement** a sanitized `{ [canonicalRoot]: { provider, model } }` setting map.
- [ ] **Step 4: Re-run** the focused store test and confirm it passes.
- [ ] **Step 5: Commit** the store change.

### Task 2: Resolve and apply Git-project selection

**Files:**
- Modify: `src/brain/service/workDir.ts`
- Modify: `src/brain/brainDeps.ts`
- Modify: `src/brain/brainService.ts`
- Modify: `src/brain/service/lifecycle.ts`
- Modify: `src/daemon/bootstrap.ts`
- Test: `tests/brain/brainService.test.ts`

**Interfaces:**
- Consumes: Task 1's preference APIs through injected brain dependencies.
- Produces: selection precedence across start, restart, and `/model` switching.

- [ ] **Step 1: Write failing lifecycle tests** for shared Git root persistence, explicit override, separate roots, and revoked selection fallback.
- [ ] **Step 2: Run** `npx vitest run tests/brain/brainService.test.ts` and confirm the new tests fail.
- [ ] **Step 3: Implement** validated Git-root discovery and the precedence resolver; write a preference only after a successful `/model` switch.
- [ ] **Step 4: Re-run** focused brain/store tests and confirm they pass.
- [ ] **Step 5: Commit** the daemon feature change.

### Task 3: Verify integration

**Files:**
- Test: `tests/brain/brainService.test.ts`

- [ ] **Step 1: Run** focused tests, lint, and typecheck.
- [ ] **Step 2: Inspect** staged diffs and verify unrelated `package-lock.json` remains unstaged.
- [ ] **Step 3: Commit** any final test-only correction separately if required.
