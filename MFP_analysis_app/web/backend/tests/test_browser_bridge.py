"""Tests for the browser-bridge WebSocket + registry + browser-scope actions.

Covers:
- single-tab-wins (a second connect supersedes the first; pending futures on
  the superseded connection resolve with ``BrowserConnectionRequired``)
- ``dispatch`` timeout → ``BrowserActionFailed``
- ``dispatch`` with no browser → ``BrowserConnectionRequired``
- end-to-end via FastAPI ``TestClient``: a browser-scope action returns 409
  when no WS is connected, and returns 200 with the echoed result when one
  is connected
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocket

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.automation.browser_bridge import (  # noqa: E402
    BRIDGE_TIMEOUT_SECONDS,
    BrowserConnectionRegistry,
)
from app.automation.registry import (  # noqa: E402
    BrowserActionFailed,
    BrowserConnectionRequired,
)
from app.main import app  # noqa: E402


def _fake_websocket() -> WebSocket:
    """Build a minimal WebSocket that records send_json calls and accepts."""
    ws = AsyncMock(spec=WebSocket)
    ws.accept = AsyncMock()
    ws.send_json = AsyncMock()
    ws.close = AsyncMock()
    return ws


@pytest.mark.asyncio
async def test_registry_single_tab_wins_supersedes_old_connection():
    registry = BrowserConnectionRegistry()
    ws1 = _fake_websocket()
    ws2 = _fake_websocket()

    conn1 = await registry.connect(ws1, browser_id="tab-1")
    # Plant a pending future on conn1 to confirm it's resolved on supersede.
    pending_future: asyncio.Future = asyncio.get_running_loop().create_future()
    conn1.pending["fake-request-id"] = pending_future

    conn2 = await registry.connect(ws2, browser_id="tab-2")

    # Old connection is closed and its pending futures fail with
    # BrowserConnectionRequired.
    assert ws1.close.await_count == 1
    assert pending_future.done()
    with pytest.raises(BrowserConnectionRequired):
        pending_future.result()
    # The new connection is the active one.
    async with registry._lock:
        assert registry._active is conn2

    # Cleanup
    await registry.disconnect(conn2)


@pytest.mark.asyncio
async def test_dispatch_raises_browser_connection_required_when_no_browser():
    registry = BrowserConnectionRegistry()
    with pytest.raises(BrowserConnectionRequired):
        await registry.dispatch("lcms.push_eic_to_ui", {"eic": {}})


@pytest.mark.asyncio
async def test_dispatch_timeout_raises_browser_action_failed(monkeypatch):
    registry = BrowserConnectionRegistry()
    ws = _fake_websocket()
    await registry.connect(ws, browser_id="tab")

    # Shorten the timeout so we don't actually wait 30 s.
    monkeypatch.setattr("app.automation.browser_bridge.BRIDGE_TIMEOUT_SECONDS", 0.1)

    with pytest.raises(BrowserActionFailed) as excinfo:
        await registry.dispatch("lcms.push_eic_to_ui", {"eic": {}})
    assert "timed out" in str(excinfo.value)

    # The pending entry should be cleaned up on timeout.
    async with registry._lock:
        conn = registry._active
    assert conn is not None
    assert conn.pending == {}

    await registry.disconnect(conn)


@pytest.mark.asyncio
async def test_dispatch_returns_browser_result_via_receive():
    registry = BrowserConnectionRegistry()
    ws = _fake_websocket()
    conn = await registry.connect(ws, browser_id="tab")

    # Schedule dispatch; intercept the sent request to grab the request_id,
    # then post a matching response back through receive().
    dispatch_task = asyncio.create_task(
        registry.dispatch("lcms.push_eic_to_ui", {"eic": {"target_mz": 150.1}})
    )
    # Give dispatch a tick to send its message.
    await asyncio.sleep(0.05)

    sent = ws.send_json.await_args.args[0]
    assert sent["type"] == "automation_request"
    assert sent["action_id"] == "lcms.push_eic_to_ui"
    request_id = sent["request_id"]

    await registry.receive(
        conn,
        {
            "type": "automation_response",
            "request_id": request_id,
            "result": {"eic_plot_id": "abc"},
        },
    )

    result = await asyncio.wait_for(dispatch_task, timeout=1.0)
    assert result == {"eic_plot_id": "abc"}
    await registry.disconnect(conn)


@pytest.mark.asyncio
async def test_disconnect_cancels_heartbeat_and_clears_pending():
    registry = BrowserConnectionRegistry()
    ws = _fake_websocket()
    conn = await registry.connect(ws, browser_id="tab")

    pending: asyncio.Future = asyncio.get_running_loop().create_future()
    conn.pending["x"] = pending
    heartbeat = conn.heartbeat_task

    await registry.disconnect(conn)

    assert heartbeat is not None
    # Give the cancellation a chance to settle.
    await asyncio.sleep(0)
    assert heartbeat.cancelled() or heartbeat.done()
    # Pending future was failed.
    assert pending.done()
    with pytest.raises(BrowserConnectionRequired):
        pending.result()


# --- end-to-end via TestClient -------------------------------------------


def test_browser_action_returns_409_when_no_browser_connected():
    client = TestClient(app)
    response = client.post(
        "/api/automation/actions/lcms.set_polarity/execute",
        json={"polarity": "positive"},
    )
    assert response.status_code == 409
    body = response.json()
    assert body["detail"]["error"] == "requires_open_app"


def test_browser_action_round_trips_through_connected_websocket():
    client = TestClient(app)
    # Open a fake browser WS, then have a worker thread issue the HTTP call.
    import json as _json
    import threading

    http_response: dict = {}

    def hit_endpoint():
        # Use a fresh TestClient inside the thread; sharing one across
        # threads while a WS context is open is brittle.
        with TestClient(app) as inner:
            r = inner.post(
                "/api/automation/actions/lcms.set_polarity/execute",
                json={"polarity": "positive"},
            )
            http_response["status"] = r.status_code
            http_response["json"] = r.json()

    with client.websocket_connect("/api/automation/browser-bridge?browser_id=test-tab") as ws:
        worker = threading.Thread(target=hit_endpoint, daemon=True)
        worker.start()

        # Receive the dispatched request and echo a response.
        msg = ws.receive_json()
        # The very first message may be a heartbeat ping; loop past it.
        while msg.get("type") != "automation_request":
            if msg.get("type") == "ping":
                ws.send_json({"type": "pong"})
            msg = ws.receive_json()
        ws.send_json(
            {
                "type": "automation_response",
                "request_id": msg["request_id"],
                "result": {"echo": msg["args"]},
            }
        )

        worker.join(timeout=10)

    assert http_response["status"] == 200
    payload = http_response["json"]
    assert payload["ok"] is True
    assert payload["result"]["echo"] == {"polarity": "positive"}
