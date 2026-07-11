# CLI terminal stabilization report

Date: 2026-07-11  
Scope: `src/cli/chat`, PI TUI integration, brain send admission, LSP diagnostics, Codex compaction recovery

## Verified root causes

- Layout height was derived independently in multiple components. Fixed minima could make the root
  taller than `terminal.rows`; PI's diff then retained/cleared the wrong physical rows after stream and
  resize, producing the white rule, duplicated footer and permanently displaced editor.
- Render requests were not centrally coalesced. Token SSE, thinking, resize and mascot animation could
  each trigger a full transcript preparation; mascot motion also kept an otherwise idle UI repainting.
- Scroll assembled/indexed work proportional to settled history. Cached transcript snapshots retained
  predecessor chains, and a fully indexed streaming tail walked every settled height again.
- The estimated scrollbar performed only one bounded cold-history batch per pointer event and centered
  the pointer inside the thumb. A stationary drag therefore stalled before its target and grabbing the
  edge visibly jumped.
- PI clips an overlay's rendered row array to `maxHeight`; it does not preserve overlay chrome. Slash,
  mention and ask components had to consume the central row budget themselves and select a moving item
  window rather than hand PI an oversized component.
- Root-frame sanitization did not cover PI overlays. All overlay output now crosses the same terminal
  control/text boundary as the root frame.
- `POST /brain/send` held the HTTP response open for the complete model/tool turn. A reverse proxy could
  time it out after otherwise successful long Diagnostics work, causing the CLI-local `fetch failed`.
  The route now acknowledges with HTTP 202 only after the user row and authoritative stream echo are
  durable; pre-admission failures remain HTTP errors and post-admission failures are published over SSE.
- Headless mode treated a successful admission POST as a completed turn after 300 ms. A model that took
  longer to emit its first SSE event could therefore exit 0 without the answer. Only ordered `idle` or
  `error` stream events now complete the command; the explicit run timeout bounds a missing stream.
- Parallel LSP requests treated only the first lookup as a cold start. Sibling files got the 4s warm
  timeout while TypeScript was still indexing; the client is now warm only after a real
  `publishDiagnostics` verdict.
- ChatGPT can route a preview Codex summary request to an expired internal deployment slug. Compaction
  still tries the selected model first and retries only explicit `Model not found` through the stable
  OAuth `gpt-5.5` descriptor, preserving PI's cut point, persistence and overflow retry lifecycle.

## Architecture after remediation

- One central layout budget owns every vertical section and constrains every physical frame to terminal
  rows/columns, including tiny-terminal fallback.
- One frame scheduler coalesces reasons, rate-limits interactive/normal frames and reserves forced paints
  for geometry/lifecycle transitions. Idle chat has no permanent render timer.
- Transcript rendering is tail-indexed and viewport-oriented with per-turn rows, sparse height deltas,
  a bounded revision journal, bounded row LRU and streaming-tail invalidation. Old sub-agent updates patch
  only their exact turn, and revision lookup is deterministic rather than dependent on WeakRef/GC timing.
- Terminal alternate screen, mouse mode, resize listeners, start/stop and forced repaint have one
  lifecycle owner. Opt-in diagnostics write only to a file.
- Scrollbar cold-history discovery uses bounded one-shot continuations only while a drag is active and
  retains the pointer-to-thumb offset.

## Benchmark (same deterministic benchmark)

| Settled turns | Metric | Baseline `debc0193` | Final |
|---:|---|---:|---:|
| 200 | scroll avg / p95 | 3.148 / 4.397 ms | 2.795 / 6.133 ms |
| 200 | stream avg / p95 | 3.293 / 5.096 ms | 2.496 / 2.856 ms |
| 2,000 | scroll avg / p95 | 3.497 / 7.061 ms | 1.863 / 2.342 ms |
| 2,000 | stream avg / p95 | 3.251 / 7.557 ms | 2.080 / 2.048 ms |
| 10,000 | scroll avg / p95 | 12.508 / 21.433 ms | 1.828 / 2.111 ms |
| 10,000 | stream avg / p95 | 12.214 / 17.606 ms | 1.679 / 2.246 ms |

The final 10k result is effectively viewport-bound instead of growing linearly with settled turns.
Initial cold render fell from 730.858 ms at 10k turns to 3.645 ms in the final run (initial timing is
JIT/order-sensitive; scroll and stream distributions are the primary comparison).

## Automated verification

- `npm run lint`: 0 errors (one unrelated existing web hook warning).
- `npm run typecheck`: pass.
- `npm run depcruise`: pass, 802 modules / 3,139 dependencies.
- `npm run deadcode`: pass.
- `npm test`: 275 files / 2,954 tests passed.
- `npm run build`: pass.
- `node scripts/tests/cli-render-benchmark.mjs`: results above.
- `npm run test:cli-tmux:built`: two consecutive complete passes.

Latest long tmux runs:

| Report | Frames | p95 | max | Result |
|---|---:|---:|---:|---|
| `/tmp/elowen-tui-e2e-artifacts-yrJ2UW/report.json` | 89 | 22.779 ms | 112.803 ms | pass |
| `/tmp/elowen-tui-e2e-artifacts-1gwIr2/report.json` | 90 | 23.008 ms | 116.736 ms | pass |

The max frames were forced lifecycle/geometry paints; ordinary interaction remained within the target.
Both machine reports verified exact root height, unique footer, one-message white-line regression, rapid
control-rich tool burst, long history, PageUp/PageDown, wheel and red-thumb drag beside telemetry,
streaming queue, repeated resize through 20x10/40x15/96x24/120x30, Todo `+N more` mouse expansion,
short slash and ask chrome, modal/external-editor repaint, hidden successful exit status, input recovery,
alternate-screen exit, mouse disable and exact TTY mode restoration.

The deterministic fixture and analyzer live in:

- `scripts/tests/fixtures/cli-tmux-brain.mjs`
- `scripts/tests/cli-tmux-short.mjs`
- `scripts/tests/cli-tmux.mjs`
- `scripts/tests/cli-render-benchmark.mjs`

## Independent review

An independent read-only terminal implementation review was run after the initial implementation and
again after every remediation round. It found and drove fixes for GC-dependent revision ancestry,
old-turn sparse-height window coordinates, premature headless completion, HTTP admission visibility,
normal-turn/steer races and partial-failure rollback. The final review of `ae033a1b` + `66cc1e59`
returned a clean verdict with no remaining actionable finding.

The only residual limitation is fundamental: PI's in-memory queue, SQLite and replay publication cannot
form one hardware-atomic transaction. The implemented ordering prevents every ordinary/testable partial
failure: DB failure does not call PI, PI rejection rolls back the hidden row and queue mirror, and user
echo/HTTP 202 happen only after PI-native preflight acceptance.
