# Activity & Notes

Routes: `src/api/routes/activity.ts`, schemas: `src/api/schemas/activity.ts`

## `GET /activity`

Activity timeline scoped to the caller's accessible projects. Query params: `?limit=`, `?type=`, `?target=` (task ID for a detail pane feed).

## `GET /notes`

List handoff notes for a target (epic ID). Query params: `?scope=` (default `mission`), `?target=` (epic ID, `m-` prefix stripped). Project-gated: the target must resolve to an existing epic the caller may access.

## `POST /notes`

Add a handoff note. Body: `{ scope, target, author, body }`. Max 8000 chars per note, max 200 notes per target.