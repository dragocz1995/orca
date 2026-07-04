# Projects

Routes: `src/api/routes/projects.ts`, schemas: `src/api/schemas/projects.ts`

## `GET /projects`

List projects. Non-admins see only their assigned projects. Admins see all.

## `GET /fs/dirs`

Browse the server's directory tree (for the new-project picker). Admin-only. Returns directory names only, never file contents.

## `POST /projects`

Register a project. Admin-only. Body: `{ slug, path, notes }`.

## `PATCH /projects/:id`

Update a project's path, notes, icon, or `pr_enabled` (tri-state: null = inherit global, true/false = force). Admin-only.

## `DELETE /projects/:id`

Remove a project from Orca (cascades to tasks, missions, agents, access grants; never touches on-disk files). Cannot remove the home project. Admin-only.

## `GET /projects/:id/git`

Read the project's git status (branch, remotes, etc.).

## `GET /projects/:id/files`

List the project's file tree (for the in-app editor). Path-validated to stay inside the project root.

## `GET /projects/:id/file`

Read a single file's content. Query param: `?path=`.

## `PUT /projects/:id/file`

Write a file's content. Body: `{ path, content }`. Path-validated.

## `GET /projects/:id/raw`

Serve a binary file (images). Returns appropriate content-type.

## `POST /projects/:id/new-file`

Create an empty file. Body: `{ path }`.

## `POST /projects/:id/dir`

Create a directory. Body: `{ path }`.

## `POST /projects/:id/rename`

Rename a file/directory. Body: `{ from, to }`.

## `POST /projects/:id/copy`

Copy a file/directory. Body: `{ from, to }`.

## `DELETE /projects/:id/entry`

Delete a file or directory. Query param: `?path=`.

## `GET /projects/:id/diff`

Working tree diff for one file. Query param: `?path=`.

## `GET /projects/:id/head`

File content at HEAD. Query param: `?path=`.

## `GET /projects/:id/commit/:hash`

A commit's full diff and changed files.

## `GET /projects/:id/commit/:hash/diff`

Single-commit, single-file diff. Query param: `?path=`.

## `GET /projects/:id/commits`

Recent commits. Query param: `?limit=` (default 30).

## `GET /projects/:id/changed`

List changed files (working tree).

## `GET /projects/:id/changes`

Full working tree diff.