# orca — Hermes plugin

Give a [Hermes](https://github.com/NousResearch/hermes-agent) agent the tools to
**fully operate orca** — the self-hosted task/mission orchestrator — over its REST
API. The agent can list and create tasks, plan and engage autopilot missions,
insert or replan phases, watch live agent sessions and answer their prompts.

## Tools (`orca` toolset)

| Tool | What it does |
|------|--------------|
| `orca_health` | Check the daemon is reachable. |
| `orca_tasks` | List tasks (optional status filter + limit). |
| `orca_create_task` | Create a task (title, type, priority, description, deps). |
| `orca_close_task` | Close a task with a result summary + outcome. |
| `orca_plan` | Decompose a goal into an epic + phases; optionally engage a mission. |
| `orca_insert_phases` | Append phases to an epic — a manual list, or a goal to replan. |
| `orca_missions` | List active missions, or one mission's full detail tree. |
| `orca_mission_control` | Pause / resume / disengage a mission. |
| `orca_sessions` | List live agent tmux sessions. |
| `orca_session_pane` | Read a live agent's recent terminal output. |
| `orca_send_keys` | Send keys to a session — e.g. `["Enter"]` to allow a prompt. |

Every tool returns a JSON envelope: `{"ok": true, "data": …}` or `{"ok": false, "error": "…"}`.

## Configuration

The plugin reads, in order of precedence: environment variable → `config.yaml` → default.

| Setting | Env | config.yaml key | Default |
|---------|-----|-----------------|---------|
| orca API base URL | `ORCA_URL` | `orca.url` | `http://localhost:4400` |
| Bearer token (required) | `ORCA_TOKEN` | `orca.token` | — |
| Request timeout (s) | `ORCA_TIMEOUT` | `orca.timeout` | `30` |

Get a token from orca:

```bash
curl -s -X POST http://localhost:4400/auth/login \
  -H 'content-type: application/json' \
  -d '{"username":"admin","password":"…"}' | jq -r .token
```

## Install

### From the orca dashboard (recommended)

**Settings → Hermes → Install plugin.** Enter the Hermes home directory, confirm the
orca URL + token to bake in, and install. orca copies the plugin into Hermes, writes
its config, and enables it. Restart the Hermes gateway to activate.

### Manually

```bash
# 1. Copy the plugin into the Hermes plugins dir
cp -r hermes-plugin/orca ~/.hermes/plugins/orca

# 2. Write its config (url + token)
cat > ~/.hermes/plugins/orca/config.yaml <<'YAML'
orca:
  url: "http://localhost:4400"
  token: "<your-orca-token>"
  timeout: 30
YAML

# 3. Enable it in ~/.hermes/config.yaml under plugins.enabled:
#      plugins:
#        enabled:
#          - orca
#
# 4. Restart the Hermes gateway.
```

## Layout

```
hermes-plugin/orca/
├── plugin.yaml          # manifest (name, version, kind: standalone, provides_tools)
├── __init__.py          # register(ctx) — registers the toolset
├── tools.py             # tool schemas + handlers
├── client.py            # tiny stdlib HTTP client for the orca API
├── config.py            # config resolution (env → yaml → default)
└── config.example.yaml  # sample per-instance config
```

No third-party dependencies — uses only the Python standard library (plus PyYAML,
which Hermes already ships, for reading `config.yaml`).
