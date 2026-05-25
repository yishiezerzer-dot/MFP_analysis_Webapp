"""Automation action registry.

All handlers must be ``async def``. CPU-bound work must be wrapped with
``await asyncio.to_thread(...)`` inside the handler.
"""
from __future__ import annotations

import hashlib
import inspect
import json
import os
import re
import secrets
import sqlite3
import threading
import time
from collections import deque
from dataclasses import dataclass, replace
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Awaitable, Callable, Deque, Dict, List, Literal, Optional, Tuple, Type

from pydantic import BaseModel, ValidationError

from .models import ActionLogEntry, ActionPreview, ActionRisk, ActionScope

ActionHandler = Callable[[BaseModel], Awaitable[BaseModel]]
_ACTION_ID_RE = re.compile(r"^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*_[a-z0-9_]+$")
_MAX_LOG_ENTRIES = 500
_CONFIRMATION_TTL_SECONDS = 5 * 60


@dataclass(frozen=True)
class ActionSpec:
    id: str
    summary: str
    input_model: Type[BaseModel]
    output_model: Type[BaseModel]
    risk: ActionRisk
    scope: ActionScope
    handler: Optional[ActionHandler] = None


class ActionRegistryError(Exception):
    pass


class ActionNotFound(ActionRegistryError):
    pass


class SessionNotFound(ActionRegistryError):
    pass


class ActionInputError(ActionRegistryError):
    """Raised by a handler when its input is structurally valid (passed Pydantic)
    but semantically invalid (e.g. an EIC payload with zero finite points).
    Mapped to HTTP 422 by the router."""

    pass


class BrowserConnectionRequired(ActionRegistryError):
    pass


class BrowserActionFailed(ActionRegistryError):
    pass


class ConfirmationRequired(ActionRegistryError):
    pass


class ConfirmationInvalid(ActionRegistryError):
    pass


_ACTIONS: Dict[str, ActionSpec] = {}
_LOG: Deque[ActionLogEntry] = deque(maxlen=_MAX_LOG_ENTRIES)
_CONFIRMATION_TOKENS: Dict[str, Tuple[str, str, float]] = {}
_LOG_DB_PATH = Path(
    os.environ.get(
        "MFP_AUTOMATION_LOG_DB",
        str(Path(__file__).resolve().parents[2] / ".automation" / "action_log.sqlite3"),
    )
)
_LOG_DB_LOCK = threading.Lock()
_LOG_DB_INITIALIZED = False
_LOG_DB_FAILED = False


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _model_validate(model: Type[BaseModel], payload: Dict[str, Any]) -> BaseModel:
    validate = getattr(model, "model_validate", None)
    if callable(validate):
        return validate(payload)
    return model.parse_obj(payload)


def _model_dump(model: BaseModel) -> Dict[str, Any]:
    dump = getattr(model, "model_dump", None)
    if callable(dump):
        return dump(mode="json")
    return model.dict()


def model_schema(model: Type[BaseModel]) -> Dict[str, Any]:
    schema = getattr(model, "model_json_schema", None)
    if callable(schema):
        return schema()
    return model.schema()


def _args_hash(args: Dict[str, Any]) -> str:
    data = json.dumps(args, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(data.encode("utf-8")).hexdigest()


def _summarize(value: Any, *, max_items: int = 8) -> Any:
    if isinstance(value, BaseModel):
        value = _model_dump(value)
    if isinstance(value, dict):
        out: Dict[str, Any] = {}
        for index, (key, item) in enumerate(value.items()):
            if index >= max_items:
                out["..."] = f"{len(value) - max_items} more"
                break
            out[str(key)] = _summarize(item, max_items=max_items)
        return out
    if isinstance(value, list):
        if len(value) <= max_items:
            return [_summarize(item, max_items=max_items) for item in value]
        return {
            "type": "list",
            "length": len(value),
            "preview": [_summarize(item, max_items=max_items) for item in value[:max_items]],
        }
    if isinstance(value, tuple):
        return _summarize(list(value), max_items=max_items)
    return value


def _log_db_connect() -> sqlite3.Connection:
    _LOG_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(_LOG_DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _ensure_log_db() -> None:
    global _LOG_DB_INITIALIZED
    if _LOG_DB_INITIALIZED:
        return
    with _LOG_DB_LOCK:
        if _LOG_DB_INITIALIZED:
            return
        with _log_db_connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS action_log (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp TEXT NOT NULL,
                    action_id TEXT NOT NULL,
                    actor TEXT NOT NULL,
                    args_summary TEXT NOT NULL,
                    status TEXT NOT NULL,
                    duration_ms REAL NOT NULL,
                    result_summary TEXT,
                    error TEXT
                )
                """
            )
            conn.execute("CREATE INDEX IF NOT EXISTS idx_action_log_timestamp ON action_log(timestamp)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_action_log_action_status ON action_log(action_id, status)")
        _LOG_DB_INITIALIZED = True


def _persist_log_entry(entry: ActionLogEntry) -> None:
    global _LOG_DB_FAILED
    if _LOG_DB_FAILED:
        return
    try:
        _ensure_log_db()
        with _LOG_DB_LOCK, _log_db_connect() as conn:
            conn.execute(
                """
                INSERT INTO action_log (
                    timestamp, action_id, actor, args_summary, status,
                    duration_ms, result_summary, error
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    entry.timestamp.isoformat(),
                    entry.action_id,
                    entry.actor,
                    json.dumps(entry.args_summary, sort_keys=True, default=str),
                    entry.status,
                    entry.duration_ms,
                    None
                    if entry.result_summary is None
                    else json.dumps(entry.result_summary, sort_keys=True, default=str),
                    entry.error,
                ),
            )
    except Exception as exc:
        # Logging must never break an analysis action; disable SQLite after first failure.
        _LOG_DB_FAILED = True
        import sys
        print(f"[automation] SQLite log disabled after error: {exc}", file=sys.stderr)


def _load_log_entries_from_db(limit: int = _MAX_LOG_ENTRIES) -> List[ActionLogEntry]:
    try:
        _ensure_log_db()
        with _LOG_DB_LOCK, _log_db_connect() as conn:
            rows = conn.execute(
                """
                SELECT timestamp, action_id, actor, args_summary, status,
                       duration_ms, result_summary, error
                FROM action_log
                ORDER BY id DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
    except Exception:
        return list(_LOG)

    entries: List[ActionLogEntry] = []
    for row in reversed(rows):
        entries.append(
            ActionLogEntry(
                timestamp=datetime.fromisoformat(row["timestamp"]),
                action_id=row["action_id"],
                actor=row["actor"],
                args_summary=json.loads(row["args_summary"] or "{}"),
                status=row["status"],
                duration_ms=float(row["duration_ms"]),
                result_summary=None
                if row["result_summary"] is None
                else json.loads(row["result_summary"]),
                error=row["error"],
            )
        )
    return entries


def _append_log(
    *,
    action_id: str,
    args: Dict[str, Any],
    status: str,
    duration_ms: float,
    result: Any = None,
    error: Optional[str] = None,
) -> None:
    entry = ActionLogEntry(
        timestamp=_utcnow(),
        action_id=action_id,
        args_summary=_summarize(args),
        actor="automation",
        status=status,
        duration_ms=duration_ms,
        result_summary=None if result is None else _summarize(result),
        error=error,
    )
    _LOG.append(entry)
    _persist_log_entry(entry)


def _prune_confirmation_tokens() -> None:
    now = time.time()
    expired = [token for token, (_action_id, _args_hash_value, expires_at) in _CONFIRMATION_TOKENS.items() if expires_at <= now]
    for token in expired:
        _CONFIRMATION_TOKENS.pop(token, None)


def _issue_confirmation_token(action_id: str, args: Dict[str, Any]) -> Tuple[str, datetime]:
    _prune_confirmation_tokens()
    token = secrets.token_urlsafe(24)
    expires_at_ts = time.time() + _CONFIRMATION_TTL_SECONDS
    _CONFIRMATION_TOKENS[token] = (action_id, _args_hash(args), expires_at_ts)
    return token, datetime.fromtimestamp(expires_at_ts, timezone.utc)


def _validate_confirmation_token(action_id: str, args: Dict[str, Any], token: Optional[str]) -> None:
    _prune_confirmation_tokens()
    if not token:
        raise ConfirmationRequired("confirmation_token is required for this action")
    stored = _CONFIRMATION_TOKENS.get(token)
    if stored is None:
        raise ConfirmationInvalid("confirmation_token is invalid or expired")
    stored_action_id, stored_args_hash, _expires_at = stored
    if stored_action_id != action_id or stored_args_hash != _args_hash(args):
        raise ConfirmationInvalid("confirmation_token does not match this action and arguments")
    _CONFIRMATION_TOKENS.pop(token, None)


def register(spec: ActionSpec) -> Callable[[ActionHandler], ActionHandler]:
    if not _ACTION_ID_RE.match(spec.id):
        raise ValueError(f"Invalid action id: {spec.id!r}")
    if spec.id in _ACTIONS:
        raise ValueError(f"Action already registered: {spec.id}")

    def decorator(handler: ActionHandler) -> ActionHandler:
        if not inspect.iscoroutinefunction(handler):
            raise TypeError(f"Automation action handler must be async def: {spec.id}")
        _ACTIONS[spec.id] = replace(spec, handler=handler)
        return handler

    return decorator


def get_action(action_id: str) -> ActionSpec:
    spec = _ACTIONS.get(action_id)
    if spec is None:
        raise ActionNotFound(action_id)
    return spec


def list_actions() -> List[ActionSpec]:
    return sorted(_ACTIONS.values(), key=lambda spec: spec.id)


async def preview(action_id: str, args: Dict[str, Any]) -> ActionPreview:
    start = time.perf_counter()
    try:
        spec = get_action(action_id)
        _model_validate(spec.input_model, args)
        token = None
        expires_at = None
        if spec.risk in ("confirm", "destructive"):
            token, expires_at = _issue_confirmation_token(action_id, args)
        result = ActionPreview(
            action_id=spec.id,
            risk=spec.risk,
            confirmation_token=token,
            expires_at=expires_at,
        )
        _append_log(
            action_id=action_id,
            args=args,
            status="preview_ok",
            duration_ms=(time.perf_counter() - start) * 1000,
            result=result,
        )
        return result
    except ActionNotFound:
        _append_log(
            action_id=action_id,
            args=args,
            status="not_found",
            duration_ms=(time.perf_counter() - start) * 1000,
            error="action not found",
        )
        raise
    except ValidationError as exc:
        _append_log(
            action_id=action_id,
            args=args,
            status="validation_error",
            duration_ms=(time.perf_counter() - start) * 1000,
            error=str(exc),
        )
        raise


async def execute(action_id: str, args: Dict[str, Any], *, confirmation_token: Optional[str] = None) -> BaseModel:
    start = time.perf_counter()
    try:
        spec = get_action(action_id)
        if spec.risk in ("confirm", "destructive"):
            _validate_confirmation_token(action_id, args, confirmation_token)
        parsed = _model_validate(spec.input_model, args)
        if spec.handler is None:
            raise ActionRegistryError(f"Action has no handler: {action_id}")
        result = await spec.handler(parsed)
        if not isinstance(result, spec.output_model):
            result = _model_validate(spec.output_model, _model_dump(result) if isinstance(result, BaseModel) else result)
        _append_log(
            action_id=action_id,
            args=args,
            status="ok",
            duration_ms=(time.perf_counter() - start) * 1000,
            result=result,
        )
        return result
    except ActionNotFound:
        _append_log(
            action_id=action_id,
            args=args,
            status="not_found",
            duration_ms=(time.perf_counter() - start) * 1000,
            error="action not found",
        )
        raise
    except (ValidationError, ConfirmationRequired, ConfirmationInvalid, ActionInputError, ActionRegistryError) as exc:
        _append_log(
            action_id=action_id,
            args=args,
            status="error",
            duration_ms=(time.perf_counter() - start) * 1000,
            error=str(exc),
        )
        raise
    except Exception as exc:
        _append_log(
            action_id=action_id,
            args=args,
            status="error",
            duration_ms=(time.perf_counter() - start) * 1000,
            error=str(exc),
        )
        raise


def list_log_entries() -> List[ActionLogEntry]:
    return _load_log_entries_from_db()


def clear_log_for_tests() -> None:
    _LOG.clear()
    try:
        _ensure_log_db()
        with _LOG_DB_LOCK, _log_db_connect() as conn:
            conn.execute("DELETE FROM action_log")
    except Exception:
        return


def clear_confirmation_tokens_for_tests() -> None:
    _CONFIRMATION_TOKENS.clear()
