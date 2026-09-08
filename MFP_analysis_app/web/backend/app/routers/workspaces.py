"""Workspaces & Lab Member Profiles API routes."""
from __future__ import annotations

import re
import uuid
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..db import (
    create_workspace,
    get_workspace,
    get_workspace_state,
    list_workspaces,
    save_workspace_state,
    touch_workspace,
)

router = APIRouter()


class CreateWorkspaceRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    id: Optional[str] = None


class WorkspaceStateRequest(BaseModel):
    state: Dict[str, Any]


def _slugify(text: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9]+", "-", text.strip().lower()).strip("-")
    return cleaned or uuid.uuid4().hex[:8]


@router.get("")
def get_all_workspaces() -> List[Dict[str, Any]]:
    return list_workspaces()


@router.post("")
def add_workspace(body: CreateWorkspaceRequest) -> Dict[str, Any]:
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name cannot be empty.")
    
    ws_id = body.id.strip() if body.id else _slugify(name)
    existing = get_workspace(ws_id)
    if existing:
        # If collision, append short random suffix
        ws_id = f"{ws_id}-{uuid.uuid4().hex[:4]}"
    
    return create_workspace(ws_id, name)


@router.get("/{wid}")
def get_single_workspace(wid: str) -> Dict[str, Any]:
    ws = get_workspace(wid)
    if not ws:
        raise HTTPException(status_code=404, detail="Workspace not found.")
    touch_workspace(wid)
    return ws


@router.get("/{wid}/state/{module}")
def get_module_state(wid: str, module: str) -> Dict[str, Any]:
    state = get_workspace_state(wid, module)
    return {"workspace_id": wid, "module": module, "state": state}


@router.put("/{wid}/state/{module}")
def set_module_state(wid: str, module: str, body: WorkspaceStateRequest) -> Dict[str, Any]:
    save_workspace_state(wid, module, body.state)
    touch_workspace(wid)
    return {"status": "ok", "workspace_id": wid, "module": module}
