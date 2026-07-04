# Sessions

Routes: `src/api/routes/sessions.ts`, schemas: `src/api/schemas/sessions.ts`

## `GET /sessions`

List live `orca-` tmux sessions. Filtered by the caller's project access.

## `POST /sessions`

Manually launch a session for a task. Body: `{ taskId, exec }`. Claims the checkout atomically.

## `DELETE /sessions/:name`

Kill a session. Advisor sessions route through `advisor.stop()` (also persists `advisor_autostart=false`).

## `POST /sessions/:name/keys`

Send keystrokes to a session. Body: `{ keys: string[] }`. Validates no leading `-` tokens (tmux flag injection guard).

## `POST /sessions/:name/input`

Send raw input bytes (xterm `onData`). Body: `{ data: string }`.

## `POST /sessions/:name/resize`

Resize a session. Body: `{ cols, rows }`.

## `GET /sessions/:name/pane`

Capture the current pane content. Query param: `?ansi=1` for ANSI output.

## `GET /sessions/:name/stream`

SSE stream of pane content (updates every 1 second).

## `POST /sessions/:name/ws-ticket`

Mint a single-use ticket for the terminal WebSocket. Authenticated; the `/ws/terminal` upgrade redeems it.