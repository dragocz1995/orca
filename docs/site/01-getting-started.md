---
title: Getting Started
slug: getting-started
order: 1
eyebrow: Start here
group: user
image: screenshots/onboarding.png
---

# Getting Started

You're five minutes away from running your first AI agent. Orca is a self-hosted agent platform — you bring the LLM provider, Orca gives you the control plane, the memory, the personality, the plugins, and the orchestration that turns a single agent into a coordinated system.

## Prerequisites

- **Node.js ≥ 22** — check with `node --version`
- **tmux** — check with `tmux -V` (install via your package manager if missing)

## Install and start

```bash
npm install -g orcasynth
orca up
```

`orca up` starts the daemon on **`:4400`** and the web UI on **`:4500`** in the background. Open <http://localhost:4500> — the first-run onboarding wizard takes it from here.

### Docker

```dockerfile
FROM node:22-alpine
RUN apk add --no-cache tmux
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN npm run build
EXPOSE 4400
CMD ["node", "dist/daemon/index.js"]
```

Build and run:

```bash
docker build -t orca .
docker run -d \
  --name orca \
  -p 4400:4400 \
  -v orca-data:/app/data \
  -e ORCA_DB=/app/data/orca.db \
  orca
```

### Run from source

For development or custom builds:

```bash
# Daemon (REST API on :4400)
npm install && npm run build
ORCA_BOOTSTRAP_USER=admin ORCA_BOOTSTRAP_PASS=changeme node dist/daemon/index.js

# Web UI (on :4500, separate terminal)
cd web && npm install && npm run build && npm start -- -p 4500
```

The CLI talks to the daemon over the REST API:

```bash
node dist/cli/index.js ls          # list tasks
node dist/cli/index.js close <id>  # close a task
```

## First-run onboarding

The first time you open the web UI, the onboarding wizard walks you through:

1. **System check** — detects installed agent CLIs (claude, opencode, codex) and tools (node, tmux, git).
2. **Provider binaries** — confirms binary paths and CLI args for each provider.
3. **Autopilot backend** — configure a Relay (API key + URL) or pick CLI agents for the Pilot and Overseer.
4. **Admin account** — create the first user. After this step you're signed in.
5. **Hermes** — optional MCP-server registration for a same-host Hermes instance.

After onboarding you land on the **Dashboard**, signed in with a secure httpOnly cookie.

## Connect your LLM provider

Orca doesn't ship an LLM — you plug in your own. Go to **Settings → Brain** and add an OpenAI-compatible provider with your API key. This powers both the assistant chat and the autopilot planner.

For coding agents (Claude Code, OpenCode, Codex, etc.), configure their binaries and API keys under **Settings → Providers**. Each agent brings its own key — Orca just orchestrates it.

## Your first agent

Now the fun part. You have two paths:

### Quick task — one agent, one job

1. Click **New task** on the Dashboard or the Tasks page.
2. Give it a title like "Add a health-check endpoint to the API".
3. Pick an executor (or leave it on Default).
4. Hit save — the agent spawns in its own tmux session and starts working.
5. Open **Sessions** to watch it live, or check **Tasks** for the result.

### Autopilot mission — decompose and conquer

1. Click **New mission**.
2. Describe the goal: "Set up user authentication with JWT tokens, login/logout endpoints, and middleware protection."
3. Pick an autonomy level (L1 · Assist is a safe start).
4. Hit engage — the Pilot decomposes the goal into ordered phases, and Orca runs them one by one, each in its own isolated session.

Either way, you can observe every agent in real time, step in when it needs you, and let it run hands-free when you trust it.

## What's next

- [Concepts](/docs/concepts) — agents, personality, memory, plugins, tasks, missions, autopilot, and how they all fit together
- [CLI reference](/docs/cli) — every command at your fingertips
- [Architecture](/docs/architecture) — modules, timer loops, data flow, access control

## Ports and data

| What | Where |
|---|---|
| Daemon REST API + SSE | `:4400` |
| Web UI (Next.js) | `:4500` |
| Config, SQLite DB, logs | `~/.config/orca/` |