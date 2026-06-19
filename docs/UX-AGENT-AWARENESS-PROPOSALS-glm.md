# UX Proposals — Agent Awareness & Autopilot First-Class (GLM)

> **Scope:** Web UI only (`/var/www/orca/web`). Every proposal is grounded in
> files that actually exist; references use `file:line` where useful.
> **No application code is changed by this document.**
>
> **Relationship to `UX-AGENT-AWARENESS-PROPOSALS.md`:** that doc already
> covers stall detection, time-in-phase/ETA, tail activity category, decisions
> log, health score, token/cost, autopilot filter, dashboard spotlight, phase
> spotlight, roster card, mission rail, `/autopilot` route, sessions sort,
> sticky actions, mobile accordion, empty states, hover language, keyboard
> help, and cross-links. **This doc deliberately does not repeat those.** It
> surfaces *different* blind spots the operator has today, found by reading the
> daemon + web code end-to-end.
>
> **Design constraints:** OLED/black Vercel-clean, no gradients, no glows.
> Reuse tokens from `web/app/globals.css` and existing primitives
> (`AgentStatusDot`, `ProgressRibbon`, `Badge`, `OutcomeBadge`,
> `TaskContextLine`, `NeedsInputBanner`). Backend-dependent items are flagged
> *optional* with the exact data needed.

## Current state snapshot (what the operator can already see)

From reading the code, the operator already gets: live-state dot
(`AgentStatusDot.tsx`), model icon (`ModelIcon`), agent/session name +
elapsed (`AgentIdentityStrip.tsx`), one-line live tail or result summary or
blocker reason (`TaskContextLine.tsx`), outcome badge, epic progress ribbon
(`ProgressRibbon.tsx`), per-mission live/needs counts
(`DashboardView.tsx:133-149`, `MissionsView.tsx:119`), needs-input banner with
inline allow/reject, ops status bar (needs/live/last-outcome), DAG with
ready/locked/running nodes (`DependencyGraph.tsx`), and a timeline with
live feed groups (`TimelineView.tsx`).

Available data today: task `id/title/status/type/labels` (incl. `agent:<name>`,
`exec:<model>`)/`parent_id/result_summary/outcome/closed_at/created_at/scheduled_at`;
mission `id/epic_id/autonomy/max_sessions/state/cleared_guardrails/started_at`
(`src/store/missionStore.ts:3`); mission detail tasks+deps+progress counts;
live tmux session list; per-session SSE signals (`working`/`needs_input`/
`complete`); the **activity log records only `task`/`mission`/`signal`
events** with `ts/type/target/detail` (`src/store/eventStore.ts:6-12`); and
**project git state** via `GET /projects/:id/git` returning
`status{branch,ahead,behind,dirty,clean}` + `branches` + `commits[]`
(`src/api/server.ts:81-86`, `web/lib/types.ts:46-49`).

**Gaps this doc targets (none are visible today):**
- A phase that will *never* spawn because guardrails triggered at low autonomy
  looks identical to a normal queued phase — silent open, no reason.
- The operator cannot see *what an agent actually changed*; only the tail text.
- `max_sessions` capacity vs. running count is never shown as a meter.
- The mission's overall **goal** and each phase's **acceptance/DoD** (the
  planner emits `details`, stored in the child `description` as
  `${details}\n\nOverall goal: ${goal}` — `src/api/server.ts:163`) are buried.
- A failed/cancelled phase does not visually gate its sequential dependents;
  the DAG just recolours nodes.
- The DAG is a static SVG with `overflow-auto` and no fit/zoom/auto-pan; on
  6+ phase epics the running node scrolls out of view.
- The activity timeline cannot be scoped to one mission/epic.
- A task can read `in_progress` with no live tmux session for up to ~60s
  (janitor + deriver intervals) and the UI shows a green working dot the whole
  time.

---

## 1. Surface more important agent info at a glance

### P0-A — Guardrail-hold visibility: "why isn't this phase starting?"

**What's missing today:** `missionEngine.tick` (`src/overseer/missionEngine.ts:51-53`)
skips spawning a ready phase when `detectGuardrails` triggers and the mission
autonomy is L0/L1 (or the guardrail isn't in `cleared_guardrails`). That phase
stays `open` forever with **no surfaced reason**. In the UI it renders as a
normal "Ready" row (`TaskContextLine.tsx:47-49`), so the operator waits
indefinitely and never learns it's a guardrail hold.

**Proposal:** When a mission's ready phase is blocked by an uncleared
guardrail, render a distinct "held" state instead of "ready":
- Amber `Link2`-style reason line: `Held by guardrail: <reason>` (reuse the
  blocked-deps visual from `TaskContextLine.tsx:38-45` but in warning tone).
- A "Clear & run" action on the phase card that calls `POST /missions` with
  the guardrail id added to `cleared_guardrails` (or a new
  `PATCH /missions/:id` `{ addClearedGuardrails: [...] }`).
- Surface an aggregate "held phases" count on the mission rail card and the
  ops status bar (next to needs-attention).

**Where it lives:**
- `lib/taskTree.ts` — new `heldPhases(children, missions, guardrailFn)` helper.
- `TaskContextLine.tsx` — new `held` branch (needs the guardrail reason).
- `EpicGroup.tsx` / `KanbanEpicCard.tsx` — show held count alongside
  running/needs.
- `OpsStatusBar.tsx` — held badge.
- `MissionsView.tsx` rail card + workspace.

**Rough effort:** M.

**Data needed:** **Optional backend change.** Today `detectGuardrails`
(`src/overseer/guardrails.ts`) runs only inside the engine tick and the result
is not persisted/exposed. Need one of:
1. Engine stamps a `hold_reason` / `held_by` field on the task when it skips
   (cheapest; store as a label like `hold:guardrail:<id>`), **or**
2. A new `GET /missions/:id/holds` returning `{taskId, guardrailId, reason}[]`.
Without this the UI cannot know *why* a phase is held — only that it's open.
The "Clear & run" action can reuse existing `cleared_guardrails` plumbing.

---

### P0-B — "What did it change" via git (dirty/commits per agent)

**What's missing today:** The only signal of progress is the terminal tail.
The operator cannot see that `orca-nova` edited 3 files, or that `orca-mira`
just committed. The project already exposes git state
(`GET /projects/:id/git` → `status.dirty`, `commits[]` with `hash/subject/
author/relative`), but the web never attributes it to a session.

**Proposal:** Add a compact **change strip** to live task cards and session
cards: `✎ 3 dirty · last commit 4m "fix: handle empty deps"`. Derive by:
1. Diffing the project's `git status.dirty` count against a baseline captured
   when the session started (cheap: snapshot at spawn time, poll current).
2. Showing the most recent commit(s) whose `author`/`relative` window overlaps
   the session's runtime, with a one-line subject.
On the epic/mission workspace, aggregate: `12 commits · 9 files touched`
across all phases.

**Where it lives:**
- New `lib/useProjectGit.ts` hook wrapping `useProjectGit` + a per-session
  baseline ref (store start `dirty` in a ref at first live frame).
- New `components/ui/ChangeStrip.tsx` (reuses `Badge`, `GitBranch` icon).
- `TaskCard.tsx` footer next to the status badge.
- `SessionCard.tsx` under the tail.
- `EpicGroup.tsx` / `KanbanEpicCard.tsx` header — aggregate commits/files.
- `MissionsView.tsx` workspace metric strip.

**Rough effort:** M.

**Data needed:** No new API — `useProjectGit` already exists
(`web/lib/queries.ts:60`). Attribution is heuristic (author + time window);
flag clearly as "likely by this agent". **Optional backend improvement:** have
the spawn prompt set a deterministic git author per agent (e.g.
`orca-<agent> <noreply@orca.local>`) so commits attribute exactly — a one-line
change in `src/spawn/commandBuilder.ts` env, no schema change.

---

### P0-C — Mission capacity slot meter

**What's missing today:** `max_sessions` (how many agents a mission may run
concurrently) and the current `running` count are derivable but only shown as
"live: N". There's no visual of "2 of 3 slots in use" — the operator can't tell
at a glance whether a mission is maxed out (so the next phase is *correctly*
queued) vs. idle (so something is wrong).

**Proposal:** A tiny **slot meter**: `▮▮▯` (filled = running, outline = free,
dim = over-capacity). Place it on mission rail cards, the dashboard mission
rows, and the mission workspace header. When `running >= max_sessions` and a
phase is ready-but-unspawned, the meter reads full and the next phase shows
"queued (slot full)" rather than looking stuck.

**Where it lives:**
- New `components/ui/CapacityMeter.tsx` (3-px segment bar, reuses `bg-accent`
  for used, `border` for free, `bg-danger` if over).
- `MissionsView.tsx` rail card + workspace header (replace the bare `live` int
  at `MissionsView.tsx:119`).
- `DashboardView.tsx` mission rows (`:141-147`).
- `lib/taskTree.ts` — `epicCapacity(children, sessions, maxSessions)`.

**Rough effort:** S.

**Data needed:** No new API — `max_sessions` is on `Mission`, `running` is
derived in `epicLive` (`lib/taskTree.ts:33`). This directly disambiguates
"queued because full" from "stuck" and pairs with P0-A (guardrail holds).

---

### P1-A — Output-rate mini-meter (distinct from a health score)

**What's missing today:** The tail flashes on new output (`tail-flash`
keyframe, `globals.css:70-71`) but there's no *rate*. An agent emitting 200
lines/min vs. one emitting 2 lines/min look identical beyond the flash. This
is a cheaper, more honest signal than a computed "health score".

**Proposal:** Track pane content hashes from the 2s `useSessionPane` poll
(`web/modules/sessions/useSessionPane.ts:7`). Show a 6-segment sparkline of
"did output change in this 10s bucket" over the last minute, plus a
`lines/min` estimate. Render inline on `SessionCard` and the dashboard
`LiveLane`. Goes flat/amber when silent (complements, doesn't replace, stall
detection).

**Where it lives:**
- New `lib/useOutputRate.ts` (rolling bucket of hash-deltas, no backend).
- New `components/ui/RateSpark.tsx` (6 bars, `bg-accent`/`bg-border`).
- `SessionCard.tsx` header row.
- `DashboardView.tsx` `LiveLane` (`:20-34`).

**Rough effort:** S.

**Data needed:** No new API — purely client-side from the existing pane poll.
Decay the history when a session stops to avoid stale bars.

---

### P1-B — Zombie reconcile badge: "in_progress but no session"

**What's missing today:** On daemon restart, in-progress tasks with no live
tmux session are reverted to `open` only at startup; mid-run, the janitor
reaps every 60s and the deriver ticks every 5s. In that window, a task can show
`in_progress` + a green working dot while having **no** tmux session. The UI
derives `live` from `sessions.includes(sessionName)`
(`KanbanCard.tsx:33`, `TaskCard` via `useTaskControls`), so it's mostly safe —
but `AgentStatusDot` with `live=true` still pulses green even when the session
vanished, until the next 5s `useSessions` refetch.

**Proposal:** When a task is `in_progress` but its `taskSessionName` is absent
from `useSessions().data` for >10s, show a neutral "reconnecting" dot (not
green) and a one-line `session ended — reconciling` context. This prevents the
operator from trusting a green dot for a dead agent.

**Where it lives:**
- `lib/agentUtils.ts` — extend `liveState` with an `orphaned` case
  (`in_progress` + no session in the live list).
- `AgentStatusDot.tsx` — new neutral style for `orphaned`.
- `TaskContextLine.tsx` — orphaned branch.

**Rough effort:** S.

**Data needed:** No new API — cross-reference `useTasks` + `useSessions`
already in every consumer. The >10s debounce avoids flapping during the 5s
poll gap.

---

### P2-A — Token / cost / turn counts

**What's missing today:** No spend visibility. (Same finding as the prior
doc; included only because the operator explicitly listed it.)

**Proposal:** When the CLIs report usage, show `~$0.04 · 12 turns · 4.2k tok`
per running task and aggregate per epic/mission.

**Where it lives:** `TaskCard.tsx`, `SessionCard.tsx`, `EpicGroup.tsx`,
`MissionsView.tsx`.

**Rough effort:** L. **Data needed:** **Yes — backend.** The CLIs don't emit
usage to Orca today. Need a `usage` table/columns + an endpoint. Do not build
UI until usage data exists.

---

## 2. Make "Autopilot" a first-class category

### P0-D — Mission goal header + phase definition-of-done

**What's missing today:** The mission workspace header shows `d.epic?.title`
(`MissionsView.tsx:188`) — the goal — but the *overall goal context* is buried
inside each child's `description` as `Overall goal: <goal>`
(`src/api/server.ts:163`). Phase **acceptance criteria** (the planner's
`details` field, `src/overseer/planner.ts:29`) are also in `description` and
only visible by selecting a phase and reading `TaskDetailPane`'s Details
field (`TaskDetailPane.tsx:92-96`). The operator cannot see *what each phase
must achieve* without three clicks.

**Proposal:**
1. **Goal banner** at the top of the mission workspace: the epic title as a
   prominent H2 plus the full goal text (pull from the first child's
   `description` after `Overall goal: `, or better — see data note).
2. **DoD chips** on each DAG node and phase card: a small `✓ DoD` toggle that
   reveals the phase's acceptance criteria inline (the `details` portion of
   `description`, before the `Overall goal:` suffix).
3. A "mission brief" collapsible panel combining goal + per-phase DoD list,
   printable for review.

**Where it lives:**
- `MissionsView.tsx` `MissionWorkspace` — goal banner above the metric strip.
- `DependencyGraph.tsx` — node tooltip includes DoD snippet; clicking the
  `✓` chip opens a small popover.
- New `components/ui/DodPopover.tsx`.
- `lib/taskTree.ts` — `phaseDod(task)` parses `description` at the
  `\n\nOverall goal:` boundary.

**Rough effort:** M.

**Data needed:** Mostly no new API — `description` already carries both
`details` and goal. Cleaner: **optional backend** — store `goal` on the epic
task (`description` already = goal at `server.ts:158`) and `acceptance` as a
separate field on children instead of concatenating. A schema migration
adding `acceptance TEXT` to `tasks` would let the UI read DoD directly without
string-splitting. Low-risk, additive.

---

### P0-E — Fail-gate / outcome chain in the DAG

**What's missing today:** Phases are sequential (phase n depends on n-1,
`server.ts:166`). When phase 2 closes `outcome: 'fail'` (or is cancelled),
phase 3's dep becomes terminal so `readiness.ready()` marks it ready — **the
mission barrels on after a failure** with no visual gate. The DAG just
recolors phase 2 red and phase 3 to "ready" (`DependencyGraph.tsx:32`); the
operator may not notice a failed phase launched the next one.

**Proposal:**
1. When a dependency closed `fail` or `cancelled`, render the edge in
   `danger` with a dashed style and a small gate icon at the dependent node.
2. Add a **decision gate** popover: "Phase 2 failed — proceed / halt / replan".
   "Halt" pauses the mission; "proceed" clears the gate (adds a
   `gate:cleared:<phaseId>` label or a mission field); "replan" opens the
   plan modal prefilled with the remaining goal.
3. Optionally make fail-gate *blocking by default* for `fail` outcomes (config
   toggle), so a failed phase holds the chain until the operator decides.

**Where it lives:**
- `DependencyGraph.tsx` — edge styling by dependency outcome; gate icon.
- New `components/missions/FailGatePopover.tsx`.
- `MissionsView.tsx` workspace — gate banner when any upstream phase failed.
- Backend: `missionEngine.tick` already checks readiness; the gate would
  exclude tasks whose nearest failed dep hasn't been cleared.

**Rough effort:** M (UI) / L (if backend gate semantics added).

**Data needed:** UI-only version needs no new API (read dep outcomes from
`MissionDetail.deps` + task `outcome`). The **proceed/halt/replan** actions
need a persistence slot: **optional backend** — a `gate_cleared` label on the
child task or a `gates` JSON column on `missions`. The "halt on fail" default
is a behavior change in `missionEngine.tick` — flag as a config option.

---

### P1-C — DAG navigation: fit-to-view, zoom, auto-pan to current

**What's missing today:** `DependencyGraph.tsx` is a fixed-size SVG in an
`overflow-auto` div (`:38`). On a 6-phase epic the canvas is ~1380px wide; the
running node is usually mid-chain and scrolls off-screen. There's no zoom, no
fit, no "jump to current". The operator manually scrolls to find the live
node.

**Proposal:**
1. **Fit-to-view** button that scales the SVG to the container width.
2. **Zoom controls** (− / + / reset) with a pinch gesture on mobile.
3. **Auto-pan to current**: when a phase is `in_progress`, scroll the DAG so
   its node is centered; re-pan on phase transitions. Disable auto-pan if the
   operator has manually scrolled (resume after 5s idle).
4. A **minimap** for >5 phases (a 24px-tall strip showing the full DAG with a
   viewport rectangle).

**Where it lives:**
- `DependencyGraph.tsx` — wrap in a pan/zoom container; add a `ref` to the
  running node for `scrollIntoView`.
- New `components/missions/DagControls.tsx` (zoom buttons + fit).
- Optional `components/missions/DagMinimap.tsx`.

**Rough effort:** M.

**Data needed:** No new API. Pan/zoom can use a tiny library already
compatible with React 19 (e.g. `@viz-js/svg-pan-zoom`) or a ~60-line custom
transform handler; respect `prefers-reduced-motion` for auto-pan.

---

### P1-D — Mission-scoped activity filter on the timeline

**What's missing today:** The timeline filters by event *type*
(`TimelineView.tsx:230-235`) but not by mission/epic. When three missions
run, the feed interleaves all their signals/tasks and the operator can't follow
one mission's story. Cross-links exist (`hrefForGroup`, `:272`) but no
*scoping*.

**Proposal:** Add a **mission scope** segmented control to the timeline:
"All / <mission titles>". Scoping filters events whose `target` is a task id
belonging to that epic's tree, or a session whose task belongs to that tree.
Combine with the existing type filter. Add a deep-link `?mission=<id>` so the
mission workspace can embed a "view activity" link.

**Where it lives:**
- `TimelineView.tsx` — new scope state + filter predicate.
- `MissionsView.tsx` workspace — "Activity" link → `/timeline?mission=<id>`.
- `lib/taskTree.ts` — `missionTargetSet(epicId, tasks)` (task ids + session
  names under the epic).

**Rough effort:** S.

**Data needed:** No new API — derive the target set from tasks + labels.
Events store `target` as task id or `orca-<agent>` session name
(`eventStore.ts:8`), both mappable to an epic.

---

### P1-E — Autopilot epic "brief" card replacing the plain collapsible

**What's missing today:** `EpicGroup` and `KanbanEpicCard` are bordered rows
with a progress ribbon; they don't *feel* like missions. (The prior doc's
roster card addresses identity; this addresses **content**.)

**Proposal:** When a mission is engaged, upgrade the epic row into a **brief
card**: top hairline in `accent/40` (or `warning` when paused, `danger` when a
phase failed), a one-line goal excerpt, the capacity meter (P0-C), the current
phase name + live dot, and a `▶ Next: <phase>` preview. Collapsed state shows
all of this in one row; expanded shows phases with DoD chips (P0-D).

**Where it lives:**
- `EpicGroup.tsx`, `KanbanEpicCard.tsx` — accept a `mission?` prop and render
  the brief layout when present.
- `MissionsView.tsx` rail card can adopt the same brief treatment.

**Rough effort:** M.

**Data needed:** No new API — missions list already fetched everywhere;
match by `epic_id`.

---

### P2-B — Replan / insert phase (backend-powered)

**What's missing today:** Once an epic is created, the UI cannot add, reorder,
or replan phases. `/tasks/plan` only *creates* (`server.ts:129-177`); there's
no "append a phase to an existing mission" path. When a phase fails or the
goal shifts, the operator must close the mission and start over.

**Proposal:** Add an **"Add phase"** action on the mission workspace that
creates a child task under the epic, lets it depend on an existing phase, and
(if the mission is active) lets the engine pick it up. A "Replan remaining"
action sends the residual goal back through `decompose` and appends the
result. Show inserted phases with a subtle "new" highlight.

**Where it lives:**
- `MissionsView.tsx` workspace — add-phase button + modal.
- New `modules/missions/AddPhaseModal.tsx`.
- `lib/mutations.ts` — `useCreateTask` already supports `deps`/`parent_id` via
  `POST /tasks` (`server.ts:96-103`), so append works today; replan needs a
  new endpoint.

**Rough effort:** M (UI) / M (backend).

**Data needed:** **Optional backend.** Plain append needs no new API
(`POST /tasks` with `parent_id` + `deps` works). "Replan remaining" needs a
new `POST /missions/:id/replan` that runs `decompose` on the residual goal and
appends phases; flag as a follow-up.

---

## 3. General UX / polish wins (mobile + desktop)

### P0-F — Consistent relative time + "running for" framing

**What's missing today:** Time is shown three ways: `taskElapsed` ("12m")
in `AgentIdentityStrip`, absolute `fmtWhen` ("Jun 19, 14:02") in `TaskCard`
footer (`TaskCard.tsx:25-29`, `:112-113`), and `clock` ("14:02") in the
timeline. On the same card an operator sees both "12m" and "Jun 19, 14:02" for
the same task, which is confusing.

**Proposal:** Pick one rule: **relative while running or <24h old, absolute
otherwise**, with the absolute available on hover/`title`. Replace `fmtWhen`
in `TaskCard` with a `formatTaskTime` that returns `12m` for recent, `2h 14m`
for today, else the locale date. Keep `title=""` carrying the full ISO.

**Where it lives:**
- New `lib/formatTime.ts` (or extend `agentUtils.taskElapsed`).
- `TaskCard.tsx`, `KanbanCard.tsx`, `TaskDetailPane.tsx`.

**Rough effort:** S. **Data needed:** No new API.

---

### P0-G — Mission workspace: side-by-side DAG + detail on wide screens

**What's missing today:** `MissionWorkspace` stacks the DAG and the selected
task detail vertically (`MissionsView.tsx:182-221`). On a 1440px screen the
DAG sits above a long detail pane, forcing constant scrolling between graph
and detail. The tasks view already does a two-column split
(`TasksView.tsx:151-196`).

**Proposal:** On `lg+`, render the DAG on the left (sticky, fills viewport
height) and the selected phase detail on the right (scrolls independently),
mirroring `TasksView`'s split. On mobile, stack as today. The DAG's
auto-pan (P1-C) becomes more valuable when it's always visible.

**Where it lives:**
- `MissionsView.tsx` `MissionWorkspace` — responsive two-column layout.
- Reuse the sticky-aside pattern from `TasksView.tsx:191`.

**Rough effort:** S. **Data needed:** No new API.

---

### P1-F — Empty/zero-state for "no live session but in_progress"

**What's missing today:** `SessionsView` empty state covers "no sessions at
all" (`SessionsView.tsx:53-55`). But a task in `in_progress` with no session
(orphaned, P1-B) has no dedicated surface — it's just absent from the grid.

**Proposal:** Add a small **"Orphaned runs"** strip at the top of the sessions
page when tasks are `in_progress` but have no session, each linking to the task
with a "restart or close" action. This turns the P1-B detection into an
actionable surface, not just a dot change.

**Where it lives:**
- `SessionsView.tsx` — orphan strip above the grid.
- `lib/agentUtils.ts` — `orphanedTasks(tasks, sessions)`.

**Rough effort:** S. **Data needed:** No new API.

---

### P1-G — Kanban epic respects mission state in column placement

**What's missing today:** `KanbanBoard` groups epics by `task.status`
(`KanbanBoard.tsx:22`). An engaged epic stays `open` (the epic task itself is
never set `in_progress` — only its children), so an actively-running mission
appears in the **Open** column, visually idle. This is actively misleading
for autopilot oversight via the board.

**Proposal:** When a mission is active for an epic, render the epic card in
the **In progress** column (virtual status) with a small "mission active"
marker, regardless of the epic task's own status. Keep its true status
available via `title`/tooltip. When paused, show it in a "paused" overlay
within In progress.

**Where it lives:**
- `KanbanBoard.tsx` — `groupByStatus` override for epics with an active
  mission.
- `lib/taskTree.ts` — `epicEffectiveStatus(epic, missions)`.

**Rough effort:** S. **Data needed:** No new API — missions already fetched.

---

### P1-H — Toast/action feedback: "phase started", "gate cleared"

**What's missing today:** Mission control actions (pause/resume/disengage)
toast on success (`MissionsView.tsx:127-131`), but phase-level actions
proposed here (clear guardrail, clear fail-gate, add phase) have no feedback
convention yet. As these multi-step flows land, inconsistent toasts will erode
trust.

**Proposal:** Standardize a single `useActionToast(promise, { success, error })`
helper used by every mission/task mutation, with a consistent "verb + target"
format. Pair with optimistic UI where the API already supports it.

**Where it lives:**
- New `lib/useActionToast.ts`.
- `lib/mutations.ts` consumers.

**Rough effort:** S. **Data needed:** No new API.

---

### P2-C — Autopilot config visibility on the mission surface

**What's missing today:** The planner model, overseer model, and autonomy
defaults live in Settings (`config.autopilot`, `config.defaults`). The mission
workspace shows the autonomy badge (`MissionsView.tsx:189`) but not *which
model planned it* or *which model oversees approvals*. For an operator tuning
autopilot, this context is missing where the work happens.

**Proposal:** A collapsible "Autopilot config" line in the mission workspace
header: `Planned by <model> · Overseen by <model> · default autonomy <L>`.
Clicking opens Settings anchored to the autopilot section. Read-only.

**Where it lives:**
- `MissionsView.tsx` workspace header.
- `useConfig` already available.

**Rough effort:** S. **Data needed:** No new API. Note: the config doesn't
record *which* model planned a specific epic (the planner model can change in
Settings between plans); this shows the *current* config, labelled as such.

---

## Summary table

| Proposal | Priority | Effort | Files / Components | Needs backend? |
|---|---|---|---|---|
| P0-A Guardrail-hold visibility | P0 | M | `taskTree.ts`, `TaskContextLine`, `EpicGroup`, `KanbanEpicCard`, `OpsStatusBar`, `MissionsView` | Optional (`hold_reason`/label or `GET /missions/:id/holds`) |
| P0-B "What changed" via git | P0 | M | `useProjectGit` wrapper, `ChangeStrip.tsx`, `TaskCard`, `SessionCard`, `EpicGroup`, `MissionsView` | No (optional: per-agent git author) |
| P0-C Mission capacity meter | P0 | S | `CapacityMeter.tsx`, `MissionsView`, `DashboardView`, `taskTree.ts` | No |
| P0-D Mission goal + phase DoD | P0 | M | `MissionsView` workspace, `DependencyGraph`, `DodPopover.tsx`, `taskTree.ts` | Optional (`acceptance` column) |
| P0-E Fail-gate / outcome chain | P0 | M/L | `DependencyGraph`, `FailGatePopover.tsx`, `MissionsView`, `missionEngine` | Optional (gate persistence + tick semantics) |
| P0-F Consistent relative time | P0 | S | `formatTime.ts`, `TaskCard`, `KanbanCard`, `TaskDetailPane` | No |
| P0-G Mission workspace side-by-side | P0 | S | `MissionsView` workspace | No |
| P1-A Output-rate mini-meter | P1 | S | `useOutputRate.ts`, `RateSpark.tsx`, `SessionCard`, `DashboardView` `LiveLane` | No |
| P1-B Zombie reconcile badge | P1 | S | `agentUtils.liveState`, `AgentStatusDot`, `TaskContextLine` | No |
| P1-C DAG fit/zoom/auto-pan | P1 | M | `DependencyGraph`, `DagControls.tsx`, `DagMinimap.tsx` | No |
| P1-D Mission-scoped timeline | P1 | S | `TimelineView`, `MissionsView`, `taskTree.ts` | No |
| P1-E Autopilot brief card | P1 | M | `EpicGroup`, `KanbanEpicCard`, `MissionsView` rail | No |
| P1-F Orphaned runs strip | P1 | S | `SessionsView`, `agentUtils.ts` | No |
| P1-G Kanban epic virtual status | P1 | S | `KanbanBoard`, `taskTree.ts` | No |
| P1-H Action toast helper | P1 | S | `useActionToast.ts`, `mutations.ts` | No |
| P2-A Token/cost/turn counts | P2 | L | `TaskCard`, `SessionCard`, `EpicGroup`, `MissionsView` | Yes (usage reporting) |
| P2-B Replan / insert phase | P2 | M/M | `AddPhaseModal.tsx`, `MissionsView`, new `/missions/:id/replan` | Optional (replan endpoint) |
| P2-C Autopilot config visibility | P2 | S | `MissionsView` header, `useConfig` | No |

---

## Recommended ship order

1. **Week 1 — P0 quick wins, no backend:**
   - P0-C capacity meter (S) — instantly disambiguates "queued vs stuck".
   - P0-F consistent relative time (S) — removes a real confusion today.
   - P0-G mission workspace side-by-side (S) — big readability win on desktop.
   These three are pure UI, share `taskTree.ts` helpers, and unblock the
   operator's most common "what's happening" glance.

2. **Week 1/2 — P0 agent-awareness + autopilot depth (mostly no backend):**
   - P0-B "what changed" via git (M) — the single highest-value new signal;
     ship the heuristic version first, add per-agent git author later.
   - P0-D mission goal + phase DoD (M) — makes autopilot legible.
   - P0-A guardrail-hold visibility (M) — ship the UI "held" state with a
     label-based backend stub in parallel (engine stamps `hold:<id>`).
   - P0-E fail-gate UI (M) — the UI-only edge styling + gate popover first;
     defer the "halt on fail" tick semantics to a config toggle later.

3. **Week 2 — P1 polish:**
   - P1-A output-rate meter, P1-B orphan badge, P1-C DAG nav, P1-D scoped
     timeline, P1-E brief card, P1-G kanban virtual status, P1-H toast helper.
   These compound on the P0 work (capacity meter + brief card + DoD form the
   new autopilot visual language).

4. **P2 — plan individually:**
   - P2-A token/cost is blocked on usage data — do not build UI first.
   - P2-B replan/insert phase after P0-E fail-gate semantics land.
   - P2-C autopilot config visibility is a nice-to-have once the mission
     workspace is otherwise stable.

---

*End of proposal. No application code changed. Grounded in files read during
this review: `web/modules/{dashboard,tasks,missions,sessions,kanban,timeline}/*`,
`web/components/{ui,shell}/*`, `web/lib/{agentUtils,taskTree,queries,types}.ts`,
`src/api/server.ts`, `src/overseer/{missionEngine,planner,guardrails}.ts`,
`src/store/{schema,missionStore,eventStore}.sql/.ts`, `src/deriver/*`.*