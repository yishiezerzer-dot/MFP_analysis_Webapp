"""Experiments API: cross-module session tagging and experiment bundles."""
from __future__ import annotations

from typing import Any, Dict, List, Optional
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from ..db import (
    get_experiment_bundle,
    get_session_record,
    list_experiment_tags,
    list_session_records,
    set_session_experiment_tag,
)

router = APIRouter()


class UpdateTagRequest(BaseModel):
    experiment_tag: str = Field(..., max_length=120)


class BatchTagRequest(BaseModel):
    session_ids: List[str] = Field(..., min_length=1)
    experiment_tag: str = Field(..., max_length=120)


@router.get("/tags")
def get_tags(workspace_id: Optional[str] = Query(None)) -> List[str]:
    """List all known distinct experiment tags."""
    return list_experiment_tags(workspace_id=workspace_id)


@router.get("/bundle/{tag}")
def get_bundle(tag: str, workspace_id: Optional[str] = Query(None)) -> Dict[str, Any]:
    """Retrieve all linked analytical sessions for a specific experiment tag."""
    clean_tag = tag.strip()
    if not clean_tag:
        raise HTTPException(status_code=400, detail="Experiment tag cannot be empty.")
    bundle = get_experiment_bundle(clean_tag, workspace_id=workspace_id)
    return bundle


@router.put("/sessions/{session_id}/tag")
def update_session_tag(session_id: str, body: UpdateTagRequest) -> Dict[str, Any]:
    """Assign or update an experiment tag for a session."""
    clean_tag = body.experiment_tag.strip()
    updated = set_session_experiment_tag(session_id, clean_tag)
    if not updated:
        # Check if session exists
        record = get_session_record(session_id)
        if not record:
            raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found.")
    
    # Return updated session details along with linked siblings
    sibling_bundle = get_experiment_bundle(clean_tag) if clean_tag else {"sessions": [], "counts": {}}
    return {
        "status": "ok",
        "session_id": session_id,
        "experiment_tag": clean_tag,
        "linked": sibling_bundle,
    }


@router.post("/batch-tag")
def batch_assign_tag(body: BatchTagRequest) -> Dict[str, Any]:
    """Assign an experiment tag to multiple sessions at once."""
    clean_tag = body.experiment_tag.strip()
    tagged_count = 0
    for sid in body.session_ids:
        if set_session_experiment_tag(sid, clean_tag):
            tagged_count += 1

    return {
        "status": "ok",
        "experiment_tag": clean_tag,
        "tagged_count": tagged_count,
        "total_requested": len(body.session_ids),
    }


@router.get("/sessions/{session_id}")
def get_session_experiment_info(session_id: str) -> Dict[str, Any]:
    """Get experiment info for a session, including sibling sessions sharing its tag."""
    record = get_session_record(session_id)
    if not record:
        raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found.")

    tag = record.get("experiment_tag") or ""
    siblings = get_experiment_bundle(tag) if tag else {"sessions": [], "counts": {}}
    return {
        "session_id": session_id,
        "experiment_tag": tag,
        "display_name": record.get("display_name"),
        "module": record.get("module"),
        "workspace_id": record.get("workspace_id"),
        "linked": siblings,
    }
