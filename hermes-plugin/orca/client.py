"""Tiny stdlib HTTP client for orca's REST API (no third-party deps)."""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

from .config import load_config


def request(method: str, path: str, body: dict[str, Any] | None = None, query: dict[str, Any] | None = None) -> Any:
    """Call the orca daemon and return parsed JSON.

    Raises OrcaError on transport/HTTP/parse failures so tool handlers can
    turn it into a uniform JSON error envelope.
    """
    cfg = load_config()
    if not cfg.token:
        raise OrcaError("orca token not configured (set ORCA_TOKEN or plugins/orca/config.yaml)")
    url = f"{cfg.url}{path}"
    if query:
        clean = {k: v for k, v in query.items() if v not in (None, "")}
        if clean:
            url = f"{url}?{urllib.parse.urlencode(clean)}"
    data = json.dumps(body).encode("utf-8") if body is not None else None
    headers = {"authorization": f"Bearer {cfg.token}"}
    if data is not None:
        headers["content-type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method.upper())
    try:
        with urllib.request.urlopen(req, timeout=cfg.timeout) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as exc:  # 4xx/5xx — surface the orca error code
        detail = ""
        try:
            detail = json.loads(exc.read().decode("utf-8")).get("error", "")
        except Exception:
            pass
        raise OrcaError(f"orca {exc.code}{f' ({detail})' if detail else ''} on {method} {path}") from exc
    except urllib.error.URLError as exc:  # daemon unreachable
        raise OrcaError(f"cannot reach orca at {cfg.url}: {exc.reason}") from exc
    except json.JSONDecodeError as exc:
        raise OrcaError(f"orca returned non-JSON on {method} {path}") from exc


class OrcaError(Exception):
    pass


def ok(data: Any) -> str:
    return json.dumps({"ok": True, "data": data}, ensure_ascii=False)


def err(message: str) -> str:
    return json.dumps({"ok": False, "error": message}, ensure_ascii=False)
