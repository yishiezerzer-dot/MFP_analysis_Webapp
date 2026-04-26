"""LCMS service: wraps the existing `lab_gui.lcms_io` / `lcms_model` modules.

Keeps session state (one per uploaded mzML) in an in-process registry so
subsequent requests can fetch spectra without re-parsing the whole file.
"""
from __future__ import annotations

import threading
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd
from pyteomics import mzml

from lab_gui.lcms_io import (
    MzMLTICIndex,
    LCMSLoadError,
    UVLoadError,
    infer_uv_columns,
    parse_uv_arrays,
)


@dataclass
class UVSessionState:
    """UV/DAD chromatogram attached to an LCMS session (imported from CSV).

    Arrays are stored in minutes (RT) and the detector's native signal units
    (typically absorbance / AU). ``warnings`` collects any notes surfaced by
    the CSV importer — e.g. duplicate RTs averaged, unit guess ambiguous.
    """

    filename: str
    path: Path
    rt_min: np.ndarray
    signal: np.ndarray
    x_col: str
    y_col: str
    unit_guess: str
    rt_range: Tuple[float, float]
    warnings: List[str] = field(default_factory=list)


@dataclass
class LCMSSessionState:
    session_id: str
    display_name: str
    path: Path
    index: MzMLTICIndex
    _reader_lock: threading.Lock
    uv: Optional[UVSessionState] = None

    def ms1_meta(self) -> List[Dict[str, Any]]:
        return [
            {
                "spectrum_id": m.spectrum_id,
                "rt_min": float(m.rt_min),
                "tic": float(m.tic),
                "polarity": m.polarity,
            }
            for m in self.index.ms1
        ]


class LCMSRegistry:
    """Process-local registry of loaded mzML sessions.

    Simple in-memory store — fine for a single-user local dev server; would be
    swapped for Redis / disk in a multi-user deployment.
    """

    def __init__(self) -> None:
        self._sessions: Dict[str, LCMSSessionState] = {}
        self._lock = threading.Lock()

    def add_from_path(self, path: Path, *, display_name: Optional[str] = None, rt_unit: str = "minutes") -> LCMSSessionState:
        idx = MzMLTICIndex(path, rt_unit=rt_unit)
        idx.build()
        fatal = idx.stats.get("fatal_error")
        if fatal and not idx.ms1:
            raise LCMSLoadError(str(fatal))
        session_id = uuid.uuid4().hex
        state = LCMSSessionState(
            session_id=session_id,
            display_name=display_name or path.name,
            path=path,
            index=idx,
            _reader_lock=threading.Lock(),
        )
        with self._lock:
            self._sessions[session_id] = state
        return state

    def get(self, session_id: str) -> Optional[LCMSSessionState]:
        with self._lock:
            return self._sessions.get(session_id)

    def remove(self, session_id: str) -> bool:
        with self._lock:
            return self._sessions.pop(session_id, None) is not None

    def list(self) -> List[LCMSSessionState]:
        with self._lock:
            return list(self._sessions.values())


registry = LCMSRegistry()


def fetch_spectrum_at_rt(
    state: LCMSSessionState,
    target_rt_min: float,
    *,
    polarity: Optional[str] = None,
) -> Tuple[Dict[str, Any], np.ndarray, np.ndarray]:
    """Return (meta, mz_array, intensity_array) for the MS1 scan nearest to
    ``target_rt_min``. Optionally constrained by polarity ('positive'/'negative').
    """
    metas = state.index.ms1
    if not metas:
        raise LCMSLoadError("No MS1 spectra indexed.")

    if polarity in ("positive", "negative"):
        candidates = [m for m in metas if m.polarity == polarity]
        if not candidates:
            candidates = metas
    else:
        candidates = metas

    rts = np.asarray([float(m.rt_min) for m in candidates], dtype=float)
    i = int(np.argmin(np.abs(rts - float(target_rt_min))))
    chosen = candidates[i]

    with state._reader_lock:
        rdr = mzml.MzML(str(state.path))
        try:
            spectrum = rdr.get_by_id(str(chosen.spectrum_id))
        except Exception:
            spectrum = rdr[str(chosen.spectrum_id)]

    mz_array = spectrum.get("m/z array")
    int_array = spectrum.get("intensity array")
    if mz_array is None or int_array is None:
        raise LCMSLoadError("Spectrum has no m/z or intensity arrays.")
    mz_vals = np.asarray(mz_array, dtype=float)
    int_vals = np.asarray(int_array, dtype=float)

    meta = {
        "spectrum_id": chosen.spectrum_id,
        "rt_min": float(chosen.rt_min),
        "tic": float(chosen.tic),
        "polarity": chosen.polarity,
        "n_peaks": int(mz_vals.size),
    }
    return meta, mz_vals, int_vals


def _read_uv_csv(path: Path) -> pd.DataFrame:
    """Load a UV chromatogram CSV with a tolerant parser.

    Tries a few common separators (``,``, ``;``, ``\\t``) and falls back to
    Python's sniffer so files exported by different chromatography stacks
    (Shimadzu, Agilent, Waters) load without extra configuration.
    """
    errors: List[str] = []
    for sep in (",", ";", "\t"):
        try:
            df = pd.read_csv(path, sep=sep, engine="python", comment="#")
            if df.shape[1] >= 2:
                return df
        except Exception as exc:
            errors.append(f"sep={sep!r}: {exc}")
    # Last-ditch: let pandas sniff
    try:
        return pd.read_csv(path, sep=None, engine="python", comment="#")
    except Exception as exc:
        raise UVLoadError(
            "Failed to parse UV CSV; "
            + "; ".join(errors + [f"auto: {exc}"])
        )


def attach_uv_from_csv(state: LCMSSessionState, csv_path: Path, *, filename: str) -> UVSessionState:
    """Parse a UV/DAD CSV and attach it to the given LCMS session."""
    df = _read_uv_csv(csv_path)
    info = infer_uv_columns(df)
    rt_min, signal, rt_range, warnings = parse_uv_arrays(
        df,
        xcol=info["xcol"],
        ycol=info["ycol"],
        unit_guess=info["unit_guess"],
    )
    if info.get("low_conf"):
        reason = info.get("reason") or "Column detection was ambiguous."
        warnings = [f"{reason} (using x={info['xcol']}, y={info['ycol']})", *warnings]

    uv = UVSessionState(
        filename=filename,
        path=csv_path,
        rt_min=np.asarray(rt_min, dtype=float),
        signal=np.asarray(signal, dtype=float),
        x_col=str(info["xcol"]),
        y_col=str(info["ycol"]),
        unit_guess=str(info["unit_guess"]),
        rt_range=(float(rt_range[0]), float(rt_range[1])),
        warnings=list(warnings),
    )
    state.uv = uv
    return uv


def clear_uv(state: LCMSSessionState) -> bool:
    had = state.uv is not None
    state.uv = None
    return had


def detect_uv_peaks(
    rt_min: np.ndarray,
    signal: np.ndarray,
    *,
    top_n: int = 8,
    min_rel: float = 0.05,
    min_distance_points: int = 3,
    min_distance_min: Optional[float] = None,
) -> List[Dict[str, float]]:
    """Detect the most prominent UV peaks (numpy-only local-maxima).

    Returns a list of ``{rt_min, signal}`` sorted by descending signal. A
    peak is an interior index ``i`` whose signal is strictly greater than
    its immediate neighbours and at least ``min_rel * max(signal)``; we then
    greedily pick the top-N while enforcing ``min_distance_points`` between
    picks so we don't label every sample on a broad peak.
    """
    if rt_min.size < 3 or signal.size < 3:
        return []
    s = np.asarray(signal, dtype=float)
    rt = np.asarray(rt_min, dtype=float)
    smax = float(np.nanmax(s)) if s.size else 0.0
    if not np.isfinite(smax) or smax <= 0.0:
        return []
    threshold = float(min_rel) * smax

    left = s[1:-1] > s[:-2]
    right = s[1:-1] > s[2:]
    is_peak = left & right & (s[1:-1] >= threshold)
    cand = np.where(is_peak)[0] + 1  # shift back to original indexing
    if cand.size == 0:
        return []

    if min_distance_min is not None and rt.size >= 2:
        try:
            avg_step = float(np.median(np.diff(rt)))
            if avg_step > 0:
                converted = int(round(float(min_distance_min) / avg_step))
                min_distance_points = max(min_distance_points, max(1, converted))
        except Exception:
            pass

    order = cand[np.argsort(-s[cand])]
    picked: List[int] = []
    for idx in order:
        if all(abs(int(idx) - int(p)) >= int(min_distance_points) for p in picked):
            picked.append(int(idx))
        if len(picked) >= int(top_n):
            break
    picked.sort()
    return [
        {"rt_min": float(rt[i]), "signal": float(s[i])}
        for i in picked
    ]


def top_n_peaks(
    mz: np.ndarray,
    intensity: np.ndarray,
    *,
    n: int = 10,
    min_rel: float = 0.0,
) -> List[Dict[str, float]]:
    """Return the top-N peaks by intensity (above ``min_rel`` * max)."""
    if mz.size == 0:
        return []
    imax = float(np.max(intensity)) if intensity.size else 0.0
    if imax <= 0.0:
        return []
    thresh = float(min_rel) * imax
    mask = intensity >= thresh
    if not np.any(mask):
        return []
    sel_mz = mz[mask]
    sel_int = intensity[mask]
    order = np.argsort(sel_int)[::-1][: max(0, int(n))]
    return [
        {"mz": float(sel_mz[i]), "intensity": float(sel_int[i])}
        for i in order
    ]
