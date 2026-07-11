# Tasks Spatial Workspace Design

## Goal

Rebuild the Tasks presentation as a consistent Elowen full-page workspace with a mascot-led hero and spatial status navigation, while preserving every existing task workflow and data behavior.

## Composition

- Keep Tasks as a full-page data workspace rather than a Settings-style control deck.
- Replace the current separate header, metric strip, and status pills with one shared Tasks hero composition.
- The hero contains the page eyebrow/title/description, ready state, primary New Task action, a single animated Elowen mascot, and the four existing summary metrics.
- The mascot uses the existing lazy scene, static fallback, reduced-motion handling, capped DPR, visibility pausing, and pointer-events-none behavior. No second mascot or new 3D dependency is allowed.
- Place a horizontal spatial status rail directly below the hero in this exact order: Active, Open, Blocked, Closed, Autopilot, All.
- Every rail node displays its live count. The active node uses the shared ember glow and depth treatment; hover/focus movement stays subtle.

## Workspace Content

- Remove the old segmented status pill strip entirely.
- Keep search, project selection, and date range in one compact toolbar inside the shared warm document surface introduced for Settings.
- Reuse the document/group/toolbar/state geometry and tokens, but expose it as a neutral shared workspace surface rather than importing a Settings-specific visual wrapper into Tasks.
- Keep the task register dense and hairline-separated. Do not add a card around each task or each day group.
- Preserve the existing day grouping, epic expansion, drag and drop, multi-selection, pagination, keyboard interaction, hover/selected states, and context menu.
- Preserve the master/detail layout. A selected task or mission remains visible in the right context rail on desktop and follows the existing stacked/drawer behavior at narrower widths.

## State and Data Contract

- Preserve `useTasks`, dependency/session/signal/mission queries, mutations, cache behavior, URL behavior, and local persisted filters.
- Preserve the exact filter values: `in_progress`, `open`, `blocked`, `closed`, `autopilot`, and `all`.
- Rail counts are computed from the already loaded task collection. They do not introduce API calls or change filtering semantics.
- Autopilot counts and filtering retain the current effective epic/phase behavior.
- Preserve loading, daemon error with retry, empty collection, no-match, pending mutation, disabled action, confirmation, and destructive-action behavior.
- Preserve all existing Czech and English copy. Add dictionary keys only for genuinely new accessible labels.

## Responsive and Motion

- Desktop uses the full hero, mascot, metrics, spatial rail, content register, and optional right detail rail.
- Tablet compacts hero metrics and allows the status rail to scroll horizontally without a visible scrollbar.
- Mobile reduces the mascot, keeps the header/action readable, and uses a linear horizontally scrollable status selector. It must not recreate the desktop spatial composition at full size.
- Keyboard navigation supports ArrowLeft/ArrowRight/Home/End across filter nodes with visible focus.
- Respect `prefers-reduced-motion`; content switching must not blank or remount the list.

## Validation

- Add contract tests for filter order, live counts, selection, keyboard navigation, persisted filter state, one mascot, and removal of the segmented pill control.
- Keep existing Tasks, MissionFlow, EpicGroup, project filter, drag/drop, context-menu, modal, and detail tests green.
- Capture desktop screenshots for all six filters plus selected-detail, loading, empty, error, and long-list states; test representative tablet and mobile widths.
- Run focused web tests, full web tests, lint, typecheck, dead-code check, `git diff --check`, and `npm run build:web`.

## Boundaries

- This iteration changes Tasks only plus genuinely reusable workspace hero/surface primitives.
- Do not redesign Kanban, Projects, Timeline, or other routes in the same change.
- Do not change daemon APIs, task schemas, permissions, validation, or business logic.
