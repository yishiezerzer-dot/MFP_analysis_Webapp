"""FTIR service.

Wraps the existing `lab_gui.ftir_io`, `lab_gui.ftir_analysis`,
`lab_gui.ftir_library`, and `lab_gui.ftir_assignment` modules so the
web app uses the exact same parsing, preprocessing, peak-picking and
library-assignment logic as the desktop app.

Sessions are kept in-process (single-user local dev server). Full-
resolution arrays are cached on the session; decimated arrays are
produced on demand to keep payloads manageable.
"""
from __future__ import annotations

import threading
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

from lab_gui.ftir_analysis import (
    FTIRPeak,
    atmospheric_mask_regions,
    mask_atmospheric_regions,
    pick_peaks,
    preprocess_spectrum,
)
from lab_gui.ftir_assignment import assign_ftir_peaks
from lab_gui.ftir_io import FTIRLoadError, _parse_ftir_xy_numpy
from lab_gui.ftir_library import FTIR_LIBRARY_V3, FTIR_LIBRARY_VERSION, library_categories as ftir_library_categories
from lab_gui.ftir_reference_library import match_reference_spectra


@dataclass
class FTIRSession:
    session_id: str
    display_name: str
    path: Path
    x: np.ndarray
    y: np.ndarray
    meta: Dict[str, str] = field(default_factory=dict)
    y_mode: str = "absorbance"
    peak_label_overrides: Dict[str, Dict[str, Any]] = field(default_factory=dict)


class FTIRRegistry:
    def __init__(self) -> None:
        self._sessions: Dict[str, FTIRSession] = {}
        self._lock = threading.Lock()

    def add_from_path(
        self,
        path: Path,
        *,
        display_name: Optional[str] = None,
        y_mode: str = "absorbance",
    ) -> FTIRSession:
        try:
            x, y, meta = _parse_ftir_xy_numpy(str(path))
        except Exception as exc:  # noqa: BLE001 — we rewrap into FTIRLoadError
            raise FTIRLoadError(f"Failed to parse FTIR file: {exc}")
        if x.size < 5:
            raise FTIRLoadError("No usable numeric XY data found")

        # Ensure ascending wavenumber for internal consistency. Plots reverse
        # the x-axis on the frontend to match IR convention.
        order = np.argsort(x)
        x = np.asarray(x[order], dtype=float)
        y = np.asarray(y[order], dtype=float)

        session = FTIRSession(
            session_id=uuid.uuid4().hex,
            display_name=display_name or path.name,
            path=path,
            x=x,
            y=y,
            meta=dict(meta or {}),
            y_mode=str(y_mode or "absorbance"),
        )
        with self._lock:
            self._sessions[session.session_id] = session
        return session

    def get(self, sid: str) -> Optional[FTIRSession]:
        with self._lock:
            return self._sessions.get(sid)

    def remove(self, sid: str) -> bool:
        with self._lock:
            return self._sessions.pop(sid, None) is not None

    def list(self) -> List[FTIRSession]:
        with self._lock:
            return list(self._sessions.values())


registry = FTIRRegistry()


# ---------------------------- helpers ----------------------------


def session_summary(s: FTIRSession) -> Dict[str, Any]:
    return {
        "session_id": s.session_id,
        "display_name": s.display_name,
        "path": str(s.path),
        "n_points": int(s.x.size),
        "wn_min": float(s.x.min()) if s.x.size else None,
        "wn_max": float(s.x.max()) if s.x.size else None,
        "y_min": float(np.nanmin(s.y)) if s.y.size else None,
        "y_max": float(np.nanmax(s.y)) if s.y.size else None,
        "y_mode": s.y_mode,
        "meta": {k: v for k, v in s.meta.items() if isinstance(v, (str, int, float))},
    }


def decimate(
    x: np.ndarray,
    y: np.ndarray,
    *,
    max_points: int = 4000,
) -> Tuple[np.ndarray, np.ndarray]:
    """Uniform stride decimation — cheap and preserves gross shape.

    Intended for transmitting display arrays to the browser. Peak picking is
    always performed on the full-resolution arrays.
    """
    n = int(x.size)
    if n <= int(max_points) or max_points <= 0:
        return x, y
    stride = max(1, n // int(max_points))
    return x[::stride], y[::stride]


def compute_preprocessed(
    s: FTIRSession,
    *,
    mode: str,
    smoothing_window: int,
    poly_order: int,
    baseline: str,
    normalize: str,
    baseline_lambda: float = 100000.0,
    baseline_p: float = 0.01,
    atr_correction: bool = False,
    atr_n_crystal: float = 1.5,
) -> Tuple[np.ndarray, np.ndarray]:
    x, y_proc = preprocess_spectrum(
        s.x,
        s.y,
        mode=mode,
        smoothing_window=int(smoothing_window or 0),
        poly_order=int(poly_order or 0),
        baseline=str(baseline or "none"),
        normalize=str(normalize or "none"),
        baseline_lambda=float(baseline_lambda or 100000.0),
        baseline_p=float(baseline_p or 0.01),
        atr_correction=bool(atr_correction),
        atr_n_crystal=float(atr_n_crystal or 1.5),
    )
    return x, y_proc


def mask_for_peak_picking(x: np.ndarray, y: np.ndarray, *, mask_atmospheric: bool) -> Tuple[np.ndarray, np.ndarray]:
    if not mask_atmospheric:
        return x, y
    return mask_atmospheric_regions(x, y)


def atmospheric_regions() -> List[Dict[str, Any]]:
    return atmospheric_mask_regions()


def integrate_region(
    s: FTIRSession,
    *,
    region: Tuple[float, float],
    baseline_mode: str,
    preprocess: Dict[str, Any],
) -> Dict[str, Any]:
    x, y = compute_preprocessed(s, **preprocess)
    lo, hi = sorted((float(region[0]), float(region[1])))
    mask = (x >= lo) & (x <= hi)
    if int(mask.sum()) < 3:
        raise ValueError("Integration region must contain at least 3 points")
    xr = np.asarray(x[mask], dtype=float)
    yr = np.asarray(y[mask], dtype=float)
    base = _integration_baseline(xr, yr, baseline_mode=baseline_mode)
    signal = yr - base
    polarity = 1.0 if abs(float(np.nanmax(signal))) >= abs(float(np.nanmin(signal))) else -1.0
    positive = polarity * signal
    peak_idx = int(np.nanargmax(positive))
    height = float(max(0.0, positive[peak_idx]))
    area = float(np.trapezoid(np.maximum(positive, 0.0), xr))
    return {
        "region": [lo, hi],
        "baseline_mode": str(baseline_mode or "linear"),
        "area": area,
        "height": height,
        "fwhm": _estimate_fwhm(xr, positive, height),
        "baseline_y_at_lo": float(base[0]),
        "baseline_y_at_hi": float(base[-1]),
        "peak_wn": float(xr[peak_idx]),
    }


def subtract_sessions(
    a: FTIRSession,
    b: FTIRSession,
    *,
    k: float,
    region_minimize: Optional[Tuple[float, float]],
    preprocess: Dict[str, Any],
    max_points: int = 4000,
) -> Dict[str, Any]:
    xa, ya = compute_preprocessed(a, **preprocess)
    xb, yb = compute_preprocessed(b, **preprocess)
    lo = max(float(np.nanmin(xa)), float(np.nanmin(xb)))
    hi = min(float(np.nanmax(xa)), float(np.nanmax(xb)))
    if not hi > lo:
        raise ValueError("Spectra do not overlap in wavenumber")
    mask = (xa >= lo) & (xa <= hi)
    x_common = np.asarray(xa[mask], dtype=float)
    ya_common = np.asarray(ya[mask], dtype=float)
    yb_common = np.interp(x_common, xb, yb)
    scale = float(k)
    if region_minimize is not None:
        rlo, rhi = sorted((float(region_minimize[0]), float(region_minimize[1])))
        rmask = (x_common >= rlo) & (x_common <= rhi)
        if int(rmask.sum()) >= 3:
            denom = float(np.dot(yb_common[rmask], yb_common[rmask]))
            if denom > 1e-12:
                scale = float(np.dot(ya_common[rmask], yb_common[rmask]) / denom)
    diff = ya_common - scale * yb_common
    x_d, y_d = decimate(x_common, diff, max_points=max_points)
    return {
        "wn": [float(v) for v in x_d.tolist()],
        "y": [float(v) for v in y_d.tolist()],
        "sid_a": a.session_id,
        "sid_b": b.session_id,
        "k": scale,
        "n_points_full": int(x_common.size),
        "n_points_returned": int(x_d.size),
    }


def match_session_references(
    s: FTIRSession,
    *,
    region: Optional[Tuple[float, float]],
    derivative_order: int,
    top_n: int,
    preprocess: Dict[str, Any],
) -> Dict[str, Any]:
    x, y = compute_preprocessed(s, **preprocess)
    return match_reference_spectra(
        x,
        y,
        region=region,
        derivative_order=int(derivative_order or 1),
        top_n=int(top_n or 8),
    )


def fit_peak_region(
    s: FTIRSession,
    *,
    region: Tuple[float, float],
    n_components: int,
    profile: str,
    preprocess: Dict[str, Any],
) -> Dict[str, Any]:
    x, y = compute_preprocessed(s, **preprocess)
    lo, hi = sorted((float(region[0]), float(region[1])))
    mask = (x >= lo) & (x <= hi)
    if int(mask.sum()) < 8:
        raise ValueError("Fit region must contain at least 8 points")
    xr = np.asarray(x[mask], dtype=float)
    yr = np.asarray(y[mask], dtype=float)
    base = np.interp(xr, [xr[0], xr[-1]], [yr[0], yr[-1]])
    signal = yr - base
    polarity = 1.0 if abs(float(np.nanmax(signal))) >= abs(float(np.nanmin(signal))) else -1.0
    positive = polarity * signal
    positive = np.maximum(positive, 0.0)
    n_comp = max(1, min(6, int(n_components or 1)))
    prof = str(profile or "gauss").strip().lower()
    centers = _initial_component_centers(xr, positive, n_comp)
    width0 = max(2.0, abs(hi - lo) / max(8.0, n_comp * 3.0))
    p0: List[float] = []
    bounds_lo: List[float] = []
    bounds_hi: List[float] = []
    for center in centers:
        amp = float(np.interp(center, xr, positive))
        p0.extend([max(amp, float(np.nanmax(positive)) / max(1, n_comp)), center, width0])
        bounds_lo.extend([0.0, lo, 1.0])
        bounds_hi.extend([max(1e-9, float(np.nanmax(positive)) * 2.5), hi, abs(hi - lo)])

    params = p0
    try:
        from scipy.optimize import curve_fit  # type: ignore

        params_arr, _cov = curve_fit(
            lambda xx, *pars: _component_sum(np.asarray(xx, dtype=float), list(pars), prof),
            xr,
            positive,
            p0=p0,
            bounds=(bounds_lo, bounds_hi),
            maxfev=20000,
        )
        params = [float(v) for v in params_arr.tolist()]
    except Exception:
        params = p0

    components = []
    fitted_positive = np.zeros_like(xr)
    for idx in range(n_comp):
        amp, center, width = params[idx * 3 : idx * 3 + 3]
        y_comp = _profile(xr, amp, center, width, prof)
        fitted_positive += y_comp
        signed = base + polarity * y_comp
        components.append(
            {
                "index": idx + 1,
                "amplitude": float(amp),
                "center": float(center),
                "width": float(width),
                "area": float(np.trapezoid(y_comp, xr)),
                "wn": [float(v) for v in xr.tolist()],
                "y": [float(v) for v in signed.tolist()],
            }
        )

    fitted = base + polarity * fitted_positive
    residual = yr - fitted
    ss_res = float(np.sum(residual * residual))
    ss_tot = float(np.sum((yr - float(np.mean(yr))) ** 2))
    r2 = 1.0 - ss_res / ss_tot if ss_tot > 1e-12 else None
    return {
        "region": [lo, hi],
        "profile": prof,
        "components": components,
        "fit": {
            "wn": [float(v) for v in xr.tolist()],
            "y": [float(v) for v in fitted.tolist()],
        },
        "r2": r2,
        "residual_rms": float(np.sqrt(np.mean(residual * residual))),
    }


def _initial_component_centers(x: np.ndarray, y: np.ndarray, n_components: int) -> List[float]:
    try:
        idx = np.argpartition(y, -n_components)[-n_components:]
        centers = sorted(float(x[int(i)]) for i in idx)
        if len(centers) == n_components:
            return centers
    except Exception:
        pass
    return [float(v) for v in np.linspace(float(x[0]), float(x[-1]), n_components + 2)[1:-1]]


def _component_sum(x: np.ndarray, params: List[float], profile: str) -> np.ndarray:
    y = np.zeros_like(x, dtype=float)
    for idx in range(0, len(params), 3):
        y += _profile(x, params[idx], params[idx + 1], params[idx + 2], profile)
    return y


def _profile(x: np.ndarray, amp: float, center: float, width: float, profile: str) -> np.ndarray:
    w = max(1e-6, float(width))
    if profile == "lorentz":
        return float(amp) / (1.0 + ((x - float(center)) / w) ** 2)
    if profile == "voigt":
        gauss = float(amp) * np.exp(-0.5 * ((x - float(center)) / w) ** 2)
        lorentz = float(amp) / (1.0 + ((x - float(center)) / w) ** 2)
        return 0.5 * (gauss + lorentz)
    return float(amp) * np.exp(-0.5 * ((x - float(center)) / w) ** 2)


def _integration_baseline(x: np.ndarray, y: np.ndarray, *, baseline_mode: str) -> np.ndarray:
    mode = str(baseline_mode or "linear").strip().lower()
    if mode == "horizontal":
        return np.full_like(y, float(min(y[0], y[-1])), dtype=float)
    if mode == "tangent":
        n = int(y.size)
        edge = max(2, min(20, n // 5))
        left_idx = int(np.nanargmin(y[:edge]))
        right_idx = n - edge + int(np.nanargmin(y[-edge:]))
        if right_idx > left_idx:
            return np.interp(x, [x[left_idx], x[right_idx]], [y[left_idx], y[right_idx]])
    return np.interp(x, [x[0], x[-1]], [y[0], y[-1]])


def _estimate_fwhm(x: np.ndarray, y_positive: np.ndarray, height: float) -> Optional[float]:
    if not height > 0:
        return None
    half = height / 2.0
    above = np.where(y_positive >= half)[0]
    if above.size < 2:
        return None
    return float(abs(float(x[int(above[-1])]) - float(x[int(above[0])])))


def peaks_to_dicts(peaks: List[FTIRPeak]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for p in peaks:
        out.append(
            {
                "wn": float(p.wn),
                "y": float(p.y),
                "prominence": float(p.prominence),
                "width_cm1": (None if p.width_cm1 is None else float(p.width_cm1)),
                "left_base_wn": (None if p.left_base_wn is None else float(p.left_base_wn)),
                "right_base_wn": (None if p.right_base_wn is None else float(p.right_base_wn)),
            }
        )
    return out


def assign_peaks_with_library(
    peaks: List[Dict[str, Any]],
    *,
    top_n: int = 3,
    min_score: float = 35.0,
    excluded_categories: Optional[List[str]] = None,
    excluded_subcategories: Optional[List[str]] = None,
    ambiguity_ratio: float = 1.3,
    label_overrides: Optional[Dict[str, Dict[str, Any]]] = None,
) -> List[Dict[str, Any]]:
    # The assignment module expects `height` (not `y`) on each peak dict.
    normalized = [
        {
            "wn": p["wn"],
            "height": p.get("y"),
            "width": p.get("width_cm1"),
            "prominence": p.get("prominence"),
        }
        for p in peaks
    ]
    assignments = assign_ftir_peaks(
        normalized,
        FTIR_LIBRARY_V3,
        top_n=int(top_n or 3),
        min_score=float(min_score),
        excluded_categories=excluded_categories or [],
        excluded_subcategories=excluded_subcategories or [],
        ambiguity_ratio=float(ambiguity_ratio or 1.3),
    )
    if label_overrides:
        for assignment in assignments:
            override = label_overrides.get(peak_label_key(float(assignment["wn"])))
            if override:
                assignment["override"] = dict(override)
    return assignments


def library_meta() -> Dict[str, Any]:
    return {
        "version": FTIR_LIBRARY_VERSION,
        "n_entries": len(FTIR_LIBRARY_V3),
    }


def library_categories() -> Dict[str, Any]:
    return ftir_library_categories()


def peak_label_key(wn: float) -> str:
    return f"{float(wn):.3f}"


def set_peak_label_override(s: FTIRSession, wn: float, override: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    key = peak_label_key(wn)
    if not override:
        s.peak_label_overrides.pop(key, None)
        return {"wn": float(wn), "key": key, "override": None}

    clean = {
        "band_id": override.get("band_id"),
        "custom_text": override.get("custom_text"),
        "hidden": bool(override.get("hidden", False)),
    }
    if not clean["band_id"] and not clean["custom_text"] and not clean["hidden"]:
        s.peak_label_overrides.pop(key, None)
        clean = None
    else:
        s.peak_label_overrides[key] = clean
    return {"wn": float(wn), "key": key, "override": clean}
