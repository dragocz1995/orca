---
name: orca-control
description: Use when managing your own Orca instance — listing or creating tasks, planning work into a project, checking missions and live sessions, or scheduling recurring/one-shot prompts for yourself.
---

# Orca self-management

You run inside an Orca instance and can steer it through its control-plane tools. These tools are
only available in trusted (owner) sessions — platform channel sessions (e.g. Discord) never get
them, so if a tool below is missing you are in a channel session and must not attempt the operation.

## Control-plane tools

- `orca_list_tasks` — list tasks, optionally filtered by `project_id`. Use it first to see what
  already exists (and to discover valid project ids from existing tasks).
- `orca_create_task` — create one task (`title`, `project_id`, optional `description`). Tasks are
  units of work executed by worker agents inside a project checkout.
- `orca_plan` — hand Orca a `goal` and a `project_id`; it breaks the goal into a task plan. Prefer
  this over hand-creating many related tasks.
- `orca_list_missions` — list autopilot missions (long-running orchestrations).
- `orca_list_sessions` — list live agent sessions (what is running right now).

## Scheduling tools (cronjob plugin, admin only)

- `cron_add` — recurring prompt to yourself: `"every 15m"`, `"every 2h"`, `"daily 07:30"`,
  `"weekly sun 20:00"`. Optional `hours` active window and `notifyChannelId` delivery target.
- `schedule_wakeup` — ONE-SHOT wake-up (`"in 20m"`, `"at 18:30"`) that removes itself after running.
- `cron_list` / `cron_remove` — inspect and delete scheduled jobs.

## Tasks vs cron — picking the right tool

- Concrete piece of work on a project's code (fix, feature, investigation) → a **task**
  (`orca_create_task`), or `orca_plan` for a multi-step goal. Workers execute it; results are
  reviewable.
- Recurring self-prompts with no code deliverable (daily digest, periodic health check, reminder)
  → **`cron_add`**.
- "Check back on X later" during a conversation → **`schedule_wakeup`**, not a cron job.

## Safety rules

- Destructive or irreversible operations — `cron_remove`, `delete_skill`, cancelling running work —
  require the user's explicit confirmation in this conversation first. Never batch-delete.
- Creating tasks, plans, or scheduled jobs changes shared state: state clearly what you created
  (name/title + where) after doing it.
- Never guess a `project_id`. If you cannot derive it from `orca_list_tasks` or the conversation,
  ask.
- Do not schedule jobs that duplicate an existing one — check `cron_list` before `cron_add`.
