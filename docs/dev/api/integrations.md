# Integrations

Routes: `src/api/routes/integrations.ts`

## `GET /integrations/cli-status`

Detect installed CLI agents (Claude Code, Codex, etc.). Returns which are available and their configuration status.

## `GET /integrations/github-status`

GitHub auth posture: whether `gh` is authenticated and as whom. The token value is never exposed.