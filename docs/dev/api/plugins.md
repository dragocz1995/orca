# Plugins

Routes: `src/api/routes/plugins.ts`

All plugin routes are admin-only (open in single-user mode).

## `GET /plugins`

List installed plugins with enabled status, health, and i18n metadata.

## `GET /plugins/runtime`

The actual contributions of the merged, loaded plugin registry (tools, hooks, platforms, etc.). Distinct from the manifest `provides`.

## `GET /plugins/:name`

Plugin detail: config schema, stored config (secrets omitted), capabilities, data summary.

## `GET /plugins/:name/contributions`

A plugin's own runtime contributions (tools, hooks, etc.).

## `GET /plugins/:name/logs`

Recent log tail + coarse health from the bounded log ring.

## `GET /plugins/:name/hook-executions`

Recent mutating-hook execution records (accepted/rejected/failed).

## `POST /plugins/:name/data/clear`

Wipe the contents of a plugin's data directory (not the directory itself).

## `PATCH /plugins/:name/config`

Save config values. Secret fields arriving empty keep their stored value. Applies live (brain hot-reload).

## `PATCH /plugins/:name`

Toggle a plugin on/off. Applies live (brain hot-reload).

### Cron jobs (cronjob plugin)

## `GET /plugins/cronjob/jobs`

List all cron jobs from `jobs.json`.

## `PUT /plugins/cronjob/jobs`

Replace the whole jobs array. Validates schedule format (`every Nm/Nh`, `daily HH:MM`, `weekly DAY HH:MM`).

### Skills (skills plugin)

## `GET /plugins/skills/list`

List all skills (bundled + user). Each entry: name, description, source.

## `POST /plugins/skills`

Create/overwrite a user skill. Body: `{ name, description, content }`. Name must be kebab-case, max 64 chars. Hot-reloads the brain.

## `DELETE /plugins/skills/:name`

Delete a user skill. Bundled skills cannot be deleted. Hot-reloads the brain.

### Discord channels

## `GET /plugins/discord/channels`

List text channels + active threads for the configured guild. Cached for 60s.

### Brain OAuth

## `GET /brain/oauth/status`

Connection status for each OAuth provider (Anthropic, Copilot, OpenAI).

## `GET /brain/oauth/:type/catalog`

Built-in model catalog for an OAuth provider type.

## `POST /brain/oauth/:type/start`

Start an OAuth flow. Returns `{ authUrl, userCode? }`.

## `GET /brain/oauth/flow/:id`

Poll an OAuth flow's status.

## `POST /brain/oauth/flow/:id/input`

Submit input (e.g. device code) to an active flow.

## `DELETE /brain/oauth/:type`

Disconnect an OAuth account.