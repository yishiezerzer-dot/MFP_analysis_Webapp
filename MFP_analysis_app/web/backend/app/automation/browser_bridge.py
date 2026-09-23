"""WebSocket bridge for browser-scope automation actions.

Security note: the bridge has NO authentication (the app is open to the lab by
design). The only handshake is a ``browser_id`` query string; anyone who can reach
the server can connect a tab.
"""
from __future__ import annotations

import asyncio
import contextvars
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Dict, Optional

from fastapi import WebSocket

from .registry import BrowserActionFailed, BrowserConnectionRequired

BRIDGE_TIMEOUT_SECONDS = 30.0
HEARTBEAT_INTERVAL_SECONDS = 20.0
STALE_AFTER_SECONDS = 45.0


@dataclass
class _PendingRequest:
    action_id: str
    args: Dict[str, Any]
    future: asyncio.Future[Dict[str, Any]]


@dataclass
class BrowserConnection:
    browser_id: str
    websocket: WebSocket
    connected_at: float = field(default_factory=time.monotonic)
    last_pong_at: float = field(default_factory=time.monotonic)
    send_lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    pending: Dict[str, _PendingRequest] = field(default_factory=dict)
    heartbeat_task: Optional[asyncio.Task[None]] = None


# Browser id of the tab that issued the current HTTP request (X-Browser-Id), set by the
# automation router so browser-scope actions reach the tab that asked for them.
current_browser_id: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar(
    "current_browser_id", default=None
)


class BrowserConnectionRegistry:
    """One connection per browser tab (keyed by browser_id).

    Several people can have the app open at once, so tabs no longer supersede each other.
    dispatch() goes to the requesting tab when its id is known, otherwise (e.g. MCP clients)
    to the most recently connected tab.
    """

    def __init__(self) -> None:
        self._connections: Dict[str, BrowserConnection] = {}
        self._lock = asyncio.Lock()

    async def connect(self, websocket: WebSocket, browser_id: Optional[str]) -> BrowserConnection:
        await websocket.accept()
        bid = browser_id or uuid.uuid4().hex
        connection = BrowserConnection(browser_id=bid, websocket=websocket)
        to_resend: Dict[str, _PendingRequest] = {}

        async with self._lock:
            old = self._connections.pop(bid, None)
            if old is not None:
                # Same tab reconnecting (reload, hot-reload, brief disconnect): take over its
                # in-flight requests. Don't close the old socket - that would fire the frontend's
                # onclose handler and schedule yet another reconnect.
                if old.heartbeat_task and old.heartbeat_task is not asyncio.current_task():
                    old.heartbeat_task.cancel()
                to_resend = {rid: req for rid, req in old.pending.items() if not req.future.done()}
                old.pending.clear()
            # Insertion order doubles as recency for the no-browser-id fallback.
            self._connections[bid] = connection
            connection.heartbeat_task = asyncio.create_task(self._heartbeat(connection))

        # Re-send in-flight requests on the new connection (outside lock to avoid deadlock).
        for request_id, req in to_resend.items():
            if req.future.done():
                continue
            connection.pending[request_id] = req
            try:
                await self._send(
                    connection,
                    {
                        "type": "automation_request",
                        "request_id": request_id,
                        "action_id": req.action_id,
                        "args": req.args,
                    },
                )
            except Exception as exc:
                connection.pending.pop(request_id, None)
                if not req.future.done():
                    req.future.set_exception(exc)

        return connection

    async def disconnect(self, connection: BrowserConnection) -> None:
        async with self._lock:
            if self._connections.get(connection.browser_id) is connection:
                del self._connections[connection.browser_id]
        await self._finish_connection(connection, BrowserConnectionRequired("browser disconnected"))

    async def _target(self, browser_id: Optional[str]) -> BrowserConnection:
        bid = browser_id or current_browser_id.get()
        async with self._lock:
            if bid:
                connection = self._connections.get(bid)
            else:
                connection = next(reversed(self._connections.values()), None)
        if connection is None:
            raise BrowserConnectionRequired("requires_open_app")
        return connection

    async def receive(self, connection: BrowserConnection, message: dict[str, Any]) -> None:
        message_type = message.get("type")
        if message_type == "pong":
            connection.last_pong_at = time.monotonic()
            return
        if message_type != "automation_response":
            return
        request_id = str(message.get("request_id") or "")
        req = connection.pending.pop(request_id, None)
        if req is None or req.future.done():
            return
        req.future.set_result(message)

    async def dispatch(
        self,
        action_id: str,
        args: dict[str, Any],
        *,
        browser_id: Optional[str] = None,
    ) -> dict[str, Any]:
        connection = await self._target(browser_id)

        request_id = uuid.uuid4().hex
        loop = asyncio.get_running_loop()
        future: asyncio.Future[dict[str, Any]] = loop.create_future()
        req = _PendingRequest(action_id=action_id, args=args, future=future)
        connection.pending[request_id] = req

        try:
            await self._send(
                connection,
                {
                    "type": "automation_request",
                    "request_id": request_id,
                    "action_id": action_id,
                    "args": args,
                },
            )
            response = await asyncio.wait_for(future, timeout=BRIDGE_TIMEOUT_SECONDS)
        except asyncio.TimeoutError as exc:
            connection.pending.pop(request_id, None)
            raise BrowserActionFailed(f"browser action timed out after {BRIDGE_TIMEOUT_SECONDS:.0f}s") from exc
        except Exception:
            connection.pending.pop(request_id, None)
            raise

        if response.get("error"):
            raise BrowserActionFailed(str(response.get("error")))
        result = response.get("result")
        return result if isinstance(result, dict) else {"result": result}

    async def _send(self, connection: BrowserConnection, payload: dict[str, Any]) -> None:
        try:
            async with connection.send_lock:
                await connection.websocket.send_json(payload)
        except Exception as exc:
            await self.disconnect(connection)
            raise BrowserConnectionRequired("requires_open_app") from exc

    async def _heartbeat(self, connection: BrowserConnection) -> None:
        try:
            while True:
                await asyncio.sleep(HEARTBEAT_INTERVAL_SECONDS)
                if time.monotonic() - connection.last_pong_at > STALE_AFTER_SECONDS:
                    await self.disconnect(connection)
                    return
                await self._send(connection, {"type": "ping", "ts": time.time()})
        except asyncio.CancelledError:
            raise
        except Exception:
            await self.disconnect(connection)

    async def _finish_connection(self, connection: BrowserConnection, error: Exception) -> None:
        if connection.heartbeat_task and connection.heartbeat_task is not asyncio.current_task():
            connection.heartbeat_task.cancel()
        for req in list(connection.pending.values()):
            fut = req.future if hasattr(req, "future") else req
            if not fut.done():
                fut.set_exception(error)
        connection.pending.clear()


browser_connections = BrowserConnectionRegistry()
