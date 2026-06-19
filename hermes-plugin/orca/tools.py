"""Tool schemas + handlers for controlling orca from a Hermes agent.

Each handler takes the LLM's argument dict and returns a JSON string envelope
`{"ok": true, "data": ...}` or `{"ok": false, "error": "..."}`.
"""

from __future__ import annotations

import urllib.parse
from typing import Any

from .client import OrcaError, err, ok, request


def _q(name: str) -> str:
    return urllib.parse.quote(name, safe="")


# ── health ────────────────────────────────────────────────────────────────
HEALTH_SCHEMA = {
    "name": "orca_health",
    "description": "Check that the orca daemon is reachable and responding.",
    "input_schema": {"type": "object", "properties": {}, "additionalProperties": False},
}

def orca_health(_args: dict[str, Any] | None = None, **_kw: Any) -> str:
    try:
        return ok(request("GET", "/health"))
    except OrcaError as e:
        return err(str(e))


# ── tasks ─────────────────────────────────────────────────────────────────
TASKS_SCHEMA = {
    "name": "orca_tasks",
    "description": "List orca tasks. Optionally filter by status and cap the count. Returns id, title, status, type, labels, outcome and result_summary for each.",
    "input_schema": {
        "type": "object",
        "properties": {
            "status": {"type": "string", "enum": ["open", "in_progress", "blocked", "closed", "cancelled"], "description": "Optional status filter."},
            "limit": {"type": "integer", "minimum": 1, "maximum": 200, "default": 50, "description": "Max tasks to return (newest first)."},
        },
        "additionalProperties": False,
    },
}

def orca_tasks(args: dict[str, Any] | None = None, **_kw: Any) -> str:
    args = args or {}
    status = (args.get("status") or "").strip() or None
    limit = int(args.get("limit") or 50)
    try:
        tasks = request("GET", "/tasks") or []
    except OrcaError as e:
        return err(str(e))
    if status:
        tasks = [t for t in tasks if t.get("status") == status]
    tasks = list(reversed(tasks))[:limit]
    slim = [{k: t.get(k) for k in ("id", "title", "status", "type", "labels", "outcome", "result_summary", "parent_id")} for t in tasks]
    return ok(slim)


CREATE_TASK_SCHEMA = {
    "name": "orca_create_task",
    "description": "Create a new orca task. Returns the created task (with its generated id).",
    "input_schema": {
        "type": "object",
        "properties": {
            "title": {"type": "string", "description": "Short task title."},
            "type": {"type": "string", "enum": ["task", "feature", "bug", "chore"], "default": "task"},
            "priority": {"type": "string", "enum": ["P0", "P1", "P2", "P3"], "default": "P2"},
            "description": {"type": "string", "description": "Full context for the agent that will run it."},
            "deps": {"type": "array", "items": {"type": "string"}, "description": "Task ids this task waits on."},
        },
        "required": ["title"],
        "additionalProperties": False,
    },
}

def orca_create_task(args: dict[str, Any] | None = None, **_kw: Any) -> str:
    args = args or {}
    title = (args.get("title") or "").strip()
    if not title:
        return err("title is required")
    body = {"title": title}
    for k in ("type", "priority", "description"):
        if args.get(k):
            body[k] = args[k]
    if isinstance(args.get("deps"), list):
        body["deps"] = args["deps"]
    try:
        return ok(request("POST", "/tasks", body))
    except OrcaError as e:
        return err(str(e))


CLOSE_TASK_SCHEMA = {
    "name": "orca_close_task",
    "description": "Close (archive) an orca task with a one-line result summary and outcome.",
    "input_schema": {
        "type": "object",
        "properties": {
            "id": {"type": "string", "description": "Task id to close."},
            "summary": {"type": "string", "description": "What was done and the result."},
            "outcome": {"type": "string", "enum": ["ok", "fail"], "default": "ok"},
        },
        "required": ["id"],
        "additionalProperties": False,
    },
}

def orca_close_task(args: dict[str, Any] | None = None, **_kw: Any) -> str:
    args = args or {}
    task_id = (args.get("id") or "").strip()
    if not task_id:
        return err("id is required")
    body = {"status": "closed", "result_summary": args.get("summary") or "", "outcome": args.get("outcome") or "ok"}
    try:
        return ok(request("PATCH", f"/tasks/{_q(task_id)}", body))
    except OrcaError as e:
        return err(str(e))


# ── autopilot: plan / insert / replan ───────────────────────────────────────
PLAN_SCHEMA = {
    "name": "orca_plan",
    "description": "Decompose a goal into an epic with ordered phase sub-tasks (autopilot). Optionally engage a mission so agents run the phases autonomously. Use dryRun to preview phases without creating anything, or pass explicit phases to skip the planner LLM.",
    "input_schema": {
        "type": "object",
        "properties": {
            "goal": {"type": "string", "description": "The high-level goal to decompose."},
            "exec": {"type": "string", "description": "Executor model for the phases (must be in the orca allow-list, e.g. 'sonnet' or 'ollama-cloud/glm-5.2')."},
            "autonomy": {"type": "string", "enum": ["L0", "L1", "L2", "L3"], "default": "L3"},
            "maxSessions": {"type": "integer", "minimum": 1, "default": 1, "description": "Max concurrent agents for the mission."},
            "engage": {"type": "boolean", "default": False, "description": "Start a mission immediately."},
            "dryRun": {"type": "boolean", "default": False, "description": "Return phases without persisting."},
            "phases": {"type": "array", "items": {"type": "object", "properties": {"title": {"type": "string"}, "type": {"type": "string"}}}, "description": "Explicit phases (manual mode — skips the planner)."},
        },
        "required": ["goal"],
        "additionalProperties": False,
    },
}

def orca_plan(args: dict[str, Any] | None = None, **_kw: Any) -> str:
    args = args or {}
    goal = (args.get("goal") or "").strip()
    if not goal:
        return err("goal is required")
    body: dict[str, Any] = {"goal": goal}
    for k in ("exec", "autonomy", "maxSessions", "engage", "dryRun", "phases"):
        if args.get(k) is not None:
            body[k] = args[k]
    try:
        return ok(request("POST", "/tasks/plan", body))
    except OrcaError as e:
        return err(str(e))


INSERT_PHASES_SCHEMA = {
    "name": "orca_insert_phases",
    "description": "Append phases to an existing epic — a manual list, or a 'goal' to replan (decompose a residual goal). New phases run after the epic's current phases; an active mission picks them up automatically.",
    "input_schema": {
        "type": "object",
        "properties": {
            "epicId": {"type": "string", "description": "The epic task id to append phases to."},
            "phases": {"type": "array", "items": {"type": "object", "properties": {"title": {"type": "string"}, "type": {"type": "string"}}}, "description": "Explicit phases to insert."},
            "goal": {"type": "string", "description": "Residual goal to decompose into phases (replan)."},
            "exec": {"type": "string", "description": "Executor model for the new phases."},
        },
        "required": ["epicId"],
        "additionalProperties": False,
    },
}

def orca_insert_phases(args: dict[str, Any] | None = None, **_kw: Any) -> str:
    args = args or {}
    epic_id = (args.get("epicId") or "").strip()
    if not epic_id:
        return err("epicId is required")
    if not args.get("phases") and not (args.get("goal") or "").strip():
        return err("provide either phases or goal")
    body: dict[str, Any] = {}
    for k in ("phases", "goal", "exec"):
        if args.get(k) is not None:
            body[k] = args[k]
    try:
        return ok(request("POST", f"/tasks/{_q(epic_id)}/phases", body))
    except OrcaError as e:
        return err(str(e))


# ── missions ────────────────────────────────────────────────────────────────
MISSIONS_SCHEMA = {
    "name": "orca_missions",
    "description": "List active missions, or get one mission's full detail tree (tasks, deps, progress) when 'id' is given.",
    "input_schema": {
        "type": "object",
        "properties": {"id": {"type": "string", "description": "Optional mission id for full detail."}},
        "additionalProperties": False,
    },
}

def orca_missions(args: dict[str, Any] | None = None, **_kw: Any) -> str:
    args = args or {}
    mid = (args.get("id") or "").strip()
    try:
        return ok(request("GET", f"/missions/{_q(mid)}" if mid else "/missions"))
    except OrcaError as e:
        return err(str(e))


MISSION_CONTROL_SCHEMA = {
    "name": "orca_mission_control",
    "description": "Control a running mission: pause, resume, or disengage (stop) it.",
    "input_schema": {
        "type": "object",
        "properties": {
            "id": {"type": "string", "description": "Mission id (e.g. 'm-orca-ab12cd34')."},
            "action": {"type": "string", "enum": ["pause", "resume", "disengage"]},
        },
        "required": ["id", "action"],
        "additionalProperties": False,
    },
}

def orca_mission_control(args: dict[str, Any] | None = None, **_kw: Any) -> str:
    args = args or {}
    mid = (args.get("id") or "").strip()
    action = (args.get("action") or "").strip()
    if not mid or action not in ("pause", "resume", "disengage"):
        return err("id and a valid action (pause|resume|disengage) are required")
    try:
        if action == "disengage":
            return ok(request("DELETE", f"/missions/{_q(mid)}"))
        return ok(request("PATCH", f"/missions/{_q(mid)}", {"action": action}))
    except OrcaError as e:
        return err(str(e))


# ── live sessions ────────────────────────────────────────────────────────────
SESSIONS_SCHEMA = {
    "name": "orca_sessions",
    "description": "List the live agent tmux sessions currently running under orca.",
    "input_schema": {"type": "object", "properties": {}, "additionalProperties": False},
}

def orca_sessions(_args: dict[str, Any] | None = None, **_kw: Any) -> str:
    try:
        return ok(request("GET", "/sessions"))
    except OrcaError as e:
        return err(str(e))


SESSION_PANE_SCHEMA = {
    "name": "orca_session_pane",
    "description": "Read the recent terminal output of a live agent session to see what it is doing right now.",
    "input_schema": {
        "type": "object",
        "properties": {"name": {"type": "string", "description": "Session name, e.g. 'orca-nova'."}},
        "required": ["name"],
        "additionalProperties": False,
    },
}

def orca_session_pane(args: dict[str, Any] | None = None, **_kw: Any) -> str:
    args = args or {}
    name = (args.get("name") or "").strip()
    if not name:
        return err("name is required")
    try:
        return ok(request("GET", f"/sessions/{_q(name)}/pane"))
    except OrcaError as e:
        return err(str(e))


SEND_KEYS_SCHEMA = {
    "name": "orca_send_keys",
    "description": "Send keystrokes to a live agent session — e.g. answer a permission prompt with ['Enter'] (allow) or ['Escape'] (reject), or ['C-c'] to interrupt.",
    "input_schema": {
        "type": "object",
        "properties": {
            "name": {"type": "string", "description": "Session name."},
            "keys": {"type": "array", "items": {"type": "string"}, "description": "tmux keys, e.g. ['Enter'], ['Escape'], ['C-c']."},
        },
        "required": ["name", "keys"],
        "additionalProperties": False,
    },
}

def orca_send_keys(args: dict[str, Any] | None = None, **_kw: Any) -> str:
    args = args or {}
    name = (args.get("name") or "").strip()
    keys = args.get("keys")
    if not name or not isinstance(keys, list) or not keys:
        return err("name and a non-empty keys array are required")
    try:
        return ok(request("POST", f"/sessions/{_q(name)}/keys", {"keys": keys}))
    except OrcaError as e:
        return err(str(e))


# Tool registry: (name, toolset, schema, handler) — consumed by __init__.register.
TOOLS = [
    ("orca_health", HEALTH_SCHEMA, orca_health),
    ("orca_tasks", TASKS_SCHEMA, orca_tasks),
    ("orca_create_task", CREATE_TASK_SCHEMA, orca_create_task),
    ("orca_close_task", CLOSE_TASK_SCHEMA, orca_close_task),
    ("orca_plan", PLAN_SCHEMA, orca_plan),
    ("orca_insert_phases", INSERT_PHASES_SCHEMA, orca_insert_phases),
    ("orca_missions", MISSIONS_SCHEMA, orca_missions),
    ("orca_mission_control", MISSION_CONTROL_SCHEMA, orca_mission_control),
    ("orca_sessions", SESSIONS_SCHEMA, orca_sessions),
    ("orca_session_pane", SESSION_PANE_SCHEMA, orca_session_pane),
    ("orca_send_keys", SEND_KEYS_SCHEMA, orca_send_keys),
]
