# Git Project Model Preference Design

## Goal

Remember a CLI model selection per user and Git project, so restarting Elowen from another directory in the same checkout uses the chosen provider and model.

## Scope and invariants

- The preference scope is the canonical Git worktree root, not a raw client path.
- Conversation addressing remains exactly as it is today: sessions are still resolved and stamped by exact canonical `cwd`.
- A preference stores both provider and model, and is private to one Elowen user.
- Only a validated client directory may establish a project scope. For scoped users, the discovered Git root must itself be inside an allowed project path.
- A non-Git directory has no project preference and uses the existing global/default selection path.

## Resolution

On a new live spawn, resolve a model in this exact order:

1. Explicit `start` model/provider options.
2. Saved selection for the validated Git project root of `clientCwd` or carried `spawnCwd`.
3. The existing global CLI account setting.
4. The configured server default.

Every candidate is passed through the existing model-allow policy. A revoked or unavailable project preference is ignored, never blocks the chat, and allows the next fallback.

## Persistence and write path

`UserSettingStore` owns a typed, validated JSON map under one per-user setting key. Its keys are canonical project roots and values are `{ provider, model }`. `/model` continues to switch the current live conversation immediately; after a successful switch it writes that selection to the current session's Git-project scope. Cwd-less web/channel sessions do not write a project preference.

## Testing

Focused tests cover the store's corruption/isolation behavior, selecting a model in one Git checkout, respawning from a subdirectory of the same checkout, isolation from a second checkout, explicit start override, and fallback when a saved selection becomes disallowed.
