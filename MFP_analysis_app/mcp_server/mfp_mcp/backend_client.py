"""Thin HTTP client for the MFP backend automation API.

Holds a single ``httpx.AsyncClient`` for the lifetime of the MCP server so
connection pooling actually works across the many tool calls of one session.
"""
from __future__ import annotations

from typing import Any

import httpx
from pydantic import BaseModel, Field

from .config import MCPConfig


class AutomationAction(BaseModel):
    id: str
    summary: str
    input_schema: dict[str, Any] = Field(default_factory=dict)
    output_schema: dict[str, Any] = Field(default_factory=dict)
    risk: str
    scope: str


class BackendClient:
    def __init__(self, config: MCPConfig, *, client: httpx.AsyncClient | None = None) -> None:
        self._config = config
        # If `client` is supplied, this BackendClient does NOT own its
        # lifecycle (used in tests with httpx.MockTransport). Otherwise we
        # build one and the caller is responsible for `await close()`.
        self._owns_client = client is None
        self._client = client or httpx.AsyncClient(
            base_url=config.backend_url,
            timeout=config.request_timeout,
        )

    async def close(self) -> None:
        if self._owns_client:
            await self._client.aclose()

    async def list_actions(self) -> list[AutomationAction]:
        response = await self._client.get("/api/automation/actions")
        response.raise_for_status()
        return [AutomationAction.model_validate(item) for item in response.json()]

    async def execute(self, action_id: str, args: dict[str, Any]) -> dict[str, Any]:
        response = await self._client.post(
            f"/api/automation/actions/{action_id}/execute", json=args
        )
        response.raise_for_status()
        return response.json()

    async def preview(self, action_id: str, args: dict[str, Any]) -> dict[str, Any]:
        response = await self._client.post(
            f"/api/automation/actions/{action_id}/preview", json=args
        )
        response.raise_for_status()
        return response.json()
