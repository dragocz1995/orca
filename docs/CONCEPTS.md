# Concepts

## Tasks

A **task** is a unit of work. Tasks form a tree via `parent_id` — an epic (root task) contains sub-tasks. Tasks can also declare dependencies (`task_deps` table) that must be closed before the task becomes ready.

### Task lifecycle

```
open → in_progress → closed
  ↓                    ↑
blocked ───────────────┘ (retry via manual unblock)
  ↓
cancelled
```

| Status | Meaning |
|---|---|
| `open` | Waiting to be picked up |
| `in_progress` | Assigned to an agent session |
| `blocked` | Escalated to human: stuck detector exceeded relaunch budget, or dependency rejected by post-done review |
| `closed` | Completed successfully |
| `cancelled` | Abandoned |

Blocked tasks are excluded from `readiness.ready()` so the engine tick skips them. A human must manually unblock (set back to `open`) to retry.

### Labels

Tasks carry string labels used for routing and agent naming:

- `exec:<spec>` — route to a specific agent executor (e.g., `exec:sonnet`, `exec:opencode:ollama-cloud/deepseek-v4-flash`, `exec:codex:gpt-5.5`)
- `agent:<name>` — pin a specific agent name for this task's session (`orca-<name>`). Named agents let the deriver, janitor, and stuck detector resolve the task from a session without relying on first-in-progress fallback.
- `started:<epoch-ms>` — precise spawn timestamp for correct usage attribution under concurrency
- `stuck:<n>` — relaunch counter; incremented each time the stuck detector reverts this task, bounds re-spawns at `maxRelaunch` (2)
- `base:<sha>` — the HEAD commit at spawn time, stamped under the checkout lock so it lands after any in-flight commit. Used by the per-task change snapshot to freeze the `base..HEAD` range at close.
- `head:<sha>` — the HEAD commit at close time, stamped by `snapshotTaskChanges()`. Together with `base:<sha>` it defines the frozen change list for this task.
- `resume:<program>:<sessionId>` — written by the usage recorder at close when the provider's `resume` toggle is on. At the next spawn, the agent continues its prior CLI session instead of starting cold.

### Readiness

A task is **ready** when it is `open`, not an epic, and every one of its dependencies (`task_deps`) is `closed` or `cancelled`. The `Readiness` service computes this at query time with a single `NOT EXISTS` deps check — `ready(projectId)` across a project, or `readyForEpic(epicId)` scoped to one epic's direct children (used by the mission engine so parallel missions don't walk each other's tasks).

### Per-task change snapshots

When a task closes, the daemon freezes the list of files the task's agent committed. At spawn, the current `HEAD` is stamped as a `base:<sha>` label (under the checkout lock so it lands after any in-flight commit). At close, `snapshotTaskChanges()` reads the new `HEAD` and computes `git diff base..HEAD --name-only` in the agent's checkout — the mission worktree in PR-native mode, else the shared project checkout. The file list, `base_sha`, and `head_sha` are stored on the task row.

The frozen diff is exposed via `GET /tasks/:id/changed/diff?path=<file>`. Empty when the task has no baseline (hand-closed), no commits were made, or the refs were GC'd by a later squash.

#### Close paths

Snapshots are taken on three code paths in the `PATCH /tasks/:id` close handler:

| Path | Condition | Locking |
|---|---|---|
| **Review gate** | `reviewOnDone` + overseer configured → commit+snapshot on *approval* verdict | Under `gitLock.run()` so the commit and snapshot are serialized with the next agent's baseline read |
| **Direct close** | Mission phase, no review gate → commit+snapshot immediately | Under `gitLock.run()` |
| **Standalone task** | No mission → snapshot only (no phase commit) | Under `gitLock.run()` |

The review path commits only on approval — a rejected phase never commits, so its snapshot is never taken. The direct-close path commits unconditionally (the agent already closed the task).

#### KeyedMutex serialization

A `KeyedMutex` (`src/shared/keyedMutex.ts`) serializes git operations on one checkout: the baseline read at spawn and the commit+snapshot at close must not interleave across agents sharing a working tree, or a task's frozen change range could straddle another's commit. The mutex is per-checkout-path (FIFO), so different checkouts run concurrently. A throwing `fn` never wedges the chain — the next waiter still runs.

#### Edge cases

- **No baseline** (`base:<sha>` label missing): the task was hand-closed or never spawned by the engine — `snapshotTaskChanges()` returns early, no snapshot stored.
- **No commits** (`base == head`): the diff is empty — the task made no changes.
- **Non-repo / no HEAD**: `projectHead()` returns null → early return.
- **Git failure**: caught and logged; the close proceeds without a snapshot (best-effort).
- **GC'd refs**: a later squash or rebase may invalidate the stored SHAs — the diff endpoint returns `{ diff: '' }`.

### Session resume

When a provider's `resume` toggle is on (Settings → Providers), the usage recorder stamps a `resume:<program>:<sessionId>` label on the task at close. On the next spawn, `parseResumeLabel()` reads it and the spawn command splices the resume flag into the agent's launch command:

| Program | Resume mechanism |
|---|---|
| `claude-code` | `--resume <sessionId>` flag |
| `opencode` | `-s <sessionId>` flag |
| `codex` | `resume <sessionId>` subcommand |

The resume is applied only if the program still matches and the provider allows it. The stuck detector also captures the dead agent's session for resume before reverting a stuck task, so the relaunch continues the prior conversation.

#### Label lifecycle

1. **Write** — `captureResumeLabel()` in `src/integrations/usage/resumeCapture.ts` detects the CLI session the agent just ran under and stamps the `resume:<program>:<sessionId>` label. Called at two moments:
   - **UsageRecorder** (EventBus subscriber): when a task settles (`closed`/`cancelled`), before the usage snapshot. The resume label is independent of token parsing — even if usage comes up empty, the session still exists and is resumable.
   - **Stuck detector** (`onReap` callback): when reverting a dead agent to `open`, captures the crashed-but-persisted session so the relaunch resumes it instead of cold-starting.
2. **Read** — `parseResumeLabel()` in `src/spawn/resume/index.ts` parses the label at spawn time. The mission engine passes it to `SpawnService.launch()`.
3. **Apply** — `SpawnService` validates that the recorded program matches the current spawn's program (the operator may have switched execs) and the provider hasn't disabled resume. If both pass, the resume is spliced into the launch command via `buildAgentCommand()`.

#### ResumeProvider pattern

Each CLI has a self-contained `ResumeProvider` module in `src/spawn/resume/`:

| Module | Program | Placement | Command shape |
|---|---|---|---|
| `claude.ts` | `claude-code` | `flag` (after bypass, alongside `--model`) | `claude --dangerously-skip-permissions --resume <id> --model <model> <prompt>` |
| `opencode.ts` | `opencode` | `flag` (after binary, alongside `--model`) | `opencode -s <id> --model <model> --prompt <prompt>` |
| `codex.ts` | `codex` | `subcommand` (before bypass flag) | `codex resume <id> --dangerously-bypass-approvals-and-sandbox --model <model> <prompt>` |

The `placement` field controls where the resume tokens land relative to the program's own flags:
- `subcommand` — immediately after the binary, before any flags (codex `resume <id>`).
- `flag` — after the binary/bypass flag, alongside `--model` (claude `--resume`, opencode `-s`).

Only the trailing session id is shell-escaped; the leading tokens are literal flags/subcommand.

#### Resume prompt

A resumed agent receives a short continuation prompt (`worker-resume`) instead of the full worker preamble — it already holds the full goal and what it did, so re-injecting the whole preamble would make it restart from scratch. The resume prompt tells it to pick up where it left off, fold in any new input (details), then close.

#### Stuck detector integration

When the stuck detector reverts a dead agent to `open`, it calls `onReap(task)` before the revert. This callback runs `captureResumeLabel()` to stamp the dead agent's CLI session as the task's `resume:` label. The next spawn then resumes that session — the crash left a partial session on disk that still carries useful context. The capture is best-effort: a detection miss never blocks the reap.

### Checkout serialization

A shared project checkout is single-writer: only one agent may edit it at a time. `checkoutBusy()` in `src/overseer/checkout.ts` checks the in-progress list and refuses a second spawn on the same checkout with `409 { "error": "checkout busy" }`. Isolated PR worktrees are excluded — they're per-mission, so a different mission never collides.

A `KeyedMutex` (`src/shared/keyedMutex.ts`) serializes git operations on one checkout: the baseline read at spawn and the commit+snapshot at close must not interleave across agents sharing a working tree, or a task's frozen change range could straddle another's commit.

#### CheckoutResolver

The `CheckoutResolver` interface (`src/overseer/checkout.ts`) provides two functions:

| Function | Purpose |
|---|---|
| `projectPath(projectId)` | Filesystem path of a project's shared checkout |
| `worktreeFor?(missionId)` | A PR mission's isolated worktree dir, or `null`/`undefined` when it runs in the shared checkout |

`checkoutOf()` resolves a task's working directory by delegating to `usagePath()` — the same logic used for token-usage path resolution. A PR mission's task gets its isolated worktree; everything else gets the shared project path.

#### busySharedCheckouts

`busySharedCheckouts()` builds the set of shared checkouts currently occupied by an in-progress task. It iterates the in-progress list and collects only shared checkout paths — isolated PR worktrees are deliberately excluded. The result is a `Set<string>` of occupied paths.

#### Check-and-claim (atomic)

The mission engine's tick loop performs a **check-and-claim** to avoid double-occupancy:

1. Read the occupied set **fresh** at each claim (not a tick-start snapshot) — the engine and scheduler tick concurrently, so another tick may have claimed the checkout while we awaited `freeAgentName()`.
2. Call `checkoutBusy()` synchronously, immediately before flipping the task to `in_progress`.
3. No `await` between the check and the `setStatus(task.id, 'in_progress')` — the check-and-claim is atomic, and a concurrent tick that re-reads `in_progress` can't double-occupy.

If the checkout is busy, the engine `break`s out of the ready-task loop — the phase stays `open` and retries on the next tick.

#### 409 response

The API endpoint that spawns a standalone task (outside a mission) also checks `checkoutBusy()` before spawning. If the checkout is occupied, it returns:

```json
{ "error": "checkout busy" }
```

with HTTP status `409 Conflict`. The caller should retry later.

#### PR worktree exclusion

PR-native missions run in isolated git worktrees (`<repo-parent>/.orca-worktrees/<slug>-<missionId>`). These are per-mission — a different mission or standalone task never collides with them. `busySharedCheckouts()` skips them entirely, so PR missions never block each other or the shared checkout.

### Inter-agent handoff notes

Agents working on the same mission can leave free-form handoff notes for later phases via `orca note add <missionId> "<text>"`. Notes are scoped to a mission (epic) and access-gated by the epic's project. The next agent reads them with `orca note ls <missionId>` (oldest-first). Body is capped at 8 000 characters; a target is capped at 200 notes. Notes are stored in the `notes` table and purged when the epic is deleted.

#### NoteStore

`NoteStore` (`src/store/noteStore.ts`) provides the storage layer:

| Method | Purpose |
|---|---|
| `add({ scope, target, author?, body })` | Insert a note, returns the full `Note` row |
| `list(scope, target)` | List notes oldest-first (chronological handoff log) |
| `count(scope, target)` | How many notes a scope/target already holds |
| `deleteForTarget(scope, target)` | Purge a target's notes within one scope |
| `deleteAllForTarget(target)` | Purge ALL of a target's notes across every scope (epic delete) |

The `Note` type: `{ id, scope, target, author, body, created_at }`. The `(scope, target)` keying mirrors the events table — scope defaults to `'mission'`, target is the epic ID.

#### API endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/notes?scope=mission&target=<epicId>` | List handoff notes for a mission (oldest-first) |
| `POST` | `/notes` | Add a handoff note (`{ scope?, target, body, author? }`) |

Both endpoints are access-gated by the target epic's project — an agent can only read/write notes for a mission in a project it is actively working in. The `noteTarget()` helper strips a leading `m-` from mission IDs so both workers (which hold the bare `epicId`) and the overseer (which holds `ORCA_MISSION=m-<epicId>`) work.

#### Access gating

- `GET /notes`: resolves the target epic, checks `canAccessProject()`. Returns `404` for an unknown target, `403` for cross-tenant access. An orphaned note (epic deleted) can never be read — the target must resolve and be allowed.
- `POST /notes`: same gate. Additionally enforces `MAX_NOTE_BODY` (8 000 chars) and `MAX_NOTES_PER_TARGET` (200) to bound the per-mission log — a prompt-injected agent loop can't inflate the DB.

#### Purging

Notes are purged when the epic is deleted (`deleteAllForTarget()` in the `DELETE /tasks/:id` handler). This prevents orphan notes from outliving their access-control anchor — without it, a removed mission would leave notes with no project gate.

---

## Missions

A **mission** groups tasks under an epic for autonomous execution. The mission engine (`MissionEngine`) ticks active missions, picks each epic's ready tasks, and spawns agents up to `max_sessions`. The Overseer is not consulted at dispatch — it gates the agents' permission prompts (via the Deriver) and optional post-phase reviews; see the Overseer section below.

### Mission lifecycle

```
engage → active → disengaged
           ↓
        paused → active (resume)
           ↓
        stalled → active (blocked child unblocked or resumed)
```

| State | Meaning |
|---|---|
| `active` | Engine processes this mission on each tick |
| `paused` | Skipped by the engine; running agents killed, tasks reverted to open |
| `stalled` | Active but no agent running and a child is blocked — waiting for human intervention |
| `disengaged` | All children closed/cancelled; mission complete |

The `stalled` state is transitional: when the engine tick finds zero running sessions and at least one `blocked` child, it marks the mission `stalled` so the UI reads "needs attention." Once a blocked child is unblocked and work resumes, it flips back to `active`.

### Mission config

| Field | Description |
|---|---|
| `epic_id` | Root task ID that owns this mission |
| `autonomy` | L0–L3 autonomy level |
| `max_sessions` | Max concurrent agent sessions for this mission's children |
| `created_by` | User ID of the person who engaged the mission. Drives push-notification routing: the owner plus all admins receive phone notifications for this mission's events. Null for legacy/system missions (admins only). |

Unused columns: `cleared_guardrails` *(removed — no longer enforced)*

### Engine tick

The tick loop (every 90 seconds, one tick per active mission):

1. Load the mission, its epic, and its project
2. If all children are `closed`/`cancelled` → auto-disengage
3. Count running = this epic's own `in_progress` children (not global sessions)
4. Walk `readiness.readyForEpic(epicId)` — the epic's direct, dependency-cleared children; for each, while `running < max_sessions`:
    - Skip if autonomy is L0 (Recommend — plan only, no spawn)
    - L1–L3: resolve executor from labels, pick an agent name, set `in_progress`, spawn via tmux
5. Detect stalled: zero running + any blocked child → mark `stalled`; if previously stalled and work resumed → mark `active`

---

## Autonomy levels

| Level | Name | Auto-spawn | Prompt gate | Confidence bar |
|---|---|---|---|---|
| L0 | Recommend | Never | Always escalate to human | — |
| L1 | Assist | Yes | Overseer gate (stricter) | 0.85 |
| L2 | Pilot | Yes | Overseer gate (standard) | 0.6 |
| L3 | Auto | Yes | Overseer gate (standard) | 0.6 |

In the current implementation:
- **L0**: The engine never auto-spawns. The deriver escalates all detected permission prompts to human (`needs_input`), never auto-approving.
- **L1**: The engine auto-spawns ready tasks. The deriver routes permission prompts through the overseer gate with a **stricter confidence threshold** (0.85 vs 0.6). Only clearly-safe steps auto-clear; anything below the bar escalates to human. This is the key difference from L2 — not whether prompts are gated, but how strictly.
- **L2/L3**: The engine auto-spawns ready tasks. The deriver routes permission prompts through the overseer gate with the standard confidence threshold (0.6). L3 additionally waves non-destructive prompts through when no overseer is configured at all (L2 escalates in that case).

---

## Guardrails

Guardrails were removed in v1.1.1. The regex-based safety check system (`detectGuardrails`, `isCleared`, `cleared_guardrails`) was eliminated because it caused missions to stall silently when descriptive phase titles triggered false-positive matches. The `cleared_guardrails` column remains in the schema for backward compatibility but is no longer enforced.

The **overseer decision gate** (relay LLM or parked agent) still provides a safety layer for permission prompts and task dispatch — see the Overseer section below. The decision engine's local destructive heuristic (`isDestructive()`) catches dangerous operations (rm -rf, DROP TABLE, curl | sh, eval, etc.) at enqueue time and is authoritative.

---

## Overseer (decision gate)

Two decision paths, controlled by `config.autopilot.overseerExec`:

### Relay path (default)

`overseerExec` is empty. Permission-prompt decisions go through `RelayClient` using `config.autopilot.overseerModel` (falls back to the planner model). When no relay is wired at all (no API key, no parked agent), the daemon applies `noOverseerFallback()`: **only L3 waves a non-destructive prompt through**; L0–L2 escalate to a human, and destructive prompts always escalate. There is no blanket auto-approve. Post-done reviews cannot run on the relay path — they require a parked overseer.

All decisions pass through the centralized `gateVerdict()` function in `decision.ts`, which applies the `MIN_CONFIDENCE` (0.6) threshold as a single source of truth — callers no longer re-implement the comparison.

### Agent path (parked overseer)

`overseerExec` is set (e.g., `sonnet`). On mission engage, one **Overseer agent** is parked per active mission. It runs a long-poll loop:
1. `orca overseer poll` — blocks until a decision is needed, returns `{id, kind, context}`
2. Judge the request
3. `orca overseer decide --id <id> --approve --confidence 0.85 --rationale "..."` — submits the verdict
4. Back to step 1

The local destructive heuristic (computed at enqueue time) is **always authoritative** — the agent cannot override it. A timeout (120s) or mission disengage conservatively escalates all pending decisions. The heuristic covers: rm -rf, DROP TABLE, DELETE FROM, TRUNCATE, migration, .env, secret/credential/password/private_key, force push, git reset --hard, chmod 777, curl/wget pipes to shell, python/node/perl -e/-c, netcat, bash -c, eval(), os.system, subprocess, and exec().

The decision queue (`DecisionQueue`) is a per-mission FIFO. `DecisionKind` is `'prompt' | 'review'` — task dispatch is **not** gated through the queue:

| Kind | Source | Context |
|---|---|---|
| `prompt` | Deriver | Permission prompt question, context, options |
| `review` | PATCH close handler (post-done) | Task title, outcome, summary |

Every enqueued decision is guaranteed to settle: by the agent's verdict, by the 120 s timeout, or by `drain()` on mission disengage. The `isDestructive()` flag captured at enqueue is OR'd into the agent's verdict on resolve, so an agent's `approve` can never dispatch a flagged-destructive action.

---

## PR-native workflow (optional)

Off by default. When **Settings → Autopilot → PR workflow** is enabled, each mission runs isolated and ships a real GitHub pull request instead of leaving uncommitted changes in the main checkout. It **complements** the overseer review (which still gates phases) — the PR is the final human gate plus a feedback loop.

**Config** (`config.autopilot`): `prEnabled`, `prBaseBranch` (empty → auto-detect `origin/HEAD`, else `main`), `prAutoOpen` (open the PR automatically vs. a manual "Open PR"), `prVerifyCommand` (a gate command run in the worktree before the PR opens), and a write-only `ghToken` (exposed only as `ghTokenSet`; the raw token never leaves the daemon).

**Lifecycle** (orchestrated by `MissionGit`, tracked in the `mission_pr` table):
1. **Engage** → a dedicated branch `orca/<slug>-<epicId>` and a sibling git **worktree** (`<repo-parent>/.orca-worktrees/<slug>-<missionId>`) are created; the mission's agents run there, not in the main checkout.
2. **Per phase** → on the approving review verdict (or on close when review-on-done is off), the daemon commits that phase's worktree changes with the phase title. A rejected phase never commits.
3. **Epic done** → the optional `prVerifyCommand` runs in the worktree. Non-zero **holds the mission** (`stalled`, escalation surfaced) and opens nothing. Green → push the branch and open the PR (auto), or wait for a manual `POST /missions/:id/pr`.
4. **Feedback loop** → a ~60 s poller (`prFeedback`) reads each open PR's reviews, **line-level (diff) comments** and conversation comments. Any fresh *actionable* feedback — a *changes requested* review, a line comment, a `COMMENTED` review with a body (so bots like Codex and human "Comment" reviews count, since GitHub forbids *Request changes* on your own PR), or a conversation comment — is aggregated and routed through the **pilot**, which plans **1..N fix phases** under the epic (inheriting the original mission's exec) and re-engages the mission, so agents apply them in the worktree and the next push updates the PR. A **fix budget** (2 rounds) bounds the bot↔autopilot ping-pong: once spent the mission parks as `stalled` for a human. Dedup is by `last_review_ts`; a merged/closed PR stops the watch and clears the budget.

The worktree is torn down on pause/disengage (the branch is kept). GitHub-only via the `gh` CLI: a missing `gh`/token/remote degrades to a no-op + warning, leaving the rest of autopilot unaffected.

---

## Pilot Agent (AI planning)

When `config.autopilot.pilotExec` is set, `POST /tasks/plan` spawns a **Pilot** agent in the repository instead of using the relay-based planner. The Pilot:

1. Reads relevant files, AGENTS.md, CLAUDE.md, README for conventions
2. Decomposes the goal into 3–7 ordered phases
3. Submits the plan via `orca plan submit --phases '<json>'`
4. Stops — it must not implement anything or spawn agents

The `PlanJobStore` tracks the async planning job. Autopilot mode is **always async** — both the relay and the agent backend return `202 Accepted` with a `jobId` that the web UI polls via `GET /plan/:jobId`. Only manual `phases` mode is synchronous (`201`). Plan jobs are in-memory and ephemeral: a daemon restart drops in-flight jobs (surfaced as `failed`), and a finished job is pruned after a 10-minute TTL.

The Pilot prompt is stored in `prompts/pilot.md` and rendered at runtime via `src/prompts/index.ts` with `{{goal}}` and `{{projectNotes}}` substitution.

---

## Authentication & authorization

The daemon supports optional token-based authentication. When a `UserStore` is configured, all endpoints except `GET /health`, `GET /setup`, and `POST /auth/login` require a bearer token.

### Token flow

```
login (username + password) → receive token → pass as Authorization: Bearer <token>
```

Tokens are:
- Issued via `POST /auth/login` (scrypt password verification)
- Stored in the `auth_tokens` table
- Revocable via `POST /auth/logout`

### Token scopes

Every token carries a `scope` field:

| Scope | Purpose | Restrictions |
|---|---|---|
| `full` | Interactive user session (login via browser/CLI) | Bounded by the user's role and project assignments |
| `agent` | Spawned agent (worker, overseer, pilot) — injected via `ORCA_TOKEN` | Verb + path allow-list; project scope confined to the agent's live working set |
| `advisor` | Per-user assistant session (`orca-advisor-<userId>`) | Mapped to `full` at the guard so it has the user's own rights, but isolated from login tokens so rotating/stopping the advisor never touches `full` tokens |

**Agent-scoped tokens** are injected into every spawned agent via `ORCA_TOKEN` (set by `bootstrap.ts`). They prevent a prompt-injected agent from:
- Creating users or performing admin operations (`/users`, `/config`, project register/delete)
- Accessing projects it isn't actively working in
- Listing tokens, reading other agents' data, or spawning sessions

The `agentAllowed()` gate admits only the verbs the agent CLI actually drives:

| Verb | Path | Used by |
|---|---|---|
| `GET` | `/tasks`, `/tasks/ready`, `/sessions` | `orca ls` / `orca ready` / `orca sessions` |
| `GET` | `/plan/:jobId` | Pilot poll |
| `GET` | `/missions/:id/overseer/next` | Overseer poll |
| `PATCH` | `/tasks/:id` | `orca close` |
| `POST` | `/plan/:jobId/submit` | `orca plan submit` |
| `POST` | `/missions/:id/overseer/decide` | `orca overseer decide` |

Project ownership of the affected row is still enforced downstream by `canAccessProject`, so the agent cannot cross tenancy even within the allow-list.

### Password storage

Passwords are hashed with scrypt (random 16-byte salt, 64-byte hash). No plaintext storage.

### Users

The `users` table stores username + password hash. Additional fields: `is_admin` flag, `allowed_execs` (per-user model allow-list), avatar, name, email, default_exec, advisor_exec, advisor_autostart.

### Enforcement

The `authMiddleware` in `src/api/auth.ts` checks every request:
1. Is the path public? (health, setup, login) → allow
2. Is there a valid token? (Authorization header) → allow
3. Otherwise → 401

The middleware is only active when `d.users` is provided to the server factory. Setup mode (zero users) keeps the API open until onboarding creates the first admin.

---

## AI planning

The `POST /tasks/plan` endpoint decomposes a high-level goal into ordered implementation phases. Two backends:

### Relay backend (default)

1. **Prompt construction** — the template from `prompts/planner.md` (or user-saved custom via `PUT /config`) is rendered with `{{goal}}` and `{{project}}` substitution
2. **LLM call** — `decompose(inf, goal, template, opts)` sends the prompt via the configured autopilot inference client
3. **Parse** — `parsePhases(text)` extracts the JSON array via `extractJson()` (from `src/overseer/llmParse.ts`), validates each phase has a title and valid type
4. **Task creation** — `persistPlan(job, deps)` creates an epic + chained child tasks with sequential dependencies
5. **Optional engage** — if `engage: true`, creates and starts a mission immediately

### Agent backend

When `pilotExec` is configured, a Pilot agent is spawned in the repo (see Pilot Agent section above). The agent submits phases via `POST /plan/:jobId/submit`.

### Manual mode

Pass `phases: [{title, type?}]` — no LLM, no key needed. The daemon creates the epic and tasks synchronously (201 response).

### Phase types

| Type | Purpose |
|---|---|
| `epic` | Root goal (auto-created) |
| `task` | General implementation work |
| `feature` | New feature addition |
| `bug` | Bug fix |
| `chore` | Maintenance, refactoring, tooling |

### Requirements (relay path)

- Autopilot API key must be configured in daemon settings
- LLM must return valid JSON (no markdown fences, no prose)
- On parse failure, returns 502 with `"plan_parse_failed"`

### Per-model descriptions (modelNotes)

`config.modelNotes` is a map of exec → capability description, seeded from `src/shared/execs.ts`
(`EXEC_NOTES`). Every built-in exec ships with a default note describing its strengths (e.g.
"fast reliable everyday coder", "best for hard architecture"). User edits in Settings → Models
persist and merge *under* the built-in defaults so known models always carry a description.

### Auto-model per-phase picking

When `autoModel: true` is passed to `POST /tasks/plan`, the planner receives a `{{models}}` block
listing every enabled model that has a non-empty note. The planner is instructed to pick the best
model per phase and include an `exec` field on each phase object. The `modelsBlock()` helper in
`src/overseer/planner.ts` renders the block — only models in `allowedExecs` with a non-empty note
are listed. When no models qualify, the block is empty and phases fall back to the configured
default exec.

Both backends (relay and Pilot agent) support `autoModel`. The Pilot agent receives the same
`{{models}}` block in its prompt via `modelsBlock()`.

### Adding phases to an existing epic

`POST /tasks/:epicId/phases` — append manual phases after the current chain, or replan a residual `goal`. New phases depend on the epic's current leaf tasks. An active mission picks up the freshly-ready phase on the next tick (triggered immediately after creation).

---

## Activity log / event store

All state changes are recorded in SQLite `events` table (`src/store/eventStore.ts`):

| Event type | Example |
|---|---|
| `task` | Task created, status changed, deleted |
| `mission` | Mission engaged, paused, resumed, disengaged |
| `signal` | Deriver detected working/needs_input/complete |
| `plan` | Plan job status (planning, done, failed) |

The log is queryable via `GET /activity` with optional `type` and `limit` filters. Used by the Timeline page in the web UI. Events are grouped in the UI: identical events within 5 minutes collapse into `×N` to prevent flood from repeated deriver signals.

---

## Phone push notifications

Orca sends web-push notifications to subscribed devices for mission events that need human attention. The feature is opt-in per device from the user's Account page.

### VAPID keypair

A VAPID keypair is generated on first daemon boot by `ensureVapidKeys()` in `src/push/vapid.ts` and persisted in the config store (`config.webPushKeys`). The public key is served at `GET /push/vapid-public-key` (safe pre-auth); the private key never leaves the daemon and is never exposed via the API. Reused across restarts — rotation would invalidate all stored push subscriptions.

### Subscription lifecycle

1. Browser gets the VAPID public key from `GET /push/vapid-public-key`
2. User opts in → browser calls `PushSubscription` API, posts the subscription to `POST /push/subscribe`
3. Subscription is stored in `user_push_subscriptions` table, scoped to the authenticated user
4. On mission events, `PushDispatcher` resolves recipients (owner + admins) and fires `PushSender`
5. User can unsubscribe via `POST /push/unsubscribe` (scoped to their own endpoints)

### Event triggers

See the [Push dispatch mapping](#push-dispatch-mapping) section above for the exact event-to-notification mapping.

---

## Inference client

The inference layer (`src/inference/types.ts`) defines a minimal interface for LLM backends:

```typescript
interface InferenceClient {
  decide(prompt: string): Promise<{ text: string }>;
}
```

### Implementations

| Implementation | File | Purpose |
|---|---|---|
| `RelayClient` | `src/inference/client.ts` | Production — relays to an OpenAI-compatible API |
| `FakeInference` | `src/inference/client.ts` | Tests — returns predictable responses |

### Consumers

- **Planner** (`src/overseer/planner.ts`): goal decomposition for `POST /tasks/plan`
- **Decision engine** (`src/overseer/decision.ts`): prompt and task approval

---

## Agent routing

Tasks specify which AI agent should execute them via the `exec:<spec>` label.

### Executor resolution

`resolveExecutor()` in `src/overseer/routing.ts`:

- `exec:sonnet` → `{ program: 'claude-code', model: 'sonnet' }`
- `exec:opencode:model` → `{ program: 'opencode', model: 'model' }`
- `exec:codex:model` → `{ program: 'codex', model: 'model' }`
- `exec:claude:model` → `{ program: 'claude-code', model: 'model' }`
- `exec:ollama/deepseek-v4-flash` → `{ program: 'opencode', model: 'ollama/deepseek-v4-flash' }`
- `exec:deepseek/deepseek-v4-flash` → `{ program: 'opencode', model: 'deepseek/deepseek-v4-flash' }` (contains `/`)
- No label → uses the configured fallback (default: `claude-code` / `sonnet`)

The executor metadata (program prefixes, default binaries, known execs, well-formedness rules, and
default capability notes) is centralized in `src/shared/execs.ts`. Both `overseer/routing.ts`
(resolution) and `store/configStore.ts` (validation) import from there — adding or changing an
executor is a one-line edit in a single file. The `EXEC_NOTES` constant seeds `config.modelNotes`
on first install so every built-in model ships with a sensible autopilot description.

### Agent commands

| Program | Command pattern |
|---|---|
| `claude-code` | `cd <project> && export ORCA_URL=… ORCA_TOKEN=… && claude --dangerously-skip-permissions --model <model> <prompt>` |
| `opencode` | `cd <project> && export ORCA_URL=… ORCA_TOKEN=… && opencode --model <model> --prompt '<prompt>'` (interactive TUI; SpawnService nudges Enter at 4s/8s/13s to submit) |
| `codex` | `cd <project> && export ORCA_URL=… ORCA_TOKEN=… && codex --dangerously-bypass-approvals-and-sandbox --model <model> <prompt>` |

The prompt instructs the agent to close the task with `orca close <taskId>` when done. The agent receives the orca CLI path, daemon URL, and a service token via environment variables so it can reach back to the daemon.

### Allowed executors

The daemon configuration (`allowedExecs`) controls which executors are permitted via the API. Unknown executors return 400. A per-user model allow-list (`allowed_execs`) further restricts non-admin users. The CLI and web UI enforce this on the daemon side.

---

## Deriver

The **deriver** monitors agent sessions in real time. It polls tmux every 5 seconds and detects agent state by examining the pane output.

### Poll loop

```
tick():
  for each orca-* session:
    resolve agent program (from agent store)
    resolve associated task (via agent:<name> label)
    if task closed → emit 'complete'
    if task status not in_progress/open → skip
    capture pane (last 60 lines)
    detectAgentPrompt(program, output)
    if prompt detected and autonomy !== 'L0':
      autoAccept (workspace-trust) → send accept keys, emit 'working'
      else → consult overseer with autonomy level → approve? send accept keys + emit 'working'
              escalate? emit 'needs_input' with question/options
    elif prompt detected and L0:
      emit 'needs_input' (always escalate)
    else → emit 'working'
```

Each detected prompt is hashed to avoid re-emitting on consecutive polls.

### Detected states

| Signal | Meaning |
|---|---|
| `working` | Agent is progressing normally |
| `needs_input` | Agent is waiting for user input (prompt detected, escalated) |
| `complete` | Task is closed |

### Prompt detection

Implemented for all three supported agent programs (`shellPatterns.ts`):

- **OpenCode** — "Permission required" dialog with Allow/Reject options
- **Claude Code** — workspace-trust gate on first folder entry (auto-accepted directly, no overseer round-trip) and "Do you want to proceed?" permission gate
- **Codex** — "Allow command?" / "Approve this command?" approval gate

For L1–L3 missions and mission-less sessions: environmental gates (claude workspace-trust) are auto-accepted; other prompts go through the overseer gate — accept keys are sent on approval, else escalate to human. The overseer applies a **per-autonomy confidence threshold**: L1 (Assist) requires 0.85 confidence to auto-clear, L2/L3 use the standard 0.6. For L0: all prompts escalate to human.

### No-overseer fallback

When no overseer is configured at all (no relay LLM, no parked agent), the daemon applies a conservative fallback:
- **L3**: non-destructive prompts are waved through; destructive prompts escalate.
- **L0–L2**: all prompts escalate to human — no blanket approval.

### Deduplication

Each detected prompt is hashed (question + context) to avoid re-emitting the same signal on consecutive polls. The hash is stored per-session.

---

## Event bus

The `EventBus` decouples services and provides real-time updates to the web UI:

| Event | Trigger | Payload |
|---|---|---|
| `task` | Status change | `{ taskId, status }` |
| `mission` | State change | `{ missionId, state }` |
| `signal` | Deriver output | `{ session, signal }` |
| `plan` | Plan job status | `{ jobId, status, phases?, error? }` |
| `review` | Overseer verdict on a post-done review | `{ missionId, taskId, approve, rationale }` |

The event bus:
- Serves SSE streams at `GET /events`
- Invalidates React Query caches in the web UI
- Is implemented as an in-memory pub/sub (`Set<() => void>`)
- Drives two background subscribers:
  - **PushDispatcher** — maps events to web-push phone notifications for the mission's owner + admins
  - **UsageRecorder** — snapshots per-task token/cost usage into the `task_usage` table when a task settles

### Push dispatch mapping

The `PushDispatcher` (`src/push/pushDispatcher.ts`) subscribes to the bus and maps these event patterns to push notifications:

| Event | Trigger | Payload kind | Recipients |
|---|---|---|---|
| `review` (not approved) | Overseer rejected or timed out a phase review | `review` — inline Approve / Re-run | Mission owner + admins |
| `signal` (`needs_input`) | Agent waiting on a permission prompt | `needs_input` — inline Allow / Reject (or tap-to-open for multi-choice) | Mission owner + admins |
| `mission` (`stalled`) | No running agents and a blocked child | `stalled` — tap-to-open | Mission owner + admins |
| `mission` (`disengaged`, epic closed) | Natural mission completion | `done` — FYI (mentions PR if one was opened) | Mission owner + admins |
| `task` (`blocked`) | An agent died too many times (bounded relaunch exceeded) | `blocked` — tap-to-open | Mission owner + admins |

Recipients are resolved by `recipientsForMission()`: the mission's `created_by` owner plus every admin. A mission with no owner falls back to admins only.

---

## Session identity (daemon-classified)

The daemon classifies every live tmux session by its naming convention so the API and web UI know its role without reverse-engineering the raw name. `classifySession()` in `src/overseer/sessionInfo.ts` maps each `orca-*` session to a `SessionInfo`:

```typescript
type SessionRole = 'overseer' | 'pilot' | 'agent' | 'advisor';
interface SessionInfo { name: string; role: SessionRole; agent: string; missionId?: string }
```

| Prefix | Role | Example |
|--------|------|---------|
| `orca-overseer-<missionId>` | `overseer` | Parked per-mission decision agent |
| `orca-pilot-<name>` | `pilot` | Repo-aware planning agent |
| `orca-advisor-<userId>` | `advisor` | Per-user assistant session (see Assistant section) |
| `orca-<name>` | `agent` | Worker agent on a task |

`GET /sessions` returns classified sessions — clients see structured role + agent name + optional missionId, never parse the raw tmux name.

## Prompt template system

All LLM prompts are managed as Markdown templates in the repo-root `prompts/` directory and rendered via `src/prompts/index.ts`:

```typescript
import { render, rawTemplate } from '../prompts/index.js';

// Rendered with variable substitution
const prompt = render('planner', { goal: 'Add dark mode', project: 'My notes' });

// Raw template for the editable editor in settings
const raw = rawTemplate('planner');
```

The build copies `prompts/` into `dist/prompts/`. Templates are cached after first read; call `_resetPromptCache()` to force re-read (for tests or on-disk edits).

| Template | Used by | Placeholders |
|---------|---------|-------------|
| `planner.md` | Autopilot relay: goal → phases decomposition | `{{goal}}`, `{{project}}`, `{{models}}` |
| `planner-fallback.md` | Fallback when no custom template is saved | `{{goal}}`, `{{models}}` |
| `pilot.md` | Pilot agent: repo-aware CLI planning | `{{goal}}`, `{{notes}}`, `{{submit}}`, `{{jobId}}`, `{{models}}` |
| `overseer.md` | Parked overseer agent: per-mission decision loop | — |
| `advisor.md` | Per-user assistant agent: drives Orca on the user's behalf | `{{userName}}` |
| `worker.md` | Worker agent: general task execution | — |
| `worker-phase.md` | Phase agent: epic child task execution | — |
| `worker-epic-close.md` | Final phase: also closes parent epic | — |
| `decision-header.md` | Shared overseer decision header | — |
| `decision-prompt.md` | Overseer prompt-gate decision body | — |
| `decision-question.md` | Overseer multiple-choice question body | `{{autonomy}}`, `{{question}}`, `{{context}}`, `{{options}}` |


## LLM JSON extraction

`src/overseer/llmParse.ts` provides a shared `extractJson()` function for robustly extracting JSON objects/arrays from LLM output — handling markdown fences, prose wrappers, and greedy bracket matching. Used by both `planner.ts` (phase array extraction) and `decision.ts` (verdict object extraction), replacing the previously duplicated regex-based approaches.

## Token-usage observability

Usage is tracked on two paths, both portable (no relay or API key needed):

### Live per-task scan

`readTaskUsage()` in `src/integrations/usage/index.ts` reads directly from the executor's CLI session storage:

1. Resolves the task's executor (program + model) from its `exec:` label
2. Reads the CLI's local usage DB (opencode, claude-code, or codex)
3. Matches the session by project directory + agent spawn time (`started:<ms>` label)
4. Disambiguates concurrent agents by start-order rank (parallel missions attribute correctly)

Exposed via `GET /tasks/:id/usage`:
```json
{ "inputTokens": 12000, "outputTokens": 3400, "totalTokens": 15400, "costUsd": 0.045, "contextWindow": 200000, "model": "claude-sonnet-4-20250514" }
```

Returns `null` when no matching CLI session is found. The web UI polls usage every 8 seconds for live tasks.

### Persisted snapshots (stats)

The `UsageRecorder` (`src/integrations/usage/recorder.ts`) subscribes to the `EventBus`. When a task settles (`closed` or `cancelled`), it snapshots the task's token/cost usage into the `task_usage` table via `TaskUsageStore`. This happens once, at settle time — so the stats page aggregates from the DB instead of re-scanning gigabytes of CLI transcripts on every request.

The `task_usage` table stores: `task_id`, `project_id`, `exec` (the full exec spec), `input`, `output`, `cache_read`, `cache_write`, `total`, `cost_usd`, and `captured_at`. A re-run replaces the row in place (UPSERT on `task_id`).

Aggregated per-model stats are exposed via `GET /usage/by-model`:
```json
[
  { "exec": "sonnet", "input": 120000, "output": 34000, "cache_read": 5000, "cache_write": 2000, "total": 154000, "costUsd": 0.45 },
  { "exec": "claude:opus", "input": 50000, "output": 12000, "cache_read": 0, "cache_write": 0, "total": 62000, "costUsd": 0.93 }
]
```

Admin-only `POST /usage/reset` wipes the snapshots (only Orca's DB — CLI transcripts are untouched).

### Path resolution

Both paths resolve the task's working directory through `usagePath()`:
- **PR-native missions** → the isolated worktree (where the CLI logged usage)
- **Other missions / manual tasks** → the project checkout

## tmux sessions

Each agent runs in an isolated tmux session named `orca-<agentName>`.

### Agent naming

Names are generated by `uniqueName.ts` from a curated set:

```
Nova, Atlas, Iris, Felix, Juno, Orion, Luna, Cyrus,
Vera, Milo, Nora, Hugo, Ada, Leo, Mira, Theo,
Ivy, Kai, Zara, Otis, Lena, Cleo, Remy, Soren
```

The counter cycles through the list; after exhausting all names it wraps with a numeric suffix: `Nova2`, `Atlas2`, ...

Reasoning agents (Pilot, Overseer) use names like `orca-overseer-<missionId>`.

### tmux driver

The `RealTmuxDriver` wraps common tmux operations:

| Method | tmux command |
|---|---|
| `spawn` | `tmux new-session -d -s <name> -c <cwd>` + `send-keys <command> Enter` |
| `sendKeys` | `tmux send-keys -t <name> <keys>` |
| `capturePane` | `tmux capture-pane -p -t <name> -S -<N>` |
| `capturePaneAnsi` | `tmux capture-pane -e -p -t <name> -S -<N>` (includes ANSI escapes) |
| `list` | `tmux list-sessions -F '#{session_name}'` |
| `kill` | `tmux kill-session -t <name>` |
| `resize` | `tmux resize-pane -t <name> -x <cols> -y <rows>` (untested, expected to work) |

A `FakeTmuxDriver` implementation exists for tests with in-memory session simulation.

### Reasoning agents

Two special agent types use named tmux sessions outside the normal task→agent mapping:

- **Pilot**: `orca-<name>` (same pool). Spawned for agent-mode plan jobs. Own prompt, no `orca close` — submits plan via `orca plan submit` and its session idles until killed.
- **Overseer**: `orca-overseer-<missionId>`. One per active mission when `overseerExec` is configured. Long-polls `GET /missions/:id/overseer/next`, answers via `POST /missions/:id/overseer/decide`, never edits code.

---

## Stuck detector

The stuck detector (`src/overseer/stuckDetector.ts`) runs every 60 seconds with a 120-second grace period.

### Detection

An agent that exits or crashes without running `orca close` leaves its task `in_progress` with a dead tmux session. The stuck detector:

1. Lists live `orca-*` tmux sessions
2. Finds `in_progress` tasks whose agent session is gone (`deadAgentTasks`)
3. Skips tasks spawned less than `graceMs` (120s) ago
4. Increments the `stuck:<n>` label counter
5. If `count > maxRelaunch` (2): sets the task `blocked` (escalates to human)
6. Otherwise: reverts to `open` so the mission/scheduler re-spawns it

### Bounded relaunch

Each task instance carries a `stuck:<n>` label that counts total relaunches. This guarantees a flaky task eventually escalates rather than spinning forever.

### Zombie reconcile

On daemon startup, the same `deadAgentTasks` logic runs as a one-shot pass (no grace, no counter — a restart isn't an agent death, so it shouldn't spend the relaunch budget). In-progress tasks with no live tmux session are reverted to `open`.

---

## Post-done review (hard gate)

When `config.autopilot.reviewOnDone` is true and an agent overseer is configured, closing a mission phase triggers a **hard sequential gate** before the next phase may run:

1. **Gate closes synchronously**: the close handler immediately sets all open direct dependents to `blocked` — so no engine tick can spawn them while the review is pending. Only tasks gated by *this* review are tracked; a dependent blocked by a different cause is never touched.
2. **Review is enqueued**: a `review`-kind decision is sent to the parked overseer with the task's title, outcome, and result summary (plus the local `isDestructive()` verdict).
3. **Overseer judges**: the parked overseer (or relay fallback) responds with `approve`/`reject`.
4. **Gate opens on approval**: if the verdict approves and is non-destructive, the gated dependents are released back to `open` and `engine.tick()` fires immediately — so the next phase spawns without waiting for the 90-second interval. The release re-checks current status so a human's manual change is never overridden.
5. **Gate stays shut on reject**: a negative or destructive verdict leaves the dependents `blocked`, stalling the mission until a human manually unblocks them.

The review itself is fire-and-forget from the agent's perspective — the agent's `close` call returns immediately; the gating happens in a background promise that must never crash the daemon.

Default off. Requires `overseerExec` to be set (relay fallback cannot drive post-done reviews).

### Overseer watchdog

The mission engine calls `overseer.ensure()` on every tick. If the parked overseer session has exited mid-mission (full context, clean exit per its own prompt), `ensure()` re-parks it automatically — otherwise post-phase reviews and permission decisions would silently stop. The call is idempotent: it is a no-op while the session is still live or when no `overseerExec` is configured.

---

## Assistant (per-user advisor)

The **assistant** (UI label "Assistant", session role `advisor`) is a persistent, per-user agent session that drives Orca on the user's behalf. Each user gets their own `orca-advisor-<userId>` tmux session that runs a configured CLI agent (`advisor_exec`, remembered per user) with a **full-scope token** scoped to that user's rights.

### Lifecycle

- **Start** — `POST /advisor/start { exec }` (or the dock's start button). The `AdvisorService` (`src/advisor/service.ts`) resolves the executor, mints a dedicated `advisor`-scoped token (`ensureAdvisorToken`), writes a per-program MCP config into the advisor's cwd so the CLI auto-connects to Orca's MCP server, and spawns the session.
- **Auto-start on login** — when a user with a saved `advisor_exec` and `advisor_autostart: true` logs in, `ensureOnLogin()` brings the assistant back up fire-and-forget (never blocks the login response).
- **Stop** — `POST /advisor/stop` kills the `orca-advisor-<userId>` session. The token is untouched (reused across restarts).
- **Status** — `GET /advisor/status` returns `{ running, exec, session }`; polled by the dock every 5 s.

### MCP server

The advisor acts through Orca's built-in MCP server (`src/mcp/`), exposed at `POST /mcp`. Each request is handled statelessly with a fresh `McpServer` + transport bound to the caller's bearer token, so every advisor connection acts with exactly its user's rights. The toolset (`src/mcp/tools.ts`):

| Tool | Purpose |
|---|---|
| `orca_request` | Generic escape hatch — call any REST endpoint (method, path, body) |
| `orca_tasks` | List all tasks |
| `orca_create_task` | Create a task (title, project_id?, description?) |
| `orca_plan` | Plan a goal into an epic with phases (autopilot) |
| `orca_sessions` | List live agent sessions |

Every tool delegates to the shared `callOrcaApi` core (`src/shared/apiClient.ts`) — the same forward path as the `orca api` CLI verb, so a new REST endpoint works in both with zero edits.

### `orca api` CLI passthrough

Agents (including the assistant) can also drive Orca without MCP via `orca api <METHOD> <path> [jsonBody]`. It reads `ORCA_URL`/`ORCA_TOKEN` from the environment the daemon injects into every spawned agent, so it reaches any endpoint without a per-endpoint CLI command. The assistant prompt (`prompts/advisor.md`) advertises both paths.

### Access

The advisor session is per-user, not project-scoped: only its owner (or an admin) may reach it via the session routes, and a user need not be assigned to the daemon's project to reach their own advisor. The advisor's token uses a dedicated `advisor` scope — isolated so rotating/stopping the advisor never touches login tokens.
