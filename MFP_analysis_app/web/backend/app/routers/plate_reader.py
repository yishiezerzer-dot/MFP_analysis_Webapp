"""Plate Reader API.

Workflow:
1. POST   /sessions                    Upload plate file (.xlsx/.xlsm/.xls/.csv).
2. GET    /sessions                    List sessions.
3. GET    /sessions/{sid}              Session summary (sheets available, etc).
4. POST   /sessions/{sid}/load         Load a sheet into a DataFrame preview.
5. POST   /sessions/{sid}/mic          Run the MIC wizard, return config + result.
6. DELETE /sessions/{sid}              Remove a session.
"""
from __future__ import annotations

import tempfile
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, File, Form, Header, HTTPException, UploadFile
from pydantic import BaseModel, Field

from ..blob_store import manifest_key, put_json
from ..db import get_session_record, get_upload_dir, save_session_record
from ..upload_utils import read_upload_bytes, stream_upload_to_file
from ..services.plate_reader_service import get_or_restore, preview, registry, run_mic_wizard

router = APIRouter()


def _summary(s) -> Dict[str, Any]:
    rec = get_session_record(s.session_id)
    return {
        "session_id": s.session_id,
        "workspace_id": getattr(s, "workspace_id", "general"),
        "display_name": s.display_name,
        "path": str(s.path),
        "experiment_tag": rec.get("experiment_tag", "") if rec else "",
        "sheets": list(s.sheets),
    }


@router.get("/status")
def status() -> Dict[str, str]:
    return {"status": "ok"}


_ALLOWED = {".xlsx", ".xlsm", ".xls", ".csv", ".txt", ".tsv"}


@router.post("/sessions")
async def create_session(
    file: UploadFile | None = File(None),
    blob_url: str | None = Form(None),
    blob_filename: str | None = Form(None),
    x_workspace_id: str = Header(default="general", alias="X-Workspace-Id"),
) -> Dict[str, Any]:
    upload_dir = get_upload_dir("plate_reader")
    dest, name = await stream_upload_to_file(
        file, blob_url, blob_filename, upload_dir,
        allowed_extensions=_ALLOWED,
    )
    try:
        session = registry.add_from_path(dest, workspace_id=x_workspace_id, display_name=name)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to register file: {exc}")
    save_session_record(session.session_id, getattr(session, "workspace_id", x_workspace_id), "plate_reader", session.display_name, str(session.path))
    if blob_url:
        await put_json(
            manifest_key("plate_reader", session.session_id),
            {
                "blob_url": blob_url,
                "filename": name,
                "display_name": session.display_name,
            },
        )
    return _summary(session)


@router.get("/sessions")
def list_sessions(
    x_workspace_id: str = Header(default="general", alias="X-Workspace-Id"),
) -> List[Dict[str, Any]]:
    return [_summary(s) for s in registry.list(workspace_id=x_workspace_id)]


async def _require_session(sid: str):
    s = await get_or_restore(sid)
    if s is None:
        raise HTTPException(status_code=404, detail="session not found")
    return s


@router.get("/sessions/{sid}")
async def get_session(sid: str) -> Dict[str, Any]:
    return _summary(await _require_session(sid))


class LoadRequest(BaseModel):
    sheet_name: Optional[str] = None
    use_first_row_as_header: bool = True
    max_rows: int = Field(default=200, ge=1, le=5000)


@router.post("/sessions/{sid}/load")
async def load_sheet(sid: str, req: LoadRequest) -> Dict[str, Any]:
    s = await _require_session(sid)
    try:
        df = s.load_dataframe(
            sheet_name=req.sheet_name,
            use_first_row_as_header=req.use_first_row_as_header,
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to load sheet: {exc}")
    return preview(df, max_rows=req.max_rows)


class MICRequest(BaseModel):
    sheet_name: Optional[str] = None
    use_first_row_as_header: bool = True
    sample_rows: List[int]
    control_rows: List[int] = Field(default_factory=list)
    blank_rows: List[int] = Field(default_factory=list)
    subtract_blank: bool = False
    concentration_columns: List[str]
    tick_text: str = ""
    auto_tick_labels_power2: bool = True
    title: str = "MIC"
    x_label: str = "Concentration"
    y_label: str = "OD 600nm"
    plot_type: str = "bar"
    control_style: str = "bars"


@router.post("/sessions/{sid}/mic")
async def run_mic(sid: str, req: MICRequest) -> Dict[str, Any]:
    s = await _require_session(sid)
    try:
        df = s.load_dataframe(
            sheet_name=req.sheet_name,
            use_first_row_as_header=req.use_first_row_as_header,
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to load sheet: {exc}")
    try:
        return run_mic_wizard(
            df,
            use_first_row_as_header=req.use_first_row_as_header,
            sample_rows=req.sample_rows,
            control_rows=req.control_rows,
            blank_rows=req.blank_rows,
            subtract_blank=req.subtract_blank,
            concentration_columns=req.concentration_columns,
            tick_text=req.tick_text,
            auto_tick_labels_power2=req.auto_tick_labels_power2,
            title=req.title,
            x_label=req.x_label,
            y_label=req.y_label,
            plot_type=req.plot_type,
            control_style=req.control_style,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"MIC wizard failed: {exc}")


@router.delete("/sessions/{sid}")
def delete_session(sid: str) -> Dict[str, bool]:
    if not registry.remove(sid):
        raise HTTPException(status_code=404, detail="session not found")
    return {"deleted": True}
