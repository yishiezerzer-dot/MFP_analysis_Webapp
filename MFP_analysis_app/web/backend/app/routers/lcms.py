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

from fastapi import APIRouter, File, Form, Header, HTTPException, Response, UploadFile
import numpy as np
from pydantic import BaseModel, Field

from ..blob_store import manifest_key, put_json
from ..db import get_session_record, get_upload_dir, save_session_record
from ..upload_utils import read_upload_bytes, stream_upload_to_file
from ..services.lcms_service import (
    LCMSSessionState,
    attach_uv_from_csv,
    clear_uv,
    detect_uv_peaks,
    extracted_ion_chromatogram,
    fetch_spectrum_at_rt,
    find_mz_across_scans,
    get_or_restore,
    iter_ms1_spectra,
    polymer_match_labels,
    registry,
    summed_spectrum_in_rt_range,
    top_n_peaks,
)
from lab_gui.lcms_io import LCMSLoadError, UVLoadError
from lab_gui.lcms_polymer_match import PolymerSearchTooLarge
from lab_gui.lcms_deconvolution import deconvolute_spectrum

router = APIRouter()
_UPLOAD_ROOT = get_upload_dir("lcms")
_MZML_UPLOAD_DIR = _UPLOAD_ROOT / "mzml"
_UV_UPLOAD_DIR = _UPLOAD_ROOT / "uv"


class DeconvoluteRequest(BaseModel):
    rt_min: Optional[float] = None
    rt_max: Optional[float] = None
    polarity: Optional[str] = "positive"
    min_charge: int = Field(default=1, ge=1, le=25)
    max_charge: int = Field(default=8, ge=1, le=25)
    tolerance: float = Field(default=0.02, gt=0)
    tolerance_unit: str = Field(default="da")
    min_rel_intensity: float = Field(default=0.01, ge=0.0, le=1.0)
    mz_min: Optional[float] = None
    mz_max: Optional[float] = None


class EICRequest(BaseModel):
    mz: float
    tolerance: float = Field(default=0.01, gt=0)
    tolerance_unit: str = Field(default="da")
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
    rec = get_session_record(state.session_id)
    return {
        "session_id": state.session_id,
        "workspace_id": state.workspace_id,
        "display_name": state.display_name,
        "path": str(state.path),
        "experiment_tag": rec.get("experiment_tag", "") if rec else "",
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
    file: UploadFile | None = File(None),
    blob_url: str | None = Form(None),
    blob_filename: str | None = Form(None),
    rt_unit: str = Form("minutes"),
    x_workspace_id: str = Header(default="general", alias="X-Workspace-Id"),
) -> Dict[str, Any]:
    dest, name = await stream_upload_to_file(
        file,
        blob_url,
        blob_filename,
        _MZML_UPLOAD_DIR,
        allowed_extensions={".mzml", ".mzml.gz"},
    )
    try:
        state = registry.add_from_path(dest, workspace_id=x_workspace_id, display_name=name, rt_unit=rt_unit)
    except LCMSLoadError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"mzML parse failed: {exc}")
    save_session_record(state.session_id, state.workspace_id, "lcms", state.display_name, str(state.path))
    if blob_url:
        await put_json(
            manifest_key("lcms", state.session_id),
            {
                "blob_url": blob_url,
                "filename": name,
                "display_name": state.display_name,
                "rt_unit": rt_unit,
            },
        )
    return _session_summary(state)


@router.post("/sessions/from_path")
def load_session_from_path(
    body: LoadFromPathRequest,
    x_workspace_id: str = Header(default="general", alias="X-Workspace-Id"),
) -> Dict[str, Any]:
    p = Path(body.path)
    if not p.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {body.path}")
    try:
        state = registry.add_from_path(
            p,
            workspace_id=x_workspace_id,
            display_name=body.display_name or p.name,
            rt_unit=body.rt_unit,
        )
    except LCMSLoadError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"mzML load failed: {exc}")
    return _session_summary(state)


@router.get("/sessions")
def list_sessions(
    x_workspace_id: str = Header(default="general", alias="X-Workspace-Id"),
) -> List[Dict[str, Any]]:
    return [_session_summary(s) for s in registry.list(workspace_id=x_workspace_id)]


async def _require_session(sid: str) -> LCMSSessionState:
    state = await get_or_restore(sid)
    if state is None:
        raise HTTPException(status_code=404, detail="session not found")
    return state


@router.get("/sessions/{sid}")
async def get_session(sid: str) -> Dict[str, Any]:
    return _session_summary(await _require_session(sid))


@router.get("/sessions/{sid}/tic")
async def get_tic(sid: str, polarity: Optional[str] = None) -> Dict[str, Any]:
    state = await _require_session(sid)
    payload = _tic_payload(state, polarity)
    return {
        "rt_min": payload["rt_min"],
        "tic": payload["tic"],
        "polarity": payload["polarity"],
    }


@router.get("/sessions/{sid}/spectrum")
async def get_spectrum(
    sid: str,
    rt_min: float,
    polarity: Optional[str] = None,
    top_n: int = 10,
    min_rel: float = 0.01,
    polymer_settings: Optional[str] = None,
) -> Dict[str, Any]:
    state = await _require_session(sid)
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
async def find_mz(
    sid: str,
    mz: float,
    tolerance: float = 0.01,
    tolerance_unit: str = "da",
    polarity: Optional[str] = None,
) -> Dict[str, Any]:
    state = await _require_session(sid)
    try:
        return find_mz_across_scans(
            state,
            float(mz),
            tolerance=float(tolerance),
            tolerance_unit=tolerance_unit,
            polarity=polarity,
        )
    except LCMSLoadError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/sessions/{sid}/eic")
async def get_eic(sid: str, body: EICRequest) -> Dict[str, Any]:
    state = await _require_session(sid)
    try:
        return extracted_ion_chromatogram(
            state,
            float(body.mz),
            tolerance=float(body.tolerance),
            tolerance_unit=body.tolerance_unit,
            polarity=body.polarity,
        )
    except LCMSLoadError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/sessions/{sid}/region-spectrum")
async def get_region_spectrum(sid: str, body: RegionSpectrumRequest) -> Dict[str, Any]:
    state = await _require_session(sid)
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


@router.post("/sessions/{sid}/deconvolute")
async def deconvolute_session_spectrum(
    sid: str, body: DeconvoluteRequest
) -> Dict[str, Any]:
    state = await _require_session(sid)
    try:
        if body.rt_min is not None and body.rt_max is not None:
            region = summed_spectrum_in_rt_range(
                state,
                rt_min=float(body.rt_min),
                rt_max=float(body.rt_max),
                polarity=body.polarity,
            )
            mzs = region["mz"]
            ints = region["intensity"]
        elif body.rt_min is not None:
            meta, mzs_arr, ints_arr = fetch_spectrum_at_rt(
                state,
                rt_min=float(body.rt_min),
                polarity=body.polarity,
            )
            mzs = mzs_arr.tolist()
            ints = ints_arr.tolist()
        else:
            if len(state.tic_index.rt_min) == 0:
                raise HTTPException(status_code=400, detail="Empty TIC index")
            highest_idx = int(np.argmax(state.tic_index.tic))
            rt = float(state.tic_index.rt_min[highest_idx])
            meta, mzs_arr, ints_arr = fetch_spectrum_at_rt(state, rt_min=rt)
            mzs = mzs_arr.tolist()
            ints = ints_arr.tolist()

        return deconvolute_spectrum(
            mz_array=mzs,
            intensity_array=ints,
            min_charge=body.min_charge,
            max_charge=body.max_charge,
            tolerance=body.tolerance,
            tolerance_unit=body.tolerance_unit,
            polarity=body.polarity or "positive",
            min_rel_intensity=body.min_rel_intensity,
            mz_min=body.mz_min,
            mz_max=body.mz_max,
        )
    except LCMSLoadError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/overlays/tic")
async def get_tic_overlay(body: OverlayRequest) -> Dict[str, Any]:
    traces = []
    missing = []
    for sid in body.session_ids:
        state = await get_or_restore(sid)
        if state is None:
            missing.append(sid)
            continue
        traces.append(_tic_payload(state, body.polarity))
    return {"traces": traces, "missing_session_ids": missing}


@router.post("/exports/tic-overlay.csv")
async def export_tic_overlay(body: OverlayRequest) -> Response:
    rows: List[List[Any]] = [["session_id", "display_name", "rt_min", "tic", "polarity"]]
    for sid in body.session_ids:
        state = await get_or_restore(sid)
        if state is None:
            continue
        payload = _tic_payload(state, body.polarity)
        for rt, tic, pol in zip(payload["rt_min"], payload["tic"], payload["polarity"]):
            rows.append([state.session_id, state.display_name, rt, tic, pol])
    return _csv_response("lcms_tic_overlay.csv", rows)


@router.get("/sessions/{sid}/exports/spectrum.csv")
async def export_spectrum_csv(
    sid: str,
    rt_min: float,
    polarity: Optional[str] = None,
) -> Response:
    state = await _require_session(sid)
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
async def export_labels_csv(
    sid: str,
    polarity: Optional[str] = None,
    top_n: int = 10,
    min_rel: float = 0.01,
) -> Response:
    state = await _require_session(sid)
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
async def export_uv_csv(sid: str) -> Response:
    state = await _require_session(sid)
    uv = state.uv
    if uv is None:
        raise HTTPException(status_code=400, detail="No UV chromatogram attached.")
    rows: List[List[Any]] = [["rt_min", "signal"]]
    for rt, signal in zip(uv.rt_min.tolist(), uv.signal.tolist()):
        rows.append([rt, signal])
    return _csv_response(f"{state.display_name}.uv.csv", rows)


@router.post("/sessions/{sid}/uv")
async def attach_uv(sid: str, file: UploadFile = File(...)) -> Dict[str, Any]:
    state = await _require_session(sid)
    dest, name = await stream_upload_to_file(
        file,
        None,
        None,
        _UV_UPLOAD_DIR,
        allowed_extensions={".csv", ".tsv", ".txt"},
    )
    try:
        attach_uv_from_csv(state, dest, filename=name)
    except UVLoadError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"UV CSV parse failed: {exc}")
    return _session_summary(state)


@router.post("/sessions/{sid}/uv/from_path")
async def attach_uv_from_path_endpoint(sid: str, body: AttachUVFromPathRequest) -> Dict[str, Any]:
    state = await _require_session(sid)
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
async def get_uv(
    sid: str,
    top_n: int = 8,
    min_rel: float = 0.05,
    min_distance_min: Optional[float] = None,
) -> Dict[str, Any]:
    state = await _require_session(sid)
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
async def delete_uv(sid: str) -> Dict[str, bool]:
    state = await _require_session(sid)
    had = clear_uv(state)
    return {"deleted": bool(had)}


@router.delete("/sessions/{sid}")
def delete_session(sid: str) -> Dict[str, bool]:
    ok = registry.remove(sid)
    if not ok:
        raise HTTPException(status_code=404, detail="session not found")
    return {"deleted": True}
