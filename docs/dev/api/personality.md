# Personality

Routes: `src/api/routes/personality.ts`, schemas: `src/api/schemas/personality.ts`

Per-user personality profiles for the brain/advisor. Self-service — identity is always the caller. Agent tokens never reach these routes.

## `GET /personality/profiles`

List the caller's profiles. Optional `?platform=` filter.

## `POST /personality/profiles`

Create a profile. Body: `{ name, platform, body }`.

## `PATCH /personality/profiles/:id`

Update a profile. Owner-scoped (404 on foreign ID).

## `DELETE /personality/profiles/:id`

Delete a profile. Clears any active pointer to it. Owner-scoped.

## `POST /personality/profiles/:id/activate`

Pin a profile as active for its platform. Restarts the owner's brain session and drops channel sessions so they respawn on the fresh persona.