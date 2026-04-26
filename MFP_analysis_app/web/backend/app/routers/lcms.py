"""LCMS API routes.

Endpoints:
- POST   /api/lcms/sessions                      Upload and parse an mzML file.
- GET    /api/lcms/sessions                      List loaded sessions.
- GET    /api/lcms/sessions/{sid}                Session metadata.
- GET    /api/lcms/sessions/{sid}/tic            TIC arrays (rt_min, tic, polarity).
- GET    /api/lcms/sessions/{sid}/spectrum       Spectrum at a given RT.
- POST   /api/lcms/sessions/{sid}/uv             Attach a UV/DAD chromatogram CSV.
- GET    /api/lcms/sessions/{sid}/uv             UV chromatogram arrays + detected peaks.
- DELETE /api/lcms/sessions/{sid}/uv             Detach the UV chromatogram.
- DELETE /api/lcms/sessions/{sid}                Remove a session.
"""
from __future__ import annotations

import json
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from ..services.lcms_service import (
    LCMSSessionState,
    attach_uv_from_csv,
    clear_uv,
    detect_uv_peaks,
    fetch_spectrum_at_rt,
    polymer_match_labels,
    registry,
    top_n_peaks,
)
from lab_gui.lcms_io import LCMSLoadError, UVLoadError
from lab_gui.lcms_polymer_match import PolymerSearchTooLarge

router = APIRouter()


def _uv_summary(state: LCMSSessionState) -> Dict[str, Any]:
    uv = state.uv
    if uv is None:
        return {"available": False}
    return {
        "available": True,
        "filename": uv.filename,
        "n_points": int(uv.rt_min.size),
        "rt_min": float(uv.rt_range[0]),
        "rt_max": float(uv.rt_range[1]),
        "x_col": uv.x_col,
        "y_col": uv.y_col,
        "x_label": uv.x_label,
        "y_label": uv.y_label,
        "unit_guess": uv.unit_guess,
        "warnings": list(uv.warnings),
    }


def _session_summary(state: LCMSSessionState) -> Dict[str, Any]:
    metas = state.index.ms1
    rts = [float(m.rt_min) for m in metas]
    polarities = sorted({m.polarity for m in metas if m.polarity})
    return {
        "session_id": state.session_id,
        "display_name": state.display_name,
        "path": str(state.path),
        "ms1_count": len(metas),
        "rt_min": float(min(rts)) if rts else None,
        "rt_max": float(max(rts)) if rts else None,
        "polarities": polarities,
        "stats": {k: v for k, v in state.index.stats.items()},
        "uv": _uv_summary(state),
    }


@router.post("/sessions")
async def create_session(
    file: UploadFile = File(...),
    rt_unit: str = Form("minutes"),
) -> Dict[str, Any]:
    name = file.filename or "upload.mzML"
    if not name.lower().endswith((".mzml", ".mzml.gz")):
        raise HTTPException(status_code=400, detail="Expected a .mzML file.")
    tmp_dir = Path(tempfile.mkdtemp(prefix="mfp_lcms_"))
    dest = tmp_dir / name
    data = await file.read()
    dest.write_bytes(data)
    try:
        state = registry.add_from_path(dest, display_name=name, rt_unit=rt_unit)
    except LCMSLoadError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"mzML parse failed: {exc}")
    return _session_summary(state)


@router.get("/sessions")
def list_sessions() -> List[Dict[str, Any]]:
    return [_session_summary(s) for s in registry.list()]


@router.get("/sessions/{sid}")
def get_session(sid: str) -> Dict[str, Any]:
    state = registry.get(sid)
    if state is None:
        raise HTTPException(status_code=404, detail="session not found")
    return _session_summary(state)


@router.get("/sessions/{sid}/tic")
def get_tic(sid: str, polarity: Optional[str] = None) -> Dict[str, Any]:
    state = registry.get(sid)
    if state is None:
        raise HTTPException(status_code=404, detail="session not found")
    metas = state.index.ms1
    if polarity in ("positive", "negative"):
        metas = [m for m in metas if m.polarity == polarity]
    return {
        "rt_min": [float(m.rt_min) for m in metas],
        "tic": [float(m.tic) for m in metas],
        "polarity": [m.polarity for m in metas],
    }


@router.get("/sessions/{sid}/spectrum")
def get_spectrum(
    sid: str,
    rt_min: float,
    polarity: Optional[str] = None,
    top_n: int = 10,
    min_rel: float = 0.01,
    polymer_settings: Optional[str] = None,
) -> Dict[str, Any]:
    state = registry.get(sid)
    if state is None:
        raise HTTPException(status_code=404, detail="session not found")
    try:
        meta, mz, intensity = fetch_spectrum_at_rt(
            state, float(rt_min), polarity=polarity
        )
    except LCMSLoadError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    labels = [
        {**label, "source": "auto"}
        for label in top_n_peaks(mz, intensity, n=int(top_n), min_rel=float(min_rel))
    ]
    polymer_labels: List[Dict[str, Any]] = []
    if polymer_settings:
        try:
            settings = json.loads(polymer_settings)
            if isinstance(settings, dict):
                polymer_labels = polymer_match_labels(
                    mz,
                    intensity,
                    polarity=meta.get("polarity"),
                    settings=settings,
                )
        except PolymerSearchTooLarge as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="Invalid polymer settings JSON.")
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"Polymer matching failed: {exc}")
    return {
        "meta": meta,
        "mz": [float(v) for v in mz.tolist()],
        "intensity": [float(v) for v in intensity.tolist()],
        "labels": labels + polymer_labels,
        "polymer_labels": polymer_labels,
    }


@router.post("/sessions/{sid}/uv")
async def attach_uv(sid: str, file: UploadFile = File(...)) -> Dict[str, Any]:
    state = registry.get(sid)
    if state is None:
        raise HTTPException(status_code=404, detail="session not found")
    name = file.filename or "upload.csv"
    if not name.lower().endswith((".csv", ".tsv", ".txt")):
        raise HTTPException(status_code=400, detail="Expected a .csv/.tsv/.txt UV chromatogram file.")
    tmp_dir = Path(tempfile.mkdtemp(prefix="mfp_lcms_uv_"))
    dest = tmp_dir / name
    data = await file.read()
    dest.write_bytes(data)
    try:
        attach_uv_from_csv(state, dest, filename=name)
    except UVLoadError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"UV CSV parse failed: {exc}")
    return _session_summary(state)


@router.get("/sessions/{sid}/uv")
def get_uv(
    sid: str,
    top_n: int = 8,
    min_rel: float = 0.05,
    min_distance_min: Optional[float] = None,
) -> Dict[str, Any]:
    state = registry.get(sid)
    if state is None:
        raise HTTPException(status_code=404, detail="session not found")
    uv = state.uv
    if uv is None:
        return {
            "available": False,
            "reason": "No UV chromatogram attached to this dataset.",
        }
    peaks = detect_uv_peaks(
        uv.rt_min,
        uv.signal,
        top_n=int(top_n),
        min_rel=float(min_rel),
        min_distance_min=None if min_distance_min is None else float(min_distance_min),
    )
    return {
        "available": True,
        "meta": _uv_summary(state),
        "rt_min": [float(v) for v in uv.rt_min.tolist()],
        "signal": [float(v) for v in uv.signal.tolist()],
        "peaks": peaks,
    }


@router.delete("/sessions/{sid}/uv")
def delete_uv(sid: str) -> Dict[str, bool]:
    state = registry.get(sid)
    if state is None:
        raise HTTPException(status_code=404, detail="session not found")
    had = clear_uv(state)
    return {"deleted": bool(had)}


@router.delete("/sessions/{sid}")
def delete_session(sid: str) -> Dict[str, bool]:
    ok = registry.remove(sid)
    if not ok:
        raise HTTPException(status_code=404, detail="session not found")
    return {"deleted": True}
