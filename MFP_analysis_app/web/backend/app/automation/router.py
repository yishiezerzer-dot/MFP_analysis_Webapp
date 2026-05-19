"""FastAPI routes for the automation action registry."""
from __future__ import annotations

from typing import Any, Dict, List

from fastapi import APIRouter, Body, HTTPException, Query, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, ValidationError

from . import actions as _actions  # noqa: F401 - imports register action modules
from .browser_bridge import browser_connections
from .registry import (
    ActionInputError,
    BrowserActionFailed,
    BrowserConnectionRequired,
    ActionNotFound,
    ConfirmationInvalid,
    ConfirmationRequired,
    SessionNotFound,
    execute,
    list_actions,
    list_log_entries,
    model_schema,
    preview,
)

router = APIRouter()


def _dump_model(model: BaseModel) -> Dict[str, Any]:
    dump = getattr(model, "model_dump", None)
    if callable(dump):
        return dump(mode="json")
    return model.dict()


def _validation_detail(exc: ValidationError) -> Any:
    errors = exc.errors()
    return errors if errors else str(exc)


@router.get("/actions")
async def get_actions() -> List[Dict[str, Any]]:
    return [
        {
            "id": spec.id,
            "summary": spec.summary,
            "input_schema": model_schema(spec.input_model),
            "output_schema": model_schema(spec.output_model),
            "risk": spec.risk,
            "scope": spec.scope,
        }
        for spec in list_actions()
    ]


@router.post("/actions/{action_id}/preview")
async def preview_action(
    action_id: str,
    body: Dict[str, Any] = Body(default={}),
) -> Dict[str, Any]:
    args = dict(body or {})
    try:
        return _dump_model(await preview(action_id, args))
    except ActionNotFound:
        raise HTTPException(status_code=404, detail="action not found")
    except SessionNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=_validation_detail(exc))


@router.post("/actions/{action_id}/execute")
async def execute_action(
    action_id: str,
    body: Dict[str, Any] = Body(default={}),
) -> Dict[str, Any]:
    args = dict(body or {})
    confirmation_token = args.pop("confirmation_token", None)
    try:
        return _dump_model(await execute(action_id, args, confirmation_token=confirmation_token))
    except ActionNotFound:
        raise HTTPException(status_code=404, detail="action not found")
    except SessionNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=_validation_detail(exc))
    except ConfirmationRequired as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except ConfirmationInvalid as exc:
        raise HTTPException(status_code=403, detail=str(exc))
    except ActionInputError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except BrowserConnectionRequired as exc:
        raise HTTPException(status_code=409, detail={"error": "requires_open_app", "message": str(exc)})
    except BrowserActionFailed as exc:
        raise HTTPException(status_code=422, detail={"error": "browser_action_failed", "message": str(exc)})
    except HTTPException:
        raise


@router.get("/logs")
async def get_logs() -> List[Dict[str, Any]]:
    return [_dump_model(entry) for entry in list_log_entries()]


@router.websocket("/browser-bridge")
async def browser_bridge(
    websocket: WebSocket,
    browser_id: str | None = Query(default=None),
) -> None:
    connection = await browser_connections.connect(websocket, browser_id)
    try:
        while True:
            message = await websocket.receive_json()
            await browser_connections.receive(connection, message)
    except WebSocketDisconnect:
        pass
    finally:
        await browser_connections.disconnect(connection)
