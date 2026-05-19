"""Unit tests for the MFP MCP server.

Uses ``httpx.MockTransport`` to fake the backend automation API and exercises
``MFPToolServer.handle_call_tool`` for each routing branch:
- safe backend action -> execute -> structured result
- browser-scope action -> requires_open_app (no backend call)
- confirm / destructive risk -> preview -> requires_confirmation
- unknown action -> structured unknown_action error
- backend HTTP error -> structured backend_error
- backend network error -> structured backend_unavailable
- backend 409 + 'requires_open_app' body -> requires_open_app (forward-compat
  for the phase-4 browser bridge)
"""
from __future__ import annotations

import json
from typing import Any

import httpx
import pytest

from mfp_mcp.backend_client import BackendClient
from mfp_mcp.config import MCPConfig
from mfp_mcp.server import (
    MFPToolServer,
    _http_error_payload,
    _requires_confirmation_payload,
    _requires_open_app_payload,
    _structured_result,
)


CATALOG = [
    {
        "id": "lcms.list_sessions",
        "summary": "List loaded LCMS sessions.",
        "input_schema": {"type": "object"},
        "output_schema": {"type": "object"},
        "risk": "safe",
        "scope": "backend",
    },
    {
        "id": "lcms.clear_eics",
        "summary": "Clear all EIC plots.",
        "input_schema": {"type": "object"},
        "output_schema": {"type": "object"},
        "risk": "confirm",
        "scope": "browser",
    },
    {
        "id": "lcms.delete_session",
        "summary": "Delete a loaded LCMS session.",
        "input_schema": {"type": "object"},
        "output_schema": {"type": "object"},
        "risk": "destructive",
        "scope": "backend",
    },
    {
        "id": "lcms.push_eic_to_ui",
        "summary": "Push an EIC into the open browser UI.",
        "input_schema": {"type": "object"},
        "output_schema": {"type": "object"},
        "risk": "safe",
        "scope": "browser",
    },
]


def _make_server(handler) -> MFPToolServer:
    transport = httpx.MockTransport(handler)
    config = MCPConfig(backend_url="http://test", request_timeout=5.0)
    client = httpx.AsyncClient(transport=transport, base_url=config.backend_url, timeout=5.0)
    backend = BackendClient(config, client=client)
    # short TTL so cache doesn't mask test calls
    return MFPToolServer(client=backend, catalog_ttl_seconds=0.001)


def _ok_catalog_handler(request: httpx.Request) -> httpx.Response:
    if request.url.path == "/api/automation/actions":
        return httpx.Response(200, json=CATALOG)
    raise AssertionError(f"unexpected request: {request.method} {request.url}")


# --- helper payload tests ------------------------------------------------


def test_structured_result_strips_structured_content_on_error():
    result = _structured_result({"foo": "bar"}, is_error=True)
    assert result.isError is True
    assert result.structuredContent is None
    assert json.loads(result.content[0].text) == {"foo": "bar"}


def test_structured_result_includes_structured_content_on_success():
    result = _structured_result({"foo": "bar"})
    assert result.isError is False
    assert result.structuredContent == {"foo": "bar"}


def test_http_error_payload_with_json_detail():
    response = httpx.Response(404, json={"detail": "session not found"})
    exc = httpx.HTTPStatusError("not found", request=httpx.Request("GET", "http://x"), response=response)
    payload = _http_error_payload(exc)
    assert payload["status"] == "backend_error"
    assert payload["status_code"] == 404
    assert payload["detail"] == {"detail": "session not found"}


def test_http_error_payload_with_plain_text_detail():
    response = httpx.Response(500, text="boom")
    exc = httpx.HTTPStatusError("server error", request=httpx.Request("GET", "http://x"), response=response)
    payload = _http_error_payload(exc)
    assert payload["status_code"] == 500
    assert payload["detail"] == "boom"


def test_requires_confirmation_payload_shape():
    action = next(a for a in CATALOG if a["risk"] == "destructive")
    from mfp_mcp.backend_client import AutomationAction
    payload = _requires_confirmation_payload(AutomationAction.model_validate(action), {"confirmation_token": "abc"})
    assert payload["status"] == "requires_confirmation"
    assert payload["action_id"] == "lcms.delete_session"
    assert payload["risk"] == "destructive"
    assert payload["preview"] == {"confirmation_token": "abc"}


def test_requires_open_app_payload_shape():
    action = next(a for a in CATALOG if a["scope"] == "browser" and a["risk"] == "safe")
    from mfp_mcp.backend_client import AutomationAction
    payload = _requires_open_app_payload(AutomationAction.model_validate(action))
    assert payload["status"] == "requires_open_app"
    assert payload["action_id"] == "lcms.push_eic_to_ui"


# --- call_tool routing tests -------------------------------------------


@pytest.mark.asyncio
async def test_safe_backend_action_executes():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/automation/actions":
            return httpx.Response(200, json=CATALOG)
        if request.url.path == "/api/automation/actions/lcms.list_sessions/execute":
            return httpx.Response(200, json={"sessions": [{"session_id": "s1"}]})
        raise AssertionError(f"unexpected request: {request.url}")

    server = _make_server(handler)
    result = await server.handle_call_tool("lcms.list_sessions", {})

    assert result.isError is False
    assert result.structuredContent == {"sessions": [{"session_id": "s1"}]}
    await server.client.close()


@pytest.mark.asyncio
async def test_browser_scope_action_forwards_to_backend_and_translates_409():
    """Phase 4 routing: the MCP server delegates browser-scope routing to
    the backend (single source of truth). The backend returns HTTP 409 with
    'requires_open_app' in the detail when no browser is connected; the MCP
    server translates that into a clean ``requires_open_app`` payload."""
    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.url.path)
        if request.url.path == "/api/automation/actions":
            return httpx.Response(200, json=CATALOG)
        # Browser action with no browser connected → backend 409.
        return httpx.Response(409, json={"detail": {"error": "requires_open_app", "message": "requires_open_app"}})

    server = _make_server(handler)
    result = await server.handle_call_tool("lcms.push_eic_to_ui", {})

    assert result.isError is True
    assert result.structuredContent is None
    parsed = json.loads(result.content[0].text)
    assert parsed["status"] == "requires_open_app"
    # Backend execute SHOULD have been called now (delegated routing).
    assert any(path.endswith("/lcms.push_eic_to_ui/execute") for path in seen)
    await server.client.close()


@pytest.mark.asyncio
async def test_confirm_action_calls_preview_not_execute():
    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.url.path)
        if request.url.path == "/api/automation/actions":
            return httpx.Response(200, json=CATALOG)
        if request.url.path.endswith("/preview"):
            return httpx.Response(200, json={"confirmation_token": "abc", "expires_at": "2026-01-01T00:00:00Z"})
        raise AssertionError(f"execute should not have been called for confirm risk; got {request.url}")

    server = _make_server(handler)
    result = await server.handle_call_tool("lcms.delete_session", {"session_id": "s1"})

    assert result.isError is True
    parsed = json.loads(result.content[0].text)
    assert parsed["status"] == "requires_confirmation"
    assert parsed["preview"]["confirmation_token"] == "abc"
    assert any("/preview" in path for path in seen)
    assert not any("/execute" in path for path in seen)
    await server.client.close()


@pytest.mark.asyncio
async def test_unknown_action_returns_structured_error():
    server = _make_server(_ok_catalog_handler)
    result = await server.handle_call_tool("lcms.does_not_exist", {})

    assert result.isError is True
    parsed = json.loads(result.content[0].text)
    assert parsed["status"] == "unknown_action"
    assert parsed["action_id"] == "lcms.does_not_exist"
    await server.client.close()


@pytest.mark.asyncio
async def test_backend_http_error_surfaces_as_backend_error():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/automation/actions":
            return httpx.Response(200, json=CATALOG)
        return httpx.Response(404, json={"detail": "session not found"})

    server = _make_server(handler)
    result = await server.handle_call_tool("lcms.list_sessions", {})

    assert result.isError is True
    parsed = json.loads(result.content[0].text)
    assert parsed["status"] == "backend_error"
    assert parsed["status_code"] == 404
    await server.client.close()


@pytest.mark.asyncio
async def test_backend_network_error_surfaces_as_backend_unavailable():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/automation/actions":
            return httpx.Response(200, json=CATALOG)
        raise httpx.ConnectError("no connection")

    server = _make_server(handler)
    result = await server.handle_call_tool("lcms.list_sessions", {})

    assert result.isError is True
    parsed = json.loads(result.content[0].text)
    assert parsed["status"] == "backend_unavailable"
    await server.client.close()


@pytest.mark.asyncio
async def test_backend_409_with_requires_open_app_body_is_translated():
    """Forward-compat: when the phase-4 browser bridge returns HTTP 409 with
    'requires_open_app' in the body, surface it as a clean requires_open_app
    payload rather than a raw 409 backend_error."""
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/automation/actions":
            # Patch the catalog so list_sessions has scope="backend" but the
            # backend response says requires_open_app — simulating a combo action
            # whose browser side is missing.
            return httpx.Response(200, json=CATALOG)
        return httpx.Response(409, json={"error": "requires_open_app"})

    server = _make_server(handler)
    result = await server.handle_call_tool("lcms.list_sessions", {})

    assert result.isError is True
    parsed = json.loads(result.content[0].text)
    assert parsed["status"] == "requires_open_app"
    await server.client.close()


@pytest.mark.asyncio
async def test_catalog_cache_avoids_duplicate_backend_calls():
    """A second call_tool with the same known action ID should NOT trigger
    another /actions fetch within the TTL window."""
    fetches = {"count": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/automation/actions":
            fetches["count"] += 1
            return httpx.Response(200, json=CATALOG)
        if request.url.path.endswith("/execute"):
            return httpx.Response(200, json={"sessions": []})
        raise AssertionError(request.url)

    # TTL of 5s — well above the time it takes for two sequential calls.
    transport = httpx.MockTransport(handler)
    config = MCPConfig(backend_url="http://test", request_timeout=5.0)
    client = httpx.AsyncClient(transport=transport, base_url=config.backend_url, timeout=5.0)
    backend = BackendClient(config, client=client)
    server = MFPToolServer(client=backend, catalog_ttl_seconds=5.0)

    await server.handle_call_tool("lcms.list_sessions", {})
    await server.handle_call_tool("lcms.list_sessions", {})

    assert fetches["count"] == 1
    await server.client.close()
