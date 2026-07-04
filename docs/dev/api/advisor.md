# Advisor

Routes: `src/api/routes/advisor.ts`, schemas: `src/api/schemas/advisor.ts`

The advisor is a per-user persistent CLI agent session (tmux-spawned). Full-scope (non-agent) callers only.

## `GET /advisor/status`

Get the advisor's running status, session name, exec, and usage.

## `POST /advisor/start`

Start the advisor session. Body: `{ exec }` (optional exec override). Validates exec against the user's allow-list.

## `POST /advisor/stop`

Stop the advisor session (also persists `advisor_autostart=false`).