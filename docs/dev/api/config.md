# Config & System

Routes: `src/api/routes/config.ts`, schemas: `src/api/schemas/config.ts`

## `ALL /mcp`

MCP endpoint. Statelessly handles tool calls from the advisor agent. Delegates to `callOrcaApi` core.

## `GET /push/vapid-public-key`

VAPID public key for web-push subscriptions. Public (pre-auth).

## `POST /push/subscribe`

Subscribe a device for push notifications. Body: `{ endpoint, keys: { p256dh, auth } }`.

## `POST /push/unsubscribe`

Unsubscribe a device. Body: `{ endpoint }`.

## `GET /config`

Read the full daemon config.

## `PUT /config`

Write the daemon config. Admin-only (open during setup).

## `GET /system`

System info: running version, latest version, update availability, auto-update config.

## `GET /system/skills`

Agent-workflow skill status (installed per provider). Admin-only.

## `POST /system/skills/install`

Re-install the `orca-workflow` skill across providers. Admin-only.

## `POST /system/update`

Trigger a manual in-place update. Refused while a mission is live. Admin-only.

## `POST /system/restart`

Restart a systemd unit (`daemon` or `web`). Admin-only.

## `GET /events`

SSE event stream. Per-subscriber project-gated. 30s keep-alive pings.