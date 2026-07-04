---
title: Concepts
slug: concepts
order: 2
eyebrow: How Orca works
group: user
image: screenshots/dashboard.png
---

# Concepts

Orca is an **agent platform** with built-in orchestration. It gives you a persistent, self-hosted agent that can reason, remember, act on your behalf — and when the job is too big for one agent, it plans the work and dispatches a swarm.

This page covers the mental model: what the pieces are and how they connect.

## Agents

An **agent** is any AI worker that Orca can spawn and manage. Orca is agent-agnostic: it runs whichever CLI tools you have installed — Claude Code, OpenCode, Codex, Kilo Code, Pi, or oh-my-pi — each in its own isolated `tmux` session.

Agents are configured under **Settings → Providers**. Each provider gets its binary path, extra CLI args, and optional flags. When a task needs an agent, Orca picks the right one based on the executor label or your configured default.

### The Assistant

The **Assistant** is your personal agent that lives in a docked side panel in the web UI. It's not a task worker — it's a full conversational agent with access to Orca's own API through a built-in MCP server. It can create tasks, plan missions, list sessions, and reach any Orca endpoint — with exactly your own permissions. It auto-starts on login once configured.

The Assistant is powered by the **Brain** — Orca's internal agent runtime — which supports:

- **Multiple providers** — add OpenAI-compatible providers in Settings → Brain, each with its own key and model.
- **Per-user model selection** — every user can pick their preferred model for the Assistant.
- **Vision** — attach images and the Assistant sees them, with a configurable vision model fallback.
- **Streaming** — responses stream in real time, tool calls appear as they execute.

### The Pilot and Overseer

Two special agents power the autopilot:

- **The Pilot** reads your project's conventions (AGENTS.md, CLAUDE.md, README), decomposes your goal into ordered phases, and submits the plan. It plans — it does not implement.
- **The Overseer** is the decision gate. When a worker agent hits a permission prompt ("can I run this command?"), the Overseer judges whether it's safe. You can configure a relay LLM or a parked CLI agent as the Overseer. The gate applies a confidence threshold — stricter for L1, standard for L2/L3.

## Personality

Orca isn't a faceless API. The Assistant has a configurable **personality** — how it talks, not what it does. You choose from four styles:

| Style | Description |
|---|---|
| **Professional** | Formal, precise, vykani in Czech. Businesslike register. |
| **Friendly** | Warm, conversational, tykani in Czech. Light humor when it fits. |
| **Concise** | Fewest words that fully answer. No preamble, no filler. |
| **Detailed** | Explains reasoning, surfaces tradeoffs, teaches as it goes. |

Beyond the built-in styles, you can create **personality profiles** — custom personas with a name, tone, style, and freeform prompt. Each profile can be pinned per platform (one persona for Discord, another for the web chat). The personality system is per-user: your profiles shape your Assistant, not anyone else's.

## Memory

The Assistant can remember things across conversations. Orca's memory system has two layers:

### Built-in memory

Every conversation automatically recalls relevant memories before generating a response. The built-in memory:

- **Recall** — searches your stored memories by semantic similarity, weighted by importance, recency, and usage frequency. The top results are injected into the conversation context.
- **Save** — after each turn, a curator determines whether a new fact is worth persisting (important, non-trivial, not already known). Worthwhile facts are saved automatically.
- **Categorize** — memories can be organized into user-defined categories. A categorizer model auto-sorts new memories, and you can manage categories in the Memory section of the web UI.
- **Audit** — the Memory view shows every saved fact with a retrieval-debug panel that explains exactly why each memory was or wasn't recalled for a given query.

Memory is per-user and scoped by identity. Your own chat memories are private; a shared channel (Discord) only sees memories belonging to the verified account that sent the message.

### mem0 plugin

For long-term memory backed by a self-hosted mem0 server, enable the **memory** plugin in Settings → Plugins. This adds `add_memory` and `search_memory` tools to the Assistant's toolset, letting it explicitly save and recall facts through mem0's REST API.

## Plugins

Plugins extend what the Assistant can do. They're Node modules that register tools, skills, platforms, hooks, and prompt fragments into the Brain at runtime. Toggle them live in **Settings → Plugins** — no restart needed.

### Built-in plugins

| Plugin | What it adds |
|---|---|
| **Discord** | Bot platform — mention it and it answers from Orca AI. Slash commands, per-channel model picker, streaming replies, voice (STT/TTS), role-based access, status reactions, proactive notifications. |
| **memory** | Long-term memory via a self-hosted mem0 server — `add_memory` and `search_memory` tools. |
| **skills** | Loads markdown skills from disk and injects them into the Assistant's context. |
| **subagent** | `delegate` tool — spin up an isolated sub-agent for a self-contained task. The sub-agent inherits the caller's access, never more. |
| **cronjob** | Scheduled prompts — recurring jobs ("every 30 min") and one-shot wake-ups ("in 20 min") that run as the brain's own conversations with full owner powers. |
| **terminal** | `run_command`, `list_processes`, `read_process_output`, `kill_process` — shell access confined to accessible repositories. |
| **files** | `read_file`, `write_file`, `edit_file`, `list_dir` — file operations within accessible project paths. |
| **web** | `web_search` (Tavily) and `web_fetch` (page-to-text) — web research from the chat. |
| **image-gen** | `generate_image` — image generation via the OpenAI Images API. |
| **image-edit** | `edit_image` — edit an existing image from a text instruction (image-to-image). |
| **security-scan** | `scan_code` — scan code for dangerous patterns (eval, pickle.load, hardcoded secrets) before relying on it. |
| **runtime-context** | Injects the current date, time, weekday, and timezone into every turn so the agent never guesses about "now". |
| **statusline** | Shows context usage, session token totals, and cost under the conversation. |

### Plugin architecture

Each plugin declares a manifest (`orca-plugin.json`) with:

- **tools** — new capabilities the Assistant can invoke.
- **skills** — markdown skill files injected into the system prompt.
- **platforms** — external conversation surfaces (Discord, cron, subagent).
- **hooks** — lifecycle hooks that run before/after agent actions.
- **prompt fragments** — text appended to the system prompt on every turn.
- **turn contexts** — dynamic context injected per-turn (like runtime-context's date/time).

Plugins run inside a security sandbox. Path-guarded tools confine file and command access to the user's accessible repositories. Each plugin's provider access is scoped to only the providers it was explicitly configured with. The tool filter system allows per-role tool allowlists, so a Discord user with a limited role can only use approved tools.

## Tasks and missions

### Tasks

A **task** is a single unit of work. You give it a title, optional details, pick an executor, and assign it to a project. Tasks can depend on other tasks — a task won't start until its dependencies are done.

Tasks flow through a lifecycle:

```
open → in_progress → closed
  ↓                    ↑
blocked ───────────────┘ (unblock to retry)
  ↓
cancelled
```

| Status | What it means |
|---|---|
| `open` | Waiting to be picked up |
| `in_progress` | An agent is working on it right now |
| `blocked` | Something went wrong — needs a human to unblock |
| `closed` | Done |
| `cancelled` | Abandoned |

### Missions (autopilot)

A **mission** turns a high-level goal into an autonomous run. You describe what you want, pick an autonomy level, and the Pilot decomposes the goal into phases — a tree of tasks under an epic. The mission engine ticks every 90 seconds: it picks ready tasks, spawns agents up to your configured `max_sessions`, and works through the phases until everything is done.

Mission states: `active` (running), `paused` (suspended), `stalled` (waiting on you), `disengaged` (complete).

## Autonomy levels

You decide how much rope the autopilot gets:

| Level | What it means for you |
|---|---|
| **L0 · Recommend** | The Pilot plans and proposes. Nothing runs until you approve it. |
| **L1 · Assist** | Runs clear, safe steps on its own. Anything uncertain or sensitive waits for your approval. |
| **L2 · Pilot** | Runs work and clears agent permission prompts itself. Ambiguous or risky situations are escalated to you. |
| **L3 · Auto** | Full autonomy. Runs and clears everything itself, reaching out only when it genuinely cannot decide. |

Destructive operations (`rm -rf`, dropping tables, force-pushes, touching `.env`) always escalate to a human, whatever the level.

## Sessions

Every agent runs in its own **`tmux` session** — isolated, persistent, observable. From the web UI you can:

- Watch a live, ANSI-colored tail of the agent's terminal.
- Click into any session to get a **full PTY** — type straight into it, take over mid-run, scroll back through history.
- Pop a terminal out into its own window.

When an agent is waiting on a permission prompt, the session card shows **Allow / Reject** buttons right there. You can also act from phone push notifications.

### The Deriver

The **Deriver** watches every agent session in real time. It polls `tmux` every 5 seconds and detects what the agent is doing:

| Signal | Meaning |
|---|---|
| `working` | Agent is progressing normally |
| `needs_input` | Agent is waiting on a permission prompt or user input |
| `complete` | Task is done |

Prompt detection is per-provider (OpenCode's "Permission required", Claude Code's "Do you want to proceed?", Codex's "Allow command?"). For L1–L3, environmental gates are auto-accepted; other prompts go through the Overseer. For L0, everything escalates to you.

## PR-native workflow

Off by default. When enabled, each mission runs in an **isolated git worktree** on its own branch. When a phase completes, the daemon commits the changes. When the whole epic is done, it pushes the branch and opens a **GitHub pull request**.

The PR becomes the final human gate: the daemon polls for reviews and comments, routes actionable feedback back through the Pilot, and pushes fixes to the same PR. A fix-round budget (2 automatic rounds) prevents infinite bot ping-pong.

## Access control and multi-tenancy

Three token scopes govern what an API caller may do:

| Scope | Purpose |
|---|---|
| `full` | Interactive user session — bounded by the user's role and project assignments |
| `agent` | Spawned task worker — restricted to a narrow allow-list of verbs, confined to its live working set |
| `advisor` | Per-user Assistant — mapped to `full` rights but isolated from login tokens |

With a multi-user store, non-admins are gated by project assignments and per-user model allow-lists. Admins and single-user mode pass everything unrestricted.

### Identity and policy

Every turn through the Brain carries a **TurnIdentity** (who is driving) and a **Policy** (what they may access). The identity is established exactly once per turn — whether it's your own authenticated chat, a Discord message, a cron tick, or a delegated sub-agent. Policy scopes file access to the user's assigned projects. The owner's own chat gets full access; a shared channel never gets the owner's API token, whatever role the sender holds.

## Handoff notes

Agents working the same mission can leave notes for each other. Any agent can run `orca note add <missionId> "context for the next phase"` and the next agent reads them with `orca note ls <missionId>`. Notes are scoped to the mission and cleaned up when the mission ends.

## Platforms

Orca isn't just the web UI. Through platform adapters, your agent reaches external conversation surfaces:

- **Discord** — mention the bot and it answers. Per-channel model picker, slash commands (`/model`, `/new`, `/help`), streaming replies, status reactions, voice (STT/TTS), and proactive notifications. Role-based access maps Discord roles to Orca projects and tool allowlists.
- **Cron** — scheduled prompts that run as the brain's own conversations. Recurring ("every 30 min") or one-shot ("in 20 min").
- **Subagent** — the `delegate` tool spins up a fresh isolated agent for a self-contained task, inheriting the caller's access level, never more.

Each platform adapter resolves the sender's identity, maps it to a Policy, and routes the conversation through the same Brain pipeline — so your agent is always your agent, whether you're talking to it from the web, CLI, or Discord.

---

For the full command reference see the [CLI docs](/docs/cli), for the web UI tour see [Using Orca](/docs/using-orca), and for daemon internals see [Architecture](/docs/architecture).