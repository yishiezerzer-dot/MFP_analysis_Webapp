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
    atmospheric_regions,
    compute_preprocessed,
    decimate,
    fit_peak_region,
    integrate_region,
    library_categories,
    library_meta,
    mask_for_peak_picking,
    match_session_references,
    peaks_to_dicts,
    registry,
    session_summary,
    set_peak_label_override,
    subtract_sessions,
)
from lab_gui.ftir_analysis import pick_peaks, pick_peaks_second_derivative

router = APIRouter()


# ------------------------------ models ------------------------------


YMode = Literal["absorbance", "transmittance"]
Baseline = Literal["none", "polyfit", "rubberband", "asls", "airpls"]
Normalize = Literal["none", "max", "area", "snv", "vector", "min-max", "msc"]
IntegrationBaseline = Literal["linear", "horizontal", "tangent"]
FitProfile = Literal["gauss", "lorentz", "voigt"]


class SpectrumRequest(BaseModel):
    mode: YMode = "absorbance"
    smoothing_window: int = Field(default=0, ge=0, le=201)
    poly_order: int = Field(default=2, ge=0, le=5)
    baseline: Baseline = "none"
    normalize: Normalize = "none"
    baseline_lambda: float = Field(default=100000.0, ge=1.0, le=1_000_000_000.0)
    baseline_p: float = Field(default=0.01, ge=0.001, le=0.1)
    mask_atmospheric: bool = False
    atr_correction: bool = False
    atr_n_crystal: float = Field(default=1.5, ge=1.1, le=4.0)
    max_points: int = Field(default=4000, ge=200, le=20000)


class PeaksRequest(BaseModel):
    mode: YMode = "absorbance"
    smoothing_window: int = Field(default=0, ge=0, le=201)
    poly_order: int = Field(default=2, ge=0, le=5)
    baseline: Baseline = "none"
    normalize: Normalize = "none"
    baseline_lambda: float = Field(default=100000.0, ge=1.0, le=1_000_000_000.0)
    baseline_p: float = Field(default=0.01, ge=0.001, le=0.1)
    mask_atmospheric: bool = False
    atr_correction: bool = False
    atr_n_crystal: float = Field(default=1.5, ge=1.1, le=4.0)
    min_prominence: float = Field(default=0.01, ge=0.0)
    min_height: Optional[float] = None
    min_distance_cm1: float = Field(default=8.0, ge=0.0)
    top_n: int = Field(default=0, ge=0, le=200)
    second_derivative: bool = False
    assign: bool = False
    assign_top_n: int = Field(default=3, ge=1, le=10)
    assign_min_score: float = Field(default=35.0, ge=0.0, le=100.0)
    excluded_categories: List[str] = Field(default_factory=list)
    excluded_subcategories: List[str] = Field(default_factory=list)
    ambiguity_ratio: float = Field(default=1.3, ge=1.0, le=5.0)


class PeakLabelOverride(BaseModel):
    band_id: Optional[str] = None
    custom_text: Optional[str] = None
    hidden: bool = False


class PeakLabelOverrideRequest(BaseModel):
    wn: float
    override: Optional[PeakLabelOverride] = None


class IntegrateRequest(SpectrumRequest):
    region: List[float] = Field(..., min_length=2, max_length=2)
    baseline_mode: IntegrationBaseline = "linear"


class SubtractRequest(SpectrumRequest):
    sid_b: str
    k: float = Field(default=1.0, ge=-10.0, le=10.0)
    region_minimize: Optional[List[float]] = Field(default=None, min_length=2, max_length=2)


class MatchRequest(SpectrumRequest):
    region: Optional[List[float]] = Field(default=None, min_length=2, max_length=2)
    derivative_order: int = Field(default=1, ge=0, le=2)
    top_n: int = Field(default=8, ge=1, le=12)


class FitRequest(SpectrumRequest):
    region: List[float] = Field(..., min_length=2, max_length=2)
    n_components: int = Field(default=2, ge=1, le=6)
    profile: FitProfile = "gauss"


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
        baseline_lambda=body.baseline_lambda,
        baseline_p=body.baseline_p,
        atr_correction=body.atr_correction,
        atr_n_crystal=body.atr_n_crystal,
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
            "baseline_lambda": body.baseline_lambda,
            "baseline_p": body.baseline_p,
            "mask_atmospheric": body.mask_atmospheric,
            "atr_correction": body.atr_correction,
            "atr_n_crystal": body.atr_n_crystal,
        },
        "atmospheric_regions": atmospheric_regions() if body.mask_atmospheric else [],
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
        baseline_lambda=body.baseline_lambda,
        baseline_p=body.baseline_p,
        atr_correction=body.atr_correction,
        atr_n_crystal=body.atr_n_crystal,
    )
    x_pick, y_pick = mask_for_peak_picking(x, y_proc, mask_atmospheric=body.mask_atmospheric)
    if body.second_derivative:
        picked = pick_peaks_second_derivative(
            x_pick,
            y_pick,
            mode=body.mode,
            min_distance_cm1=float(body.min_distance_cm1),
            top_n=int(body.top_n or 0),
            smoothing_window=body.smoothing_window or 9,
            poly_order=body.poly_order or 3,
        )
    else:
        picked = pick_peaks(
            x_pick,
            y_pick,
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
            excluded_categories=body.excluded_categories,
            excluded_subcategories=body.excluded_subcategories,
            ambiguity_ratio=body.ambiguity_ratio,
            label_overrides=state.peak_label_overrides,
        )

    return {"peaks": peaks, "assignments": assignments}


@router.post("/sessions/{sid}/integrate")
def integrate_band(sid: str, body: IntegrateRequest) -> Dict[str, Any]:
    state = _require(sid)
    try:
        return integrate_region(
            state,
            region=(body.region[0], body.region[1]),
            baseline_mode=body.baseline_mode,
            preprocess=_preprocess_kwargs(body),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/sessions/{sid}/subtract")
def subtract_spectrum(sid: str, body: SubtractRequest) -> Dict[str, Any]:
    state_a = _require(sid)
    state_b = _require(body.sid_b)
    try:
        return subtract_sessions(
            state_a,
            state_b,
            k=body.k,
            region_minimize=(
                None
                if body.region_minimize is None
                else (body.region_minimize[0], body.region_minimize[1])
            ),
            preprocess=_preprocess_kwargs(body),
            max_points=body.max_points,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/sessions/{sid}/match")
def match_references(sid: str, body: MatchRequest) -> Dict[str, Any]:
    state = _require(sid)
    return match_session_references(
        state,
        region=None if body.region is None else (body.region[0], body.region[1]),
        derivative_order=body.derivative_order,
        top_n=body.top_n,
        preprocess=_preprocess_kwargs(body),
    )


@router.post("/sessions/{sid}/fit")
def fit_region(sid: str, body: FitRequest) -> Dict[str, Any]:
    state = _require(sid)
    try:
        return fit_peak_region(
            state,
            region=(body.region[0], body.region[1]),
            n_components=body.n_components,
            profile=body.profile,
            preprocess=_preprocess_kwargs(body),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/library")
def get_library_meta() -> Dict[str, Any]:
    return library_meta()


@router.get("/library/categories")
def get_library_categories() -> Dict[str, Any]:
    return library_categories()


@router.put("/sessions/{sid}/peak-labels")
def put_peak_label_override(sid: str, body: PeakLabelOverrideRequest) -> Dict[str, Any]:
    state = _require(sid)
    override = body.override.model_dump() if body.override is not None else None
    return set_peak_label_override(state, body.wn, override)


# ------------------------------ util ------------------------------


def _require(sid: str) -> FTIRSession:
    state = registry.get(sid)
    if state is None:
        raise HTTPException(status_code=404, detail="session not found")
    return state


def _preprocess_kwargs(body: SpectrumRequest) -> Dict[str, Any]:
    return {
        "mode": body.mode,
        "smoothing_window": body.smoothing_window,
        "poly_order": body.poly_order,
        "baseline": body.baseline,
        "normalize": body.normalize,
        "baseline_lambda": body.baseline_lambda,
        "baseline_p": body.baseline_p,
        "atr_correction": body.atr_correction,
        "atr_n_crystal": body.atr_n_crystal,
    }
