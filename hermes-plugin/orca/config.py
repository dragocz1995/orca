"""Configuration loading for the orca Hermes plugin.

Resolution order (first non-empty wins): environment variable, then
`~/.hermes/plugins/orca/config.yaml` (key under the top-level `orca:` block),
then a built-in default.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

try:  # PyYAML ships with Hermes; degrade gracefully if absent.
    import yaml
except ImportError:  # pragma: no cover
    yaml = None  # type: ignore


def _config_file_section() -> dict[str, Any]:
    """Read the `orca:` section from ~/.hermes/plugins/orca/config.yaml."""
    if yaml is None:
        return {}
    home = os.getenv("HERMES_HOME") or str(Path.home() / ".hermes")
    path = Path(home) / "plugins" / "orca" / "config.yaml"
    try:
        if path.exists():
            data = yaml.safe_load(path.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                section = data.get("orca", data)
                return section if isinstance(section, dict) else {}
    except Exception:  # pragma: no cover - never let bad config crash the agent
        pass
    return {}


def _env_or(section: dict[str, Any], env: str, key: str, default: str) -> str:
    val = os.getenv(env, "").strip()
    if val:
        return val
    fv = section.get(key)
    return str(fv).strip() if fv not in (None, "") else default


class OrcaConfig:
    __slots__ = ("url", "token", "timeout")

    def __init__(self, url: str, token: str, timeout: int) -> None:
        self.url = url.rstrip("/")
        self.token = token
        self.timeout = timeout


def load_config() -> OrcaConfig:
    section = _config_file_section()
    url = _env_or(section, "ORCA_URL", "url", "http://localhost:4400")
    token = _env_or(section, "ORCA_TOKEN", "token", "")
    timeout_raw = _env_or(section, "ORCA_TIMEOUT", "timeout", "30")
    try:
        timeout = int(timeout_raw)
    except ValueError:
        timeout = 30
    return OrcaConfig(url=url, token=token, timeout=timeout)
