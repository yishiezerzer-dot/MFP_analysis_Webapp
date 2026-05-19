"""Configuration for the local MFP MCP server."""
from __future__ import annotations

import os
from dataclasses import dataclass


DEFAULT_BACKEND_URL = "http://127.0.0.1:8000"
DEFAULT_REQUEST_TIMEOUT = 60.0


@dataclass(frozen=True)
class MCPConfig:
    backend_url: str = DEFAULT_BACKEND_URL
    request_timeout: float = DEFAULT_REQUEST_TIMEOUT


def _float_from_env(name: str, default: float) -> float:
    raw = os.environ.get(name)
    if raw is None or not raw.strip():
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def load_config() -> MCPConfig:
    backend_url = os.environ.get("MFP_BACKEND_URL", DEFAULT_BACKEND_URL).strip()
    if not backend_url:
        backend_url = DEFAULT_BACKEND_URL
    return MCPConfig(
        backend_url=backend_url.rstrip("/"),
        request_timeout=_float_from_env("MFP_MCP_TIMEOUT", DEFAULT_REQUEST_TIMEOUT),
    )
