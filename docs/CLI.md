# CLI Reference

The `orca` CLI connects to the daemon and provides quick access to common operations. Also used by spawned reasoning agents (Pilot, Overseer) to submit plans and answer decisions.

## Installation

```bash
npm link    # makes `orca` available globally
# or
node dist/cli/index.js <command>
```

## Global options

| Environment | Default | Description |
|---|---|---|
| `ORCA_URL` | `http://localhost:4400` | Daemon address |
| `ORCA_TOKEN` | — | API token for authenticated requests |
| `ORCA_AUTOSTART` | `1` | Auto-start daemon if not running (set `0` to disable) |
| `ORCA_DB` | — | Database path for the daemon (used internally) |
| `ORCA_PORT` | `4400` | Daemon HTTP port |
| `ORCA_BOOTSTRAP_USER` | — | Seed admin username on first boot |
| `ORCA_BOOTSTRAP_PASS` | — | Seed admin password on first boot |

## Commands

### `orca ls`

List all tasks.

```bash
orca ls
```

Outputs a JSON array of tasks:

```json
[
  {
    "id": "my-project-a1b2c3",
    "title": "Fix login page",
    "status": "open",
    "priority": "P2",
    "labels": ["exec:sonnet"]
  }
]
```

### `orca ready`

List tasks that are ready to be worked on (all dependencies fulfilled).

```bash
orca ready
```

```json
[
  {
    "id": "my-project-b2c3d4",
    "title": "Add footer",
    "status": "open"
  }
]
```

### `orca sessions`

List active tmux sessions.

```bash
orca sessions
```

```json
["orca-SwiftLake0", "orca-CalmRidge1"]
```

### `orca close`

Close a task with a result summary and outcome. Used by agents to signal completion.

```bash
orca close my-project-a1b2c3 --summary "Fixed the login redirect bug" --outcome ok
orca close my-project-d4e5f6 --summary "Could not reproduce the issue" --outcome fail
```

Flags:
| Flag | Description |
|---|---|
| `--summary <text>` | Human-readable result description |
| `--outcome ok|fail` | Outcome of the task |

Calls `PATCH /tasks/:id` with `status: "closed"`, `result_summary`, and `outcome`.

### `orca plan submit`

Used by the **Pilot agent** to submit a structured plan for an async planning job. The job ID is injected via the `ORCA_PLAN_JOB` environment variable — the Pilot never passes it manually.

```bash
orca plan submit --phases '[{"title":"Set up database","type":"chore"},{"title":"Create API endpoints","type":"feature"}]'
```

Flags:
| Flag | Description |
|---|---|
| `--phases <json>` | JSON array of phase objects (title + type + optional agent/details) |

Calls `POST /plan/:jobId/submit`. Exits with error if `ORCA_PLAN_JOB` is not set.

### `orca overseer poll`

Used by the parked **Overseer agent** to long-poll for pending decisions. Blocks until a decision is needed (or a heartbeat), returns the request JSON.

```bash
orca overseer poll
```

Outputs the next pending decision:

```json
{
  "id": "a1b2c3d4e5f6",
  "kind": "prompt",
  "context": {
    "question": "OpenCode needs permission to read src/config.ts",
    "options": [{ "id": "a", "label": "Allow" }, { "id": "r", "label": "Reject" }]
  }
}
```

Or `{}` on a heartbeat — the agent should poll again.

Requires `ORCA_MISSION` to be set (injected by the daemon at spawn time).

### `orca overseer decide`

Used by the parked **Overseer agent** to submit a verdict for a pending decision.

```bash
orca overseer decide --id a1b2c3d4e5f6 --approve --confidence 0.85 --rationale "Reading config is safe"
orca overseer decide --id a1b2c3d4e5f6 --escalate --rationale "This looks dangerous"
```

Flags:
| Flag | Description |
|---|---|
| `--id <id>` | Decision ID from `orca overseer poll` |
| `--approve` | Approve the action (auto-approve for `--confidence`, otherwise escalate) |
| `--escalate` | Escalate to a human (sets confidence 0) |
| `--confidence <0..1>` | Confidence level (default `0.7` for approve, `0` for escalate) |
| `--rationale "<text>"` | Reason for the decision |

Requires `ORCA_MISSION` to be set.

## Daemon autostart

The CLI automatically starts the daemon if it isn't running:

1. Hits `GET /health`
2. If unreachable, spawns `node dist/daemon/index.js` as a detached child process
3. Polls health endpoint up to 50 times (100ms interval) until ready
4. Times out with `"orca daemon did not become healthy"` if daemon fails to start

Disable with `ORCA_AUTOSTART=0`:

```bash
ORCA_AUTOSTART=0 orca ls
```

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Success |
| `1` | Error (daemon unreachable, invalid command) |

## Adding commands

New CLI commands are added in `src/cli/index.ts`:

```typescript
case 'mycommand':
  console.log(JSON.stringify(await c.mycommand(), null, 2));
  break;
```

And the corresponding method in `src/cli/client.ts`:

```typescript
async mycommand() { return this.req('/my-endpoint'); }
```
