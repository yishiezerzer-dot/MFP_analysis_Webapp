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

from lab_gui.ftir_analysis import FTIRPeak, pick_peaks, preprocess_spectrum
from lab_gui.ftir_assignment import assign_ftir_peaks
from lab_gui.ftir_io import FTIRLoadError, _parse_ftir_xy_numpy
from lab_gui.ftir_library import FTIR_LIBRARY_V2, FTIR_LIBRARY_VERSION


@dataclass
class FTIRSession:
    session_id: str
    display_name: str
    path: Path
    x: np.ndarray
    y: np.ndarray
    meta: Dict[str, str] = field(default_factory=dict)
    y_mode: str = "absorbance"


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
) -> Tuple[np.ndarray, np.ndarray]:
    x, y_proc = preprocess_spectrum(
        s.x,
        s.y,
        mode=mode,
        smoothing_window=int(smoothing_window or 0),
        poly_order=int(poly_order or 0),
        baseline=str(baseline or "none"),
        normalize=str(normalize or "none"),
    )
    return x, y_proc


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
    return assign_ftir_peaks(
        normalized,
        FTIR_LIBRARY_V2,
        top_n=int(top_n or 3),
        min_score=float(min_score),
    )


def library_meta() -> Dict[str, Any]:
    return {
        "version": FTIR_LIBRARY_VERSION,
        "n_entries": len(FTIR_LIBRARY_V2),
    }
