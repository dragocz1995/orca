# Brain

Routes: `src/api/routes/brain.ts`, schemas: `src/api/schemas/brain.ts`

The embedded brain is a per-user in-process PI agent session (no tmux). Full-scope (non-agent) callers only.

## `GET /brain/status`

Brain status: running, session ID, model, usage, statusline plugin config.

## `POST /brain/start`

Start a brain session. Body: `{ provider?, session?, fresh? }`.

## `GET /brain/sessions`

List the user's conversations (most recent first).

## `GET /brain/search`

Full-text search across the user's conversations. Query param: `?q=`.

## `DELETE /brain/sessions/:id`

Delete a brain conversation.

## `GET /brain/messages`

Get the current conversation's message history.

## `GET /brain/models`

List available models across all configured providers. Non-admins only see models their allow-list permits.

## `POST /brain/providers/probe`

Probe an OpenAI-compatible endpoint's `/models`. Admin-only.

## `GET /brain/images/:file`

Serve a generated image (from image-gen or image-edit plugins).

## `POST /brain/abort`

Abort the current streaming turn.

## `POST /brain/model`

Switch the active conversation's model. Body: `{ provider, model }`.

## `POST /brain/think`

Set the thinking level. Body: `{ level }`.

## `POST /brain/compact`

Manual context compaction. Returns updated usage.

## `POST /brain/send`

Send a message. Body: `{ text, images? }`.

## `GET /brain/stream`

SSE stream of brain events (responses, status changes). 30s keep-alive pings.