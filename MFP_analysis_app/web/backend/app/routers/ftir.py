"""FTIR API routes.

Endpoints
---------
- POST   /api/ftir/sessions                   Upload & parse an FTIR file.
- GET    /api/ftir/sessions                   List loaded sessions.
- GET    /api/ftir/sessions/{sid}             Session metadata.
- DELETE /api/ftir/sessions/{sid}             Remove a session.
- POST   /api/ftir/sessions/{sid}/spectrum    Preprocessed spectrum (decimated).
- POST   /api/ftir/sessions/{sid}/peaks       Pick peaks (and optionally assign).
- GET    /api/ftir/library                    Library version + entry count.
"""
from __future__ import annotations

import tempfile
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from lab_gui.ftir_io import FTIRLoadError

from ..services.ftir_service import (
    FTIRSession,
    assign_peaks_with_library,
    compute_preprocessed,
    decimate,
    library_meta,
    peaks_to_dicts,
    registry,
    session_summary,
)
from lab_gui.ftir_analysis import pick_peaks

router = APIRouter()


# ------------------------------ models ------------------------------


YMode = Literal["absorbance", "transmittance"]
Baseline = Literal["none", "polyfit"]
Normalize = Literal["none", "max", "area"]


class SpectrumRequest(BaseModel):
    mode: YMode = "absorbance"
    smoothing_window: int = Field(default=0, ge=0, le=201)
    poly_order: int = Field(default=2, ge=0, le=5)
    baseline: Baseline = "none"
    normalize: Normalize = "none"
    max_points: int = Field(default=4000, ge=200, le=20000)


class PeaksRequest(BaseModel):
    mode: YMode = "absorbance"
    smoothing_window: int = Field(default=0, ge=0, le=201)
    poly_order: int = Field(default=2, ge=0, le=5)
    baseline: Baseline = "none"
    normalize: Normalize = "none"
    min_prominence: float = Field(default=0.01, ge=0.0)
    min_height: Optional[float] = None
    min_distance_cm1: float = Field(default=8.0, ge=0.0)
    top_n: int = Field(default=0, ge=0, le=200)
    assign: bool = False
    assign_top_n: int = Field(default=3, ge=1, le=10)
    assign_min_score: float = Field(default=35.0, ge=0.0, le=100.0)


# ------------------------------ routes ------------------------------


@router.post("/sessions")
async def create_session(
    file: UploadFile = File(...),
    y_mode: YMode = Form("absorbance"),
) -> Dict[str, Any]:
    name = file.filename or "upload.csv"
    tmp_dir = Path(tempfile.mkdtemp(prefix="mfp_ftir_"))
    dest = tmp_dir / name
    data = await file.read()
    dest.write_bytes(data)
    try:
        state = registry.add_from_path(dest, display_name=name, y_mode=y_mode)
    except FTIRLoadError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"FTIR parse failed: {exc}")
    return session_summary(state)


@router.get("/sessions")
def list_sessions() -> List[Dict[str, Any]]:
    return [session_summary(s) for s in registry.list()]


@router.get("/sessions/{sid}")
def get_session(sid: str) -> Dict[str, Any]:
    state = registry.get(sid)
    if state is None:
        raise HTTPException(status_code=404, detail="session not found")
    return session_summary(state)


@router.delete("/sessions/{sid}")
def delete_session(sid: str) -> Dict[str, bool]:
    ok = registry.remove(sid)
    if not ok:
        raise HTTPException(status_code=404, detail="session not found")
    return {"deleted": True}


@router.post("/sessions/{sid}/spectrum")
def get_spectrum(sid: str, body: SpectrumRequest) -> Dict[str, Any]:
    state = _require(sid)
    x, y_proc = compute_preprocessed(
        state,
        mode=body.mode,
        smoothing_window=body.smoothing_window,
        poly_order=body.poly_order,
        baseline=body.baseline,
        normalize=body.normalize,
    )
    x_d, y_d = decimate(x, y_proc, max_points=body.max_points)
    return {
        "wn": [float(v) for v in x_d.tolist()],
        "y": [float(v) for v in y_d.tolist()],
        "n_points_full": int(x.size),
        "n_points_returned": int(x_d.size),
        "mode": body.mode,
        "preprocess": {
            "smoothing_window": body.smoothing_window,
            "poly_order": body.poly_order,
            "baseline": body.baseline,
            "normalize": body.normalize,
        },
    }


@router.post("/sessions/{sid}/peaks")
def get_peaks(sid: str, body: PeaksRequest) -> Dict[str, Any]:
    state = _require(sid)
    # Peaks are always picked on the full-resolution preprocessed array.
    x, y_proc = compute_preprocessed(
        state,
        mode=body.mode,
        smoothing_window=body.smoothing_window,
        poly_order=body.poly_order,
        baseline=body.baseline,
        normalize=body.normalize,
    )
    picked = pick_peaks(
        x,
        y_proc,
        mode=body.mode,
        min_prominence=float(body.min_prominence),
        min_height=(None if body.min_height is None else float(body.min_height)),
        min_distance_cm1=float(body.min_distance_cm1),
        top_n=int(body.top_n or 0),
    )
    peaks = peaks_to_dicts(picked)

    assignments: Optional[List[Dict[str, Any]]] = None
    if body.assign and peaks:
        assignments = assign_peaks_with_library(
            peaks,
            top_n=body.assign_top_n,
            min_score=body.assign_min_score,
        )

    return {"peaks": peaks, "assignments": assignments}


@router.get("/library")
def get_library_meta() -> Dict[str, Any]:
    return library_meta()


# ------------------------------ util ------------------------------


def _require(sid: str) -> FTIRSession:
    state = registry.get(sid)
    if state is None:
        raise HTTPException(status_code=404, detail="session not found")
    return state
