"""MCP server exposing MFP backend automation actions."""
from __future__ import annotations

import asyncio
import json
import time
from typing import Any

import httpx
import mcp.server.stdio
import mcp.types as types
from mcp.server.lowlevel import NotificationOptions, Server
from mcp.server.models import InitializationOptions

from . import __version__
from .backend_client import AutomationAction, BackendClient
from .config import load_config


SERVER_NAME = "mfp-analysis"
DEFAULT_CATALOG_TTL_SECONDS = 30.0


def _pretty_json(value: Any) -> str:
    return json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False, default=str)


def _structured_result(payload: dict[str, Any], *, is_error: bool = False) -> types.CallToolResult:
    # Per MCP spec, ``structuredContent`` should match the tool's
    # ``outputSchema``. Error payloads don't, so omit ``structuredContent``
    # on the error path — clients that strictly validate would otherwise
    # reject the response.
    return types.CallToolResult(
        content=[types.TextContent(type="text", text=_pretty_json(payload))],
        structuredContent=None if is_error else payload,
        isError=is_error,
    )


def _http_error_payload(exc: httpx.HTTPStatusError) -> dict[str, Any]:
    response = exc.response
    try:
        detail = response.json()
    except ValueError:
        detail = response.text
    return {
        "status": "backend_error",
        "status_code": response.status_code,
        "detail": detail,
    }


def _requires_confirmation_payload(action: AutomationAction, preview: dict[str, Any]) -> dict[str, Any]:
    return {
        "status": "requires_confirmation",
        "action_id": action.id,
        "risk": action.risk,
        "scope": action.scope,
        "preview": preview,
        "message": "This action requires explicit confirmation before execution.",
    }


def _requires_open_app_payload(action: AutomationAction) -> dict[str, Any]:
    return {
        "status": "requires_open_app",
        "action_id": action.id,
        "risk": action.risk,
        "scope": action.scope,
        "message": "This action needs an open MFP browser tab and will be available after the browser bridge phase.",
    }


class MFPToolServer:
    def __init__(
        self,
        *,
        client: BackendClient | None = None,
        catalog_ttl_seconds: float = DEFAULT_CATALOG_TTL_SECONDS,
    ) -> None:
        self.config = load_config()
        self.client = client or BackendClient(self.config)
        self.server = Server(SERVER_NAME)
        self._catalog_ttl_seconds = catalog_ttl_seconds
        self._actions: dict[str, AutomationAction] = {}
        self._actions_expires_at: float = 0.0
        self._register_handlers()

    async def refresh_actions(self, *, force: bool = False) -> None:
        """Re-fetch the action catalog from the backend.

        Cached for ``self._catalog_ttl_seconds`` (default 30 s) so MCP clients
        that re-list tools frequently don't hammer the backend. Pass
        ``force=True`` to bypass the cache (e.g. after an `unknown_action` to
        pick up a newly-registered tool).
        """
        now = time.monotonic()
        if not force and self._actions and now < self._actions_expires_at:
            return
        actions = await self.client.list_actions()
        self._actions = {action.id: action for action in actions}
        self._actions_expires_at = now + self._catalog_ttl_seconds

    async def handle_list_tools(self) -> list[types.Tool]:
        await self.refresh_actions()
        return [
            types.Tool(
                name=action.id,
                description=action.summary,
                inputSchema=action.input_schema or {"type": "object"},
                outputSchema=action.output_schema or None,
            )
            for action in sorted(self._actions.values(), key=lambda item: item.id)
        ]

    async def handle_call_tool(
        self, name: str, arguments: dict[str, Any] | None
    ) -> types.CallToolResult:
        # Pick up newly-added actions if we get a name we don't recognize.
        if name not in self._actions:
            await self.refresh_actions(force=True)
        action = self._actions.get(name)
        if action is None:
            return _structured_result(
                {
                    "status": "unknown_action",
                    "action_id": name,
                    "message": f"Unknown MFP automation action: {name}",
                },
                is_error=True,
            )

        args = dict(arguments or {})
        if action.scope == "browser":
            return _structured_result(_requires_open_app_payload(action), is_error=True)

        if action.risk in {"confirm", "destructive"}:
            try:
                preview = await self.client.preview(action.id, args)
            except httpx.HTTPStatusError as exc:
                return _structured_result(_http_error_payload(exc), is_error=True)
            except httpx.HTTPError as exc:
                return _structured_result(
                    {
                        "status": "backend_unavailable",
                        "action_id": action.id,
                        "detail": str(exc),
                    },
                    is_error=True,
                )
            return _structured_result(_requires_confirmation_payload(action, preview), is_error=True)

        try:
            result = await self.client.execute(action.id, args)
        except httpx.HTTPStatusError as exc:
            payload = _http_error_payload(exc)
            if exc.response.status_code == 409 and "requires_open_app" in _pretty_json(payload):
                payload = _requires_open_app_payload(action)
            return _structured_result(payload, is_error=True)
        except httpx.HTTPError as exc:
            return _structured_result(
                {
                    "status": "backend_unavailable",
                    "action_id": action.id,
                    "backend_url": self.config.backend_url,
                    "detail": str(exc),
                },
                is_error=True,
            )

        return _structured_result(result)

    def _register_handlers(self) -> None:
        @self.server.list_tools()
        async def list_tools() -> list[types.Tool]:
            return await self.handle_list_tools()

        @self.server.call_tool()
        async def call_tool(name: str, arguments: dict[str, Any] | None) -> types.CallToolResult:
            return await self.handle_call_tool(name, arguments)

    async def run(self) -> None:
        try:
            await self.refresh_actions(force=True)
            async with mcp.server.stdio.stdio_server() as (read_stream, write_stream):
                await self.server.run(
                    read_stream,
                    write_stream,
                    InitializationOptions(
                        server_name=SERVER_NAME,
                        server_version=__version__,
                        capabilities=self.server.get_capabilities(
                            notification_options=NotificationOptions(),
                            experimental_capabilities={},
                        ),
                    ),
                )
        finally:
            await self.client.close()


async def run() -> None:
    await MFPToolServer().run()


def main() -> None:
    asyncio.run(run())
