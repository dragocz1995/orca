# Memory

Routes: `src/api/routes/memory.ts`, schemas: `src/api/schemas/memory.ts`

Per-user private RAW memory: durable facts with vector retrieval. Identity is always the caller; agent tokens never reach these routes.

## `GET /memory`

List memories. Optional `?q=` (keyword search), `?status=`, `?kind=`, `?categoryId=`, `?limit=`, `?offset=`.

## `POST /memory`

Create a memory. Body: `{ body, kind?, categoryId? }`. Source is always `user`, actor is `user:<id>`.

## `GET /memory/:id`

Read one memory. Owner-scoped (404 on foreign ID).

## `PATCH /memory/:id`

Partial update. Owner-scoped.

## `DELETE /memory/:id`

Soft-delete. Owner-scoped.

## `DELETE /memory/:id/purge`

Hard-delete (bypass trash). Owner-scoped.

## `POST /memory/:id/restore`

Restore a soft-deleted memory. Owner-scoped.

## `PUT /memory/:id/category`

Assign or clear a memory's category. Body: `{ categoryId: number | null }`.

## `GET /memory/:id/events`

Audit trail for one memory. Owner-scoped.

## `GET /memory/events`

Whole audit feed (newest first). Owner-scoped.

## `POST /memory/merge`

Merge several memories into one. Body: `{ ids: number[], body }`.

## `POST /memory/purge`

Hard-delete a batch of memories by ID. Body: `{ ids: number[] }`.

## `POST /memory/empty-trash`

Hard-delete all soft-deleted memories. Owner-scoped, atomic.

## `POST /memory/retrieve`

Semantic retrieval. Body: `{ query }`. Returns ranked memories + scoring breakdown.

## `POST /memory/reindex`

Self-service re-embed of pending (missing/stale) memories. Bounded to 100 per request.

### Embedding config (admin)

## `GET /memory/embedding`

Read the workspace embedding config + computed `configured` flag.

## `PUT /memory/embedding`

Update embedding provider/model. Admin-only. Body: `{ providerId, model, baseUrl?, apiKey?, dimensions? }`.

## `POST /memory/embedding/test`

Probe the configured embedding provider. Returns `{ ok, dimensions, provider, model }` or `{ ok: false, error }`.

### Categories

## `GET /memory/categories`

List the caller's categories (name-sorted).

## `POST /memory/categories`

Create a category. Auto-suggests icon from name. Body: `{ name, icon?, description? }`.

## `PATCH /memory/categories/:cid`

Update a category. Body: partial `{ name, icon, description }`.

## `DELETE /memory/categories/:cid`

Delete a category (atomically clears it off referencing memories).

## `POST /memory/categories/suggest-icon`

Model-suggest an icon for a category name. Body: `{ name }`.

### Categorization config (admin)

## `GET /memory/categorization`

Read the workspace categorization model config + `configured` flag.

## `PUT /memory/categorization`

Update the categorization provider/model. Admin-only.

## `POST /memory/reclassify`

Manual reclassify pass over the caller's active memories. Body: optional `{ categoryId?, dryRun? }`.