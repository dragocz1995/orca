# Auth & Users

Routes: `src/api/routes/auth.ts`, schemas: `src/api/schemas/auth.ts`

## `POST /auth/login`

Authenticate and get a session token. Rate-limited (10 attempts / 5 min / IP). Returns `{ token, user, tokenTtlDays }`.

## `POST /auth/logout`

Revoke the current token.

## `GET /auth/me`

Return the authenticated user object.

## `PATCH /auth/me`

Update the authenticated user's profile (name, email, default executor). Validates exec against global and personal allow-lists.

## `POST /auth/me/password`

Change password. Requires current password verification. Returns 403 (not 401) on wrong current password to avoid triggering client logout.

## `GET /auth/me/prompts`

List the authenticated user's prompt overrides (editor catalog with defaults).

## `PUT /auth/me/prompts/:name`

Set a prompt override. Append-only templates accept short instructions (max 4000 chars), not whole prompts.

## `DELETE /auth/me/prompts/:name`

Remove a prompt override (revert to default).

## `GET /auth/me/cli-settings`

Per-user CLI/brain settings (model override, auto-compact, thinking level, Discord ID, auto-recall/save). Includes `serverDefault` for the model picker.

## `PATCH /auth/me/cli-settings`

Update per-user CLI/brain settings. Validates model against the user's allow-list. Restarts the user's brain on model change.

## `POST /auth/me/avatar`

Upload an avatar image (multipart). Supported: PNG, JPEG, WebP, GIF. Max 2 MB.

## `GET /users/:id/avatar/url`

Mint a short-lived (5 min) signed avatar URL for embedding in `<img>` tags (avoids putting the long-lived token in the query string).

## `GET /users/:id/avatar`

Serve avatar bytes. Accepts either a valid `?exp=&sig=` signature or a Bearer token.

## `GET /users`

List all users (admin only in multi-user mode).

## `POST /users`

Create a user. Open during setup (no users yet), admin-only afterward.

## `DELETE /users/:id`

Delete a user. Cannot delete the last user or the admin.

## `PATCH /users/:id`

Update a user's permissions (admin role, exec allow-list). Admin-only.

## `GET /users/:id/projects`

List projects assigned to a user. Admin-only.

## `POST /users/:id/projects`

Assign a user to a project. Admin-only.

## `DELETE /users/:id/projects/:pid`

Unassign a user from a project. Admin-only.