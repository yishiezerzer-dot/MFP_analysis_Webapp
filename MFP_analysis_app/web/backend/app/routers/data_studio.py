"""Data Studio API routes.

Endpoints
---------
- POST   /api/data-studio/sessions                    Upload a table file.
- GET    /api/data-studio/sessions                    List sessions.
- GET    /api/data-studio/sessions/{sid}              Session summary.
- DELETE /api/data-studio/sessions/{sid}              Remove a session.
- PATCH  /api/data-studio/sessions/{sid}/load         Update load options (sheet/header/decimal-comma).
- GET    /api/data-studio/sessions/{sid}/schema       Schema (columns, dtypes, numeric cols).
- POST   /api/data-studio/sessions/{sid}/preview      Preview rows after optional transforms.
- POST   /api/data-studio/sessions/{sid}/plot         Plot-ready arrays after transforms.
- POST   /api/data-studio/sessions/{sid}/histogram    Histogram bins/counts for Y columns.
"""
from __future__ import annotations

import tempfile
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel, Field

from ..services.data_studio_service import (
    DataStudioSession,
    build_histogram,
    build_plot_series,
    describe_frame,
    preview_rows,
    registry,
    session_summary,
)

router = APIRouter()


# ------------------------------ request models ------------------------------


class LoadOptions(BaseModel):
    sheet_name: Optional[str] = None
    header_row: int = Field(default=0, ge=0)
    decimal_comma: bool = False


class TransformStep(BaseModel):
    type: str
    columns: Optional[List[str]] = None
    mode: Optional[str] = None
    mapping: Optional[Dict[str, str]] = None
    errors: Optional[str] = None
    value: Any = None
    method: Optional[str] = None
    range: Optional[List[int]] = None
    base: Optional[float] = None
    offset: Optional[float] = None
    window: Optional[int] = None
    center: Optional[bool] = None


class PreviewBody(BaseModel):
    transforms: List[Dict[str, Any]] = Field(default_factory=list)
    max_rows: int = Field(default=200, ge=1, le=5000)


class PlotBody(BaseModel):
    transforms: List[Dict[str, Any]] = Field(default_factory=list)
    x_col: Optional[str] = None
    y_cols: List[str] = Field(default_factory=list)
    y_normalize: str = "none"
    x_normalize: str = "none"
    max_points: int = Field(default=10000, ge=100, le=200000)


class HistogramBody(BaseModel):
    transforms: List[Dict[str, Any]] = Field(default_factory=list)
    y_cols: List[str] = Field(default_factory=list)
    bins: int = Field(default=30, ge=1, le=500)


# ------------------------------ endpoints ------------------------------


@router.post("/sessions")
async def create_session(file: UploadFile = File(...)) -> Dict[str, Any]:
    name = file.filename or "upload.csv"
    tmp_dir = Path(tempfile.mkdtemp(prefix="mfp_ds_"))
    dest = tmp_dir / name
    data = await file.read()
    dest.write_bytes(data)
    s = registry.add_from_path(dest, display_name=name)
    return session_summary(s)


@router.get("/sessions")
def list_sessions() -> List[Dict[str, Any]]:
    return [session_summary(s) for s in registry.list()]


@router.get("/sessions/{sid}")
def get_session(sid: str) -> Dict[str, Any]:
    return session_summary(_require(sid))


@router.delete("/sessions/{sid}")
def delete_session(sid: str) -> Dict[str, bool]:
    if not registry.remove(sid):
        raise HTTPException(status_code=404, detail="session not found")
    return {"deleted": True}


@router.patch("/sessions/{sid}/load")
def update_load_options(sid: str, body: LoadOptions) -> Dict[str, Any]:
    s = _require(sid)
    s.set_load_options(
        sheet_name=body.sheet_name,
        header_row=int(body.header_row),
        decimal_comma=bool(body.decimal_comma),
    )
    # Force a reload so the caller gets shape back.
    try:
        _ = s.raw()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"Failed to load table: {exc}")
    return session_summary(s)


@router.get("/sessions/{sid}/schema")
def get_schema(sid: str) -> Dict[str, Any]:
    s = _require(sid)
    try:
        df = s.raw()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"Failed to load table: {exc}")
    return describe_frame(df)


@router.post("/sessions/{sid}/preview")
def get_preview(sid: str, body: PreviewBody) -> Dict[str, Any]:
    s = _require(sid)
    try:
        df = s.apply_transforms(body.transforms)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"Transform failed: {exc}")
    out = preview_rows(df, max_rows=body.max_rows)
    out["schema"] = describe_frame(df)
    out["warnings"] = list(df.attrs.get("transform_warnings") or [])
    return out


@router.post("/sessions/{sid}/plot")
def get_plot_data(sid: str, body: PlotBody) -> Dict[str, Any]:
    s = _require(sid)
    try:
        df = s.apply_transforms(body.transforms)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"Transform failed: {exc}")
    return build_plot_series(
        df,
        x_col=body.x_col,
        y_cols=list(body.y_cols),
        y_normalize=body.y_normalize,
        x_normalize=body.x_normalize,
        max_points=int(body.max_points),
    )


@router.post("/sessions/{sid}/histogram")
def get_histogram(sid: str, body: HistogramBody) -> Dict[str, Any]:
    s = _require(sid)
    try:
        df = s.apply_transforms(body.transforms)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"Transform failed: {exc}")
    return build_histogram(df, y_cols=list(body.y_cols), bins=int(body.bins))


# ------------------------------ utils ------------------------------


def _require(sid: str) -> DataStudioSession:
    s = registry.get(sid)
    if s is None:
        raise HTTPException(status_code=404, detail="session not found")
    return s
