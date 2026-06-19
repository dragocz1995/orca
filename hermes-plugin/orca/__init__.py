"""orca — control the orca task/mission orchestrator from a Hermes agent.

Registers a toolset ("orca") whose tools call orca's REST API using a base URL
and bearer token from config (env ORCA_URL / ORCA_TOKEN, or
~/.hermes/plugins/orca/config.yaml).
"""

from __future__ import annotations

from .tools import TOOLS


def register(ctx) -> None:
    for name, schema, handler in TOOLS:
        ctx.register_tool(
            name=name,
            toolset="orca",
            schema=schema,
            handler=handler,
            description=schema["description"],
            emoji="🐳",
        )
