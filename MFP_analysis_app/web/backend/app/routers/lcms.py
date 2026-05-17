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
import hashlib
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, File, Form, HTTPException, Response, UploadFile
import numpy as np
from pydantic import BaseModel, Field

from ..services.lcms_service import (
    LCMSSessionState,
    attach_uv_from_csv,
    clear_uv,
    detect_uv_peaks,
    extracted_ion_chromatogram,
    fetch_spectrum_at_rt,
    find_mz_across_scans,
    iter_ms1_spectra,
    polymer_match_labels,
    registry,
    summed_spectrum_in_rt_range,
    top_n_peaks,
)
from lab_gui.lcms_io import LCMSLoadError, UVLoadError
from lab_gui.lcms_polymer_match import PolymerSearchTooLarge

router = APIRouter()
_PROJECT_ROOT = Path(__file__).resolve().parents[3]
_UPLOAD_ROOT = _PROJECT_ROOT / ".mfp_uploads" / "lcms"
_MZML_UPLOAD_DIR = _UPLOAD_ROOT / "mzml"
_UV_UPLOAD_DIR = _UPLOAD_ROOT / "uv"


class EICRequest(BaseModel):
    mz: float
    tolerance: float = Field(default=0.01, gt=0)
    polarity: Optional[str] = None


class RegionSpectrumRequest(BaseModel):
    rt_min: float
    rt_max: float
    polarity: Optional[str] = None
    bin_width: float = Field(default=0.01, gt=0)
    min_rel: float = Field(default=0.0, ge=0)
    max_bins: int = Field(default=25000, ge=100, le=200000)
    polymer_settings: Optional[Dict[str, Any]] = None


class OverlayRequest(BaseModel):
    session_ids: List[str]
    polarity: Optional[str] = None


class LoadFromPathRequest(BaseModel):
    path: str
    display_name: Optional[str] = None
    rt_unit: str = "minutes"


class AttachUVFromPathRequest(BaseModel):
    path: str


def _safe_upload_name(filename: str, default: str) -> str:
    name = Path(filename or default).name
    return name or default


def _persistent_upload_path(upload_dir: Path, filename: str, data: bytes) -> Path:
    upload_dir.mkdir(parents=True, exist_ok=True)
    safe_name = _safe_upload_name(filename, "upload")
    stem = Path(safe_name).stem or "upload"
    suffix = "".join(Path(safe_name).suffixes)
    digest = hashlib.sha256(data).hexdigest()[:12]
    return upload_dir / f"{stem}.{digest}{suffix}"


def _csv_response(filename: str, rows: List[List[Any]]) -> Response:
    def esc(value: Any) -> str:
        text = "" if value is None else str(value)
        if any(ch in text for ch in [",", "\"", "\n", "\r"]):
            return "\"" + text.replace("\"", "\"\"") + "\""
        return text

    body = "\n".join(",".join(esc(value) for value in row) for row in rows) + "\n"
    safe = "".join(ch if ch.isalnum() or ch in ("-", "_", ".") else "_" for ch in filename)
    return Response(
        content=body,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{safe}"'},
    )


def _uv_summary(state: LCMSSessionState) -> Dict[str, Any]:
    uv = state.uv
    if uv is None:
        return {"available": False}
    return {
        "available": True,
        "filename": uv.filename,
        "path": str(uv.path),
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


def _tic_payload(state: LCMSSessionState, polarity: Optional[str] = None) -> Dict[str, Any]:
    metas = state.index.ms1
    if polarity in ("positive", "negative"):
        metas = [m for m in metas if m.polarity == polarity]
    return {
        "session_id": state.session_id,
        "display_name": state.display_name,
        "rt_min": [float(m.rt_min) for m in metas],
        "tic": [float(m.tic) for m in metas],
        "polarity": [m.polarity for m in metas],
    }


@router.post("/sessions")
async def create_session(
    file: UploadFile = File(...),
    rt_unit: str = Form("minutes"),
) -> Dict[str, Any]:
    name = file.filename or "upload.mzML"
    if not name.lower().endswith((".mzml", ".mzml.gz")):
        raise HTTPException(status_code=400, detail="Expected a .mzML file.")
    data = await file.read()
    dest = _persistent_upload_path(_MZML_UPLOAD_DIR, name, data)
    dest.write_bytes(data)
    try:
        state = registry.add_from_path(dest, display_name=name, rt_unit=rt_unit)
    except LCMSLoadError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"mzML parse failed: {exc}")
    return _session_summary(state)


@router.post("/sessions/from_path")
def load_session_from_path(body: LoadFromPathRequest) -> Dict[str, Any]:
    p = Path(body.path)
    if not p.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {body.path}")
    try:
        state = registry.add_from_path(
            p,
            display_name=body.display_name or p.name,
            rt_unit=body.rt_unit,
        )
    except LCMSLoadError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"mzML load failed: {exc}")
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
    payload = _tic_payload(state, polarity)
    return {
        "rt_min": payload["rt_min"],
        "tic": payload["tic"],
        "polarity": payload["polarity"],
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


@router.get("/sessions/{sid}/find-mz")
def find_mz(
    sid: str,
    mz: float,
    tolerance: float = 0.01,
    polarity: Optional[str] = None,
) -> Dict[str, Any]:
    state = registry.get(sid)
    if state is None:
        raise HTTPException(status_code=404, detail="session not found")
    try:
        return find_mz_across_scans(
            state,
            float(mz),
            tolerance=float(tolerance),
            polarity=polarity,
        )
    except LCMSLoadError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/sessions/{sid}/eic")
def get_eic(sid: str, body: EICRequest) -> Dict[str, Any]:
    state = registry.get(sid)
    if state is None:
        raise HTTPException(status_code=404, detail="session not found")
    try:
        return extracted_ion_chromatogram(
            state,
            float(body.mz),
            tolerance=float(body.tolerance),
            polarity=body.polarity,
        )
    except LCMSLoadError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/sessions/{sid}/region-spectrum")
def get_region_spectrum(sid: str, body: RegionSpectrumRequest) -> Dict[str, Any]:
    state = registry.get(sid)
    if state is None:
        raise HTTPException(status_code=404, detail="session not found")
    try:
        payload = summed_spectrum_in_rt_range(
            state,
            rt_min=float(body.rt_min),
            rt_max=float(body.rt_max),
            polarity=body.polarity,
            bin_width=float(body.bin_width),
            min_rel=float(body.min_rel),
            max_bins=int(body.max_bins),
        )
        polymer_labels: List[Dict[str, Any]] = []
        if body.polymer_settings:
            polymer_labels = polymer_match_labels(
                np.asarray(payload["mz"], dtype=float),
                np.asarray(payload["intensity"], dtype=float),
                polarity=body.polarity,
                settings=body.polymer_settings,
            )
        payload["polymer_labels"] = polymer_labels
        return payload
    except LCMSLoadError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except PolymerSearchTooLarge as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except (ValueError, KeyError, TypeError) as exc:
        raise HTTPException(status_code=400, detail=f"Polymer matching failed: {exc}")


@router.post("/overlays/tic")
def get_tic_overlay(body: OverlayRequest) -> Dict[str, Any]:
    traces = []
    missing = []
    for sid in body.session_ids:
        state = registry.get(sid)
        if state is None:
            missing.append(sid)
            continue
        traces.append(_tic_payload(state, body.polarity))
    return {"traces": traces, "missing_session_ids": missing}


@router.post("/exports/tic-overlay.csv")
def export_tic_overlay(body: OverlayRequest) -> Response:
    rows: List[List[Any]] = [["session_id", "display_name", "rt_min", "tic", "polarity"]]
    for sid in body.session_ids:
        state = registry.get(sid)
        if state is None:
            continue
        payload = _tic_payload(state, body.polarity)
        for rt, tic, pol in zip(payload["rt_min"], payload["tic"], payload["polarity"]):
            rows.append([state.session_id, state.display_name, rt, tic, pol])
    return _csv_response("lcms_tic_overlay.csv", rows)


@router.get("/sessions/{sid}/exports/spectrum.csv")
def export_spectrum_csv(
    sid: str,
    rt_min: float,
    polarity: Optional[str] = None,
) -> Response:
    state = registry.get(sid)
    if state is None:
        raise HTTPException(status_code=404, detail="session not found")
    try:
        meta, mz, intensity = fetch_spectrum_at_rt(
            state,
            float(rt_min),
            polarity=polarity,
        )
    except LCMSLoadError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    rows: List[List[Any]] = [["spectrum_id", "rt_min", "polarity", "mz", "intensity"]]
    for mz_val, int_val in zip(mz.tolist(), intensity.tolist()):
        rows.append([meta["spectrum_id"], meta["rt_min"], meta["polarity"], mz_val, int_val])
    return _csv_response(f"{state.display_name}.spectrum.csv", rows)


@router.get("/sessions/{sid}/exports/labels.csv")
def export_labels_csv(
    sid: str,
    polarity: Optional[str] = None,
    top_n: int = 10,
    min_rel: float = 0.01,
) -> Response:
    state = registry.get(sid)
    if state is None:
        raise HTTPException(status_code=404, detail="session not found")
    rows: List[List[Any]] = [
        ["spectrum_id", "rt_min", "polarity", "label_source", "mz", "intensity", "text"]
    ]
    try:
        for meta, mz, intensity in iter_ms1_spectra(state, polarity=polarity):
            for label in top_n_peaks(
                mz,
                intensity,
                n=max(1, int(top_n)),
                min_rel=max(0.0, float(min_rel)),
            ):
                rows.append([
                    meta.spectrum_id,
                    float(meta.rt_min),
                    meta.polarity,
                    "auto",
                    label["mz"],
                    label["intensity"],
                    "",
                ])
    except LCMSLoadError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return _csv_response(f"{state.display_name}.labels.csv", rows)


@router.get("/sessions/{sid}/exports/uv.csv")
def export_uv_csv(sid: str) -> Response:
    state = registry.get(sid)
    if state is None:
        raise HTTPException(status_code=404, detail="session not found")
    uv = state.uv
    if uv is None:
        raise HTTPException(status_code=400, detail="No UV chromatogram attached.")
    rows: List[List[Any]] = [["rt_min", "signal"]]
    for rt, signal in zip(uv.rt_min.tolist(), uv.signal.tolist()):
        rows.append([rt, signal])
    return _csv_response(f"{state.display_name}.uv.csv", rows)


@router.post("/sessions/{sid}/uv")
async def attach_uv(sid: str, file: UploadFile = File(...)) -> Dict[str, Any]:
    state = registry.get(sid)
    if state is None:
        raise HTTPException(status_code=404, detail="session not found")
    name = file.filename or "upload.csv"
    if not name.lower().endswith((".csv", ".tsv", ".txt")):
        raise HTTPException(status_code=400, detail="Expected a .csv/.tsv/.txt UV chromatogram file.")
    data = await file.read()
    dest = _persistent_upload_path(_UV_UPLOAD_DIR, name, data)
    dest.write_bytes(data)
    try:
        attach_uv_from_csv(state, dest, filename=name)
    except UVLoadError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"UV CSV parse failed: {exc}")
    return _session_summary(state)


@router.post("/sessions/{sid}/uv/from_path")
def attach_uv_from_path_endpoint(sid: str, body: AttachUVFromPathRequest) -> Dict[str, Any]:
    state = registry.get(sid)
    if state is None:
        raise HTTPException(status_code=404, detail="session not found")
    p = Path(body.path)
    if not p.exists():
        raise HTTPException(status_code=404, detail=f"UV file not found: {body.path}")
    try:
        attach_uv_from_csv(state, p, filename=p.name)
    except UVLoadError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"UV CSV load failed: {exc}")
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
