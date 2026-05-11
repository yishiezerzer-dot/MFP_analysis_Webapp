"""FTIR analysis utilities (no GUI, no plotting).

This module is intentionally dependency-light. If SciPy is available, peak picking
uses `scipy.signal.find_peaks`; otherwise it falls back to a simple local-maxima
finder with an approximate prominence estimate.

Conventions
- `wn` is wavenumber in cm^-1 (or any monotonic x-units).
- `mode="absorbance"`: peaks are local maxima.
- `mode="transmittance"`: absorption bands are local minima, so we pick peaks on
  `-y` (but return the original `y` at the selected `wn`).

All functions tolerate lists/arrays, NaNs/Infs, and unsorted x.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional, Sequence, Tuple

import math

import numpy as np


def preprocess_spectrum(
    wn: Sequence[float] | np.ndarray,
    y: Sequence[float] | np.ndarray,
    *,
    mode: str = "absorbance",
    smoothing_window: int = 0,
    poly_order: int = 2,
    baseline: str = "none",
    normalize: str = "none",
    baseline_lambda: float = 100000.0,
    baseline_p: float = 0.01,
    atr_correction: bool = False,
    atr_n_crystal: float = 1.5,
) -> Tuple[np.ndarray, np.ndarray]:
    """Preprocess an FTIR spectrum for peak picking.

    This function does NOT pick peaks; it only returns processed arrays.

    Steps (in order):
      1) sanitize + sort by `wn`
      2) optional smoothing
      3) optional ATR correction
      4) optional baseline correction
      5) optional normalization

    Args:
        wn: x array (wavenumber).
        y: signal array.
        mode: "absorbance" or "transmittance" (used only for sensible defaults;
            this function returns processed y in the original orientation).
        smoothing_window: Savitzky-Golay (SciPy) or moving-average window size.
            Use 0/1 to disable.
        poly_order: For Savitzky-Golay (if SciPy available). Must be < window.
        baseline: "none", "polyfit", "rubberband", "asls", or "airpls".
        normalize: "none", "max", "area", "snv", "vector", or "min-max".
        baseline_lambda: smoothness for iterative baselines.
        baseline_p: asymmetry for AsLS.
        atr_correction: apply a gentle ATR penetration-depth correction.
        atr_n_crystal: refractive index used to scale ATR correction.

    Returns:
        (wn_sorted, y_processed)

    Notes:
        - Non-finite points are dropped.
        - If the result is empty, returns empty arrays.
        - Baseline polyfit uses degree=min(3, n-1).
    """

    x, y0 = _sanitize_xy(wn, y)
    if x.size == 0:
        return x, y0

    y_out = np.asarray(y0, dtype=float)

    # --- smoothing ---
    w = int(smoothing_window or 0)
    if w >= 3:
        # Make odd for SavGol
        if (w % 2) == 0:
            w += 1
        if w >= 3 and w <= int(y_out.size):
            y_out = _smooth(y_out, window=w, poly_order=int(poly_order or 0))

    # --- ATR correction ---
    if bool(atr_correction):
        y_out = _atr_correct(x, y_out, n_crystal=float(atr_n_crystal or 1.5))

    # --- baseline correction ---
    b = (baseline or "none").strip().lower()
    if b == "polyfit":
        y_out = _baseline_polyfit(x, y_out)
    elif b == "rubberband":
        y_out = _baseline_rubberband(x, y_out)
    elif b == "asls":
        y_out = _baseline_asls(y_out, lam=float(baseline_lambda or 100000.0), p=float(baseline_p or 0.01))
    elif b == "airpls":
        y_out = _baseline_airpls(y_out, lam=float(baseline_lambda or 100000.0))

    # --- normalization ---
    nrm = (normalize or "none").strip().lower()
    if nrm == "max":
        y_out = _normalize_max(y_out)
    elif nrm == "area":
        y_out = _normalize_area(x, y_out)
    elif nrm == "snv":
        y_out = _normalize_snv(y_out)
    elif nrm == "vector":
        y_out = _normalize_vector(y_out)
    elif nrm in {"min-max", "minmax"}:
        y_out = _normalize_minmax(y_out)
    elif nrm == "msc":
        y_out = _normalize_msc(y_out)

    return x, np.asarray(y_out, dtype=float)


def _smooth(y: np.ndarray, *, window: int, poly_order: int) -> np.ndarray:
    """Smooth with Savitzky-Golay if available else moving average."""

    yy = np.asarray(y, dtype=float)
    if yy.size < 3:
        return yy

    w = int(window)
    if w < 3:
        return yy
    if (w % 2) == 0:
        w += 1
    if w > int(yy.size):
        w = int(yy.size) if (int(yy.size) % 2 == 1) else int(yy.size) - 1
    if w < 3:
        return yy

    po = int(poly_order or 0)
    po = max(0, po)
    po = min(po, w - 1)
    po = min(po, 5)  # prevent absurd degrees

    try:
        from scipy.signal import savgol_filter  # type: ignore

        try:
            return np.asarray(savgol_filter(yy, window_length=w, polyorder=po, mode="interp"), dtype=float)
        except Exception:
            pass
    except Exception:
        pass

    # Fallback: moving average (edge-padded)
    k = w
    pad = k // 2
    ypad = np.pad(yy, (pad, pad), mode="edge")
    kernel = np.ones(k, dtype=float) / float(k)
    return np.convolve(ypad, kernel, mode="valid").astype(float)


def _baseline_polyfit(x: np.ndarray, y: np.ndarray) -> np.ndarray:
    """Implement the `_baseline_polyfit` behavior for this module.

    Text-only documentation note: modify internal logic here to change behavior.
    """
    xx = np.asarray(x, dtype=float)
    yy = np.asarray(y, dtype=float)
    n = int(yy.size)
    if n < 4:
        return yy

    deg = min(3, n - 1)
    try:
        coeff = np.polyfit(xx, yy, deg=int(deg))
        base = np.polyval(coeff, xx)
        return (yy - base).astype(float)
    except Exception:
        return yy


def _baseline_rubberband(x: np.ndarray, y: np.ndarray) -> np.ndarray:
    """Subtract a lower-envelope rubberband baseline."""

    xx = np.asarray(x, dtype=float)
    yy = np.asarray(y, dtype=float)
    if yy.size < 3:
        return yy

    try:
      from scipy.spatial import ConvexHull  # type: ignore

      points = np.column_stack([xx, yy])
      hull = ConvexHull(points)
      vertices = sorted(int(v) for v in hull.vertices)
      lower = []
      for idx in vertices:
          x0 = xx[idx]
          y0 = yy[idx]
          if not lower:
              lower.append(idx)
              continue
          last = lower[-1]
          if x0 <= xx[last]:
              continue
          slope = (y0 - yy[last]) / max(1e-12, x0 - xx[last])
          while len(lower) >= 2:
              prev = lower[-2]
              prev_slope = (yy[last] - yy[prev]) / max(1e-12, xx[last] - xx[prev])
              if slope > prev_slope:
                  break
              lower.pop()
              last = lower[-1]
              slope = (y0 - yy[last]) / max(1e-12, x0 - xx[last])
          lower.append(idx)
      if len(lower) >= 2:
          base = np.interp(xx, xx[lower], yy[lower])
          return (yy - base).astype(float)
    except Exception:
        pass

    return _baseline_rolling_minimum(xx, yy)


def _baseline_rolling_minimum(x: np.ndarray, y: np.ndarray) -> np.ndarray:
    yy = np.asarray(y, dtype=float)
    n = int(yy.size)
    if n < 3:
        return yy
    window = max(5, min(101, (n // 20) | 1))
    pad = window // 2
    padded = np.pad(yy, (pad, pad), mode="edge")
    mins = np.array([np.nanmin(padded[i : i + window]) for i in range(n)], dtype=float)
    base = _smooth(mins, window=min(window, n if n % 2 else n - 1), poly_order=2)
    return (yy - base).astype(float)


def _baseline_asls(y: np.ndarray, *, lam: float, p: float, n_iter: int = 12) -> np.ndarray:
    """Asymmetric least-squares baseline correction."""

    yy = np.asarray(y, dtype=float)
    n = int(yy.size)
    if n < 5:
        return yy
    lam = float(max(1.0, min(1e9, lam)))
    p = float(max(0.001, min(0.1, p)))
    try:
        from scipy import sparse  # type: ignore
        from scipy.sparse.linalg import spsolve  # type: ignore

        dmat = sparse.diags([1.0, -2.0, 1.0], [0, 1, 2], shape=(n - 2, n), format="csc")
        penalty = lam * (dmat.T @ dmat)
        weights = np.ones(n, dtype=float)
        z = yy.copy()
        for _ in range(int(n_iter)):
            wmat = sparse.spdiags(weights, 0, n, n, format="csc")
            z = np.asarray(spsolve(wmat + penalty, weights * yy), dtype=float)
            weights = p * (yy > z) + (1.0 - p) * (yy <= z)
        return (yy - z).astype(float)
    except Exception:
        return _baseline_rubberband(np.arange(n, dtype=float), yy)


def _baseline_airpls(y: np.ndarray, *, lam: float, n_iter: int = 15) -> np.ndarray:
    """Adaptive iteratively reweighted penalized least-squares baseline."""

    yy = np.asarray(y, dtype=float)
    n = int(yy.size)
    if n < 5:
        return yy
    lam = float(max(1.0, min(1e9, lam)))
    try:
        from scipy import sparse  # type: ignore
        from scipy.sparse.linalg import spsolve  # type: ignore

        dmat = sparse.diags([1.0, -2.0, 1.0], [0, 1, 2], shape=(n - 2, n), format="csc")
        penalty = lam * (dmat.T @ dmat)
        weights = np.ones(n, dtype=float)
        z = yy.copy()
        for i in range(1, int(n_iter) + 1):
            wmat = sparse.spdiags(weights, 0, n, n, format="csc")
            z = np.asarray(spsolve(wmat + penalty, weights * yy), dtype=float)
            residual = yy - z
            negative = residual[residual < 0]
            if negative.size == 0 or abs(float(negative.sum())) < 1e-9:
                break
            scale = abs(float(negative.mean())) or 1.0
            weights[residual >= 0] = 0.0
            weights[residual < 0] = np.exp(min(50.0, i * np.abs(residual[residual < 0]) / scale))
            weights[0] = weights[-1] = np.max(weights)
        return (yy - z).astype(float)
    except Exception:
        return _baseline_asls(yy, lam=lam, p=0.01)


def _normalize_max(y: np.ndarray) -> np.ndarray:
    """Implement the `_normalize_max` behavior for this module.

    Text-only documentation note: modify internal logic here to change behavior.
    """
    yy = np.asarray(y, dtype=float)
    try:
        m = float(np.nanmax(np.abs(yy)))
        if not math.isfinite(m) or m <= 0.0:
            return yy
        return (yy / m).astype(float)
    except Exception:
        return yy


def _normalize_area(x: np.ndarray, y: np.ndarray) -> np.ndarray:
    """Implement the `_normalize_area` behavior for this module.

    Text-only documentation note: modify internal logic here to change behavior.
    """
    xx = np.asarray(x, dtype=float)
    yy = np.asarray(y, dtype=float)
    try:
        # Prefer `trapezoid` to match NumPy stubs (some type checkers don't expose `trapz`).
        area = float(np.trapezoid(np.abs(yy), xx))
        if not math.isfinite(area) or area <= 0.0:
            return yy
        return (yy / area).astype(float)
    except Exception:
        return yy


def _normalize_snv(y: np.ndarray) -> np.ndarray:
    yy = np.asarray(y, dtype=float)
    mean = float(np.nanmean(yy)) if yy.size else 0.0
    sd = float(np.nanstd(yy)) if yy.size else 0.0
    if not math.isfinite(sd) or sd <= 0.0:
        return yy
    return ((yy - mean) / sd).astype(float)


def _normalize_vector(y: np.ndarray) -> np.ndarray:
    yy = np.asarray(y, dtype=float)
    norm = float(np.sqrt(np.nansum(yy * yy)))
    if not math.isfinite(norm) or norm <= 0.0:
        return yy
    return (yy / norm).astype(float)


def _normalize_minmax(y: np.ndarray) -> np.ndarray:
    yy = np.asarray(y, dtype=float)
    lo = float(np.nanmin(yy)) if yy.size else 0.0
    hi = float(np.nanmax(yy)) if yy.size else 0.0
    span = hi - lo
    if not math.isfinite(span) or span <= 0.0:
        return yy
    return ((yy - lo) / span).astype(float)


def _normalize_msc(y: np.ndarray) -> np.ndarray:
    """Multiplicative Scatter Correction — single-spectrum variant.

    Uses the spectrum's own quadratic trend as a proxy reference, then
    removes additive and multiplicative scatter via linear regression.
    This is the standard approach when a batch mean spectrum is unavailable.
    """
    yy = np.asarray(y, dtype=float)
    n = int(yy.size)
    if n < 4:
        return yy
    x_idx = np.linspace(0.0, 1.0, n, dtype=float)
    try:
        coeffs = np.polyfit(x_idx, yy, deg=2)
        ref = np.polyval(coeffs, x_idx)
    except Exception:
        return yy
    A = np.column_stack([np.ones(n, dtype=float), ref])
    try:
        result = np.linalg.lstsq(A, yy, rcond=None)
        a, b = float(result[0][0]), float(result[0][1])
    except Exception:
        return yy
    if not (math.isfinite(a) and math.isfinite(b)) or abs(b) < 1e-12:
        return yy
    return ((yy - a) / b).astype(float)


def _atr_correct(x: np.ndarray, y: np.ndarray, *, n_crystal: float) -> np.ndarray:
    xx = np.asarray(x, dtype=float)
    yy = np.asarray(y, dtype=float)
    if xx.size == 0:
        return yy
    ref = float(np.nanmedian(xx))
    if not math.isfinite(ref) or ref <= 0.0:
        return yy
    n_scale = 1.5 / max(1.1, min(4.0, float(n_crystal or 1.5)))
    factor = np.clip((xx / ref) * n_scale, 0.2, 3.0)
    return (yy * factor).astype(float)


ATMOSPHERIC_MASK_REGIONS: Tuple[Tuple[float, float, str], ...] = (
    (2310.0, 2390.0, "CO2"),
    (1340.0, 1900.0, "H2O"),
    (3400.0, 4000.0, "H2O"),
)


def atmospheric_mask_regions() -> List[dict]:
    return [
        {"lo": lo, "hi": hi, "label": label}
        for lo, hi, label in ATMOSPHERIC_MASK_REGIONS
    ]


def mask_atmospheric_regions(x: np.ndarray, y: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
    xx = np.asarray(x, dtype=float)
    yy = np.asarray(y, dtype=float)
    keep = np.ones(xx.shape, dtype=bool)
    for lo, hi, _label in ATMOSPHERIC_MASK_REGIONS:
        keep &= ~((xx >= lo) & (xx <= hi))
    return xx[keep], yy[keep]


@dataclass(frozen=True)
class FTIRPeak:
    """A picked FTIR peak.

    Notes:
    - `y` is the original signal value at the picked `wn`.
    - `prominence` is always positive and refers to the prominence in the peak-
      picking direction (absorbance=maxima; transmittance=minima via `-y`).
    """

    wn: float
    y: float
    prominence: float
    left_base_wn: Optional[float] = None
    right_base_wn: Optional[float] = None
    width_cm1: Optional[float] = None


def format_peak_label(peak: FTIRPeak, *, fmt: str = "{wn:.1f}") -> str:
    """Format a label for a peak.

    `fmt` is a `str.format` template with fields: `wn`, `y`, `prominence`.

    Examples:
        format_peak_label(p) -> "1720.5"
        format_peak_label(p, fmt="{wn:.0f}") -> "1720"
        format_peak_label(p, fmt="{wn:.0f} ({prominence:.3g})")
    """

    try:
        return fmt.format(wn=float(peak.wn), y=float(peak.y), prominence=float(peak.prominence))
    except Exception:
        # Safe fallback
        try:
            return f"{float(peak.wn):.1f}"
        except Exception:
            return str(peak.wn)


def pick_peaks(
    wn: Sequence[float] | np.ndarray,
    y: Sequence[float] | np.ndarray,
    *,
    mode: str = "absorbance",
    min_prominence: float = 0.01,
    min_height: Optional[float] = None,
    min_distance_cm1: float = 8.0,
    top_n: int = 0,
) -> List[FTIRPeak]:
    """Pick peaks from an FTIR spectrum.

    Args:
        wn: X axis (wavenumber). Can be unsorted.
        y: Signal values.
        mode: "absorbance" (maxima) or "transmittance" (minima).
        min_prominence: Minimum prominence (in y units) in the peak-picking direction.
        min_height: Optional minimum height threshold in the peak-picking direction.
        min_distance_cm1: Minimum separation between returned peaks, in x units.
            This is enforced in *cm^-1*, not in sample indices.
        top_n: If > 0, keep only the top N peaks by prominence (after distance filtering).

    Returns:
        A list of `FTIRPeak`, sorted by increasing `wn`.

    Edge handling:
        - Empty input, all-NaN, or constant signals return an empty list.
        - Non-finite pairs are removed.
        - If `wn` is not strictly monotonic, points are sorted by `wn`.
    """

    x, y0 = _sanitize_xy(wn, y)
    if x.size < 3:
        return []

    mode_norm = (mode or "absorbance").strip().lower()
    if mode_norm not in ("absorbance", "transmittance"):
        mode_norm = "absorbance"

    # Peak-picking signal direction
    y_pick = y0 if mode_norm == "absorbance" else -y0

    # Quick exit for constant-ish signals
    try:
        if float(np.nanmax(y_pick) - np.nanmin(y_pick)) == 0.0:
            return []
    except Exception:
        return []

    candidates = _pick_candidates(x, y0, y_pick, min_prominence=min_prominence, min_height=min_height)
    if not candidates:
        return []

    # Enforce min distance in x-units (cm^-1) using prominence-first greedy selection.
    selected = _enforce_min_distance(candidates, min_distance_cm1=float(min_distance_cm1 or 0.0))

    # Keep top N by prominence if requested.
    if int(top_n or 0) > 0:
        selected = sorted(selected, key=lambda p: float(p.prominence), reverse=True)[: int(top_n)]

    # Present in ascending wavenumber order
    selected = sorted(selected, key=lambda p: float(p.wn))
    return selected


def pick_peaks_second_derivative(
    wn: Sequence[float] | np.ndarray,
    y: Sequence[float] | np.ndarray,
    *,
    mode: str = "absorbance",
    min_distance_cm1: float = 8.0,
    top_n: int = 0,
    smoothing_window: int = 9,
    poly_order: int = 3,
) -> List[FTIRPeak]:
    """Pick likely shoulders/bands from minima in the second derivative."""

    x, y0 = _sanitize_xy(wn, y)
    if x.size < 7:
        return []
    y_pick = -y0 if (mode or "absorbance").strip().lower() == "transmittance" else y0
    w = max(5, int(smoothing_window or 9))
    if (w % 2) == 0:
        w += 1
    if w > int(y_pick.size):
        w = int(y_pick.size) if int(y_pick.size) % 2 else int(y_pick.size) - 1
    smooth = _smooth(y_pick, window=max(3, w), poly_order=int(poly_order or 3))
    second = np.gradient(np.gradient(smooth, x), x)
    score = -np.asarray(second, dtype=float)
    prom = float(np.nanstd(score)) * 0.25
    if not math.isfinite(prom) or prom <= 0:
        return []
    derivative_peaks = pick_peaks(
        x,
        score,
        mode="absorbance",
        min_prominence=prom,
        min_height=None,
        min_distance_cm1=min_distance_cm1,
        top_n=top_n,
    )
    out: List[FTIRPeak] = []
    for peak in derivative_peaks:
        idx = int(np.nanargmin(np.abs(x - float(peak.wn))))
        prom_orig, lb_i, rb_i = _approx_prominence_with_bases(idx, y_pick)
        lb = float(x[lb_i]) if lb_i is not None else None
        rb = float(x[rb_i]) if rb_i is not None else None
        width = float(abs(rb - lb)) if lb is not None and rb is not None else None
        out.append(
            FTIRPeak(
                wn=float(x[idx]),
                y=float(y0[idx]),
                prominence=float(max(prom_orig, peak.prominence)),
                left_base_wn=lb,
                right_base_wn=rb,
                width_cm1=width,
            )
        )
    return sorted(out, key=lambda item: float(item.wn))


def _sanitize_xy(wn: Sequence[float] | np.ndarray, y: Sequence[float] | np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
    """Implement the `_sanitize_xy` behavior for this module.

    Text-only documentation note: modify internal logic here to change behavior.
    """
    x = np.asarray(wn, dtype=float)
    yv = np.asarray(y, dtype=float)
    if x.shape != yv.shape:
        # Attempt a minimal reshape/flatten match
        x = np.ravel(x)
        yv = np.ravel(yv)
        n = min(int(x.size), int(yv.size))
        x = x[:n]
        yv = yv[:n]

    mask = np.isfinite(x) & np.isfinite(yv)
    x = x[mask]
    yv = yv[mask]

    if x.size == 0:
        return x, yv

    # Sort by x to make distances meaningful
    try:
        order = np.argsort(x)
        x = x[order]
        yv = yv[order]
    except Exception:
        pass

    return x, yv


def _pick_candidates(
    x: np.ndarray,
    y_orig: np.ndarray,
    y_pick: np.ndarray,
    *,
    min_prominence: float,
    min_height: Optional[float],
) -> List[FTIRPeak]:
    # Prefer SciPy if available.
    """Implement the `_pick_candidates` behavior for this module.

    Text-only documentation note: modify internal logic here to change behavior.
    """
    peaks = _pick_candidates_scipy(x, y_orig, y_pick, min_prominence=min_prominence, min_height=min_height)
    if peaks is not None:
        return peaks

    return _pick_candidates_fallback(x, y_orig, y_pick, min_prominence=min_prominence, min_height=min_height)


def _pick_candidates_scipy(
    x: np.ndarray,
    y_orig: np.ndarray,
    y_pick: np.ndarray,
    *,
    min_prominence: float,
    min_height: Optional[float],
) -> Optional[List[FTIRPeak]]:
    """Implement the `_pick_candidates_scipy` behavior for this module.

    Text-only documentation note: modify internal logic here to change behavior.
    """
    try:
        from scipy.signal import find_peaks  # type: ignore
    except Exception:
        return None

    kwargs = {}
    if min_prominence is not None:
        kwargs["prominence"] = float(min_prominence)
    if min_height is not None:
        kwargs["height"] = float(min_height)

    try:
        idx, props = find_peaks(y_pick, **kwargs)
    except Exception:
        return []

    if idx is None or len(idx) == 0:
        return []

    prominences = props.get("prominences")
    left_bases = props.get("left_bases")
    right_bases = props.get("right_bases")

    out: List[FTIRPeak] = []
    for j, i in enumerate(idx):
        try:
            ii = int(i)
            wn0 = float(x[ii])
            y0 = float(y_orig[ii])

            prom = None
            try:
                if prominences is not None:
                    prom = float(prominences[j])
            except Exception:
                prom = None
            if prom is None:
                # Approximate
                prom = float(max(0.0, _approx_prominence(ii, y_pick)))

            if prom < float(min_prominence or 0.0):
                continue

            lb = None
            rb = None
            width = None
            try:
                if left_bases is not None:
                    lb = float(x[int(left_bases[j])])
                if right_bases is not None:
                    rb = float(x[int(right_bases[j])])
                if lb is not None and rb is not None and math.isfinite(lb) and math.isfinite(rb):
                    width = float(abs(rb - lb))
            except Exception:
                lb = rb = width = None

            out.append(FTIRPeak(wn=wn0, y=y0, prominence=float(prom), left_base_wn=lb, right_base_wn=rb, width_cm1=width))
        except Exception:
            continue

    return out


def _pick_candidates_fallback(
    x: np.ndarray,
    y_orig: np.ndarray,
    y_pick: np.ndarray,
    *,
    min_prominence: float,
    min_height: Optional[float],
) -> List[FTIRPeak]:
    """Implement the `_pick_candidates_fallback` behavior for this module.

    Text-only documentation note: modify internal logic here to change behavior.
    """
    out: List[FTIRPeak] = []

    n = int(x.size)
    if n < 3:
        return out

    h = None if min_height is None else float(min_height)
    mp = float(min_prominence or 0.0)

    # Simple local maxima in y_pick
    for i in range(1, n - 1):
        yp = float(y_pick[i])
        if not (yp > float(y_pick[i - 1]) and yp >= float(y_pick[i + 1])):
            continue
        if h is not None and yp < h:
            continue

        prom, lb_i, rb_i = _approx_prominence_with_bases(i, y_pick)
        if prom < mp:
            continue

        lb = float(x[lb_i]) if lb_i is not None else None
        rb = float(x[rb_i]) if rb_i is not None else None
        width = None
        try:
            if lb is not None and rb is not None:
                width = float(abs(rb - lb))
        except Exception:
            width = None

        out.append(
            FTIRPeak(
                wn=float(x[i]),
                y=float(y_orig[i]),
                prominence=float(prom),
                left_base_wn=lb,
                right_base_wn=rb,
                width_cm1=width,
            )
        )

    return out


def _approx_prominence(i: int, y: np.ndarray) -> float:
    """Implement the `_approx_prominence` behavior for this module.

    Text-only documentation note: modify internal logic here to change behavior.
    """
    prom, _, _ = _approx_prominence_with_bases(i, y)
    return float(prom)


def _approx_prominence_with_bases(i: int, y: np.ndarray) -> Tuple[float, Optional[int], Optional[int]]:
    """Approximate prominence using a simple valley search.

    This is not identical to SciPy's prominence, but is monotonic and works
    reasonably for FTIR spectra.
    """

    n = int(y.size)
    if i <= 0 or i >= n - 1:
        return 0.0, None, None

    peak = float(y[i])

    # Search left until the signal rises above the peak; track minimum.
    left_min = peak
    left_base = i
    j = i
    while j > 0:
        j -= 1
        v = float(y[j])
        if v < left_min:
            left_min = v
            left_base = j
        if v > peak:
            break

    # Search right similarly.
    right_min = peak
    right_base = i
    k = i
    while k < n - 1:
        k += 1
        v = float(y[k])
        if v < right_min:
            right_min = v
            right_base = k
        if v > peak:
            break

    baseline = max(left_min, right_min)
    prom = max(0.0, peak - baseline)
    return float(prom), int(left_base), int(right_base)


def _enforce_min_distance(peaks: List[FTIRPeak], min_distance_cm1: float) -> List[FTIRPeak]:
    """Implement the `_enforce_min_distance` behavior for this module.

    Text-only documentation note: modify internal logic here to change behavior.
    """
    md = float(min_distance_cm1 or 0.0)
    if md <= 0.0 or len(peaks) <= 1:
        return list(peaks)

    # Greedy selection: highest prominence first, then reject too-close peaks.
    ordered = sorted(peaks, key=lambda p: float(p.prominence), reverse=True)
    chosen: List[FTIRPeak] = []

    for p in ordered:
        wn0 = float(p.wn)
        ok = True
        for q in chosen:
            if abs(wn0 - float(q.wn)) < md:
                ok = False
                break
        if ok:
            chosen.append(p)

    return chosen


# -------------------- manual self-checks --------------------


def _self_check_empty() -> None:
    """Implement the `_self_check_empty` behavior for this module.

    Text-only documentation note: modify internal logic here to change behavior.
    """
    assert pick_peaks([], []) == []
    assert pick_peaks([1.0, 2.0], [0.0, 1.0]) == []


def _self_check_simple_absorbance() -> None:
    """Implement the `_self_check_simple_absorbance` behavior for this module.

    Text-only documentation note: modify internal logic here to change behavior.
    """
    x = np.linspace(1000, 2000, 2001)
    y = np.exp(-0.5 * ((x - 1500) / 10.0) ** 2) + 0.02 * np.exp(-0.5 * ((x - 1700) / 20.0) ** 2)
    peaks = pick_peaks(x, y, mode="absorbance", min_prominence=0.01, min_distance_cm1=20.0)
    assert len(peaks) >= 1
    # Strongest should be near 1500
    p0 = sorted(peaks, key=lambda p: p.prominence, reverse=True)[0]
    assert abs(p0.wn - 1500) < 2.0


def _self_check_transmittance_minima() -> None:
    """Implement the `_self_check_transmittance_minima` behavior for this module.

    Text-only documentation note: modify internal logic here to change behavior.
    """
    x = np.linspace(1000, 2000, 2001)
    # transmittance dips
    y = 1.0 - 0.3 * np.exp(-0.5 * ((x - 1600) / 12.0) ** 2)
    peaks = pick_peaks(x, y, mode="transmittance", min_prominence=0.05, min_distance_cm1=10.0)
    assert len(peaks) >= 1
    p0 = peaks[0]
    assert abs(p0.wn - 1600) < 2.0
    # y should be the original (dip), not inverted
    assert p0.y < 1.0


def _self_check_nan_handling() -> None:
    """Implement the `_self_check_nan_handling` behavior for this module.

    Text-only documentation note: modify internal logic here to change behavior.
    """
    x = np.array([1000, 1001, np.nan, 1003, 1004, 1005], dtype=float)
    y = np.array([0.0, 1.0, 2.0, np.nan, 1.0, 0.0], dtype=float)
    peaks = pick_peaks(x, y, min_prominence=0.1)
    assert isinstance(peaks, list)


def run_self_checks(*, verbose: bool = True) -> None:
    """Run lightweight self-checks (manual, no pytest needed)."""

    checks = [
        _self_check_empty,
        _self_check_simple_absorbance,
        _self_check_transmittance_minima,
        _self_check_nan_handling,
    ]

    for fn in checks:
        fn()
        if verbose:
            print(f"ok: {fn.__name__}")

    if verbose:
        print("All FTIR self-checks passed")


if __name__ == "__main__":
    run_self_checks(verbose=True)
