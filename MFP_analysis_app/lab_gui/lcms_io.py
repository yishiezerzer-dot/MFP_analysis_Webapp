from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd
from pyteomics import mzml

from .lcms_model import SpectrumMeta, _extract_ms_level, _extract_polarity, _extract_rt_minutes, _spectrum_id


def _get_index_cache_dir() -> Path:
    """Resolve directory for cached LCMS TIC indexes."""
    env_dir = os.environ.get("MFP_DATA_DIR")
    if env_dir:
        p = Path(env_dir) / "cache" / "lcms_index"
    else:
        candidate = Path(__file__).resolve().parents[2] / ".data" / "cache" / "lcms_index"
        if candidate.parent.parent.is_dir():
            p = candidate
        else:
            p = Path.home() / ".mfp_analysis" / "cache" / "lcms_index"
    p.mkdir(parents=True, exist_ok=True)
    return p


class LCMSLoadError(Exception):
    pass


class UVLoadError(Exception):
    pass


class MzMLTICIndex:
    """Minimal MS1 index used by the GUI and Web app.

    Builds a list of MS1 spectra metadata (RT, TIC, polarity).
    Uses fast header-only parsing (decode_binary=False) and persistent disk caching.

    UI-free: does not import tkinter and does not show dialogs.
    """

    def __init__(self, mzml_path: Path, *, rt_unit: str = "minutes", use_cache: bool = True) -> None:
        self.path = Path(mzml_path).expanduser().resolve()
        self.rt_unit = str(rt_unit)
        self.use_cache = bool(use_cache)
        self.ms1: List[SpectrumMeta] = []
        self.stats: Dict[str, Any] = {}

    def _cache_path(self) -> Optional[Path]:
        try:
            if not self.path.exists():
                return None
            stat = self.path.stat()
            key_raw = f"{self.path.resolve()}:{stat.st_size}:{stat.st_mtime}:{self.rt_unit}:v2"
            cache_name = hashlib.sha256(key_raw.encode("utf-8")).hexdigest() + ".json"
            return _get_index_cache_dir() / cache_name
        except Exception:
            return None

    def _load_from_cache(self) -> bool:
        if not self.use_cache:
            return False
        cache_file = self._cache_path()
        if not cache_file or not cache_file.is_file():
            return False
        try:
            payload = json.loads(cache_file.read_text(encoding="utf-8"))
            ms1_data = payload.get("ms1", [])
            stats = payload.get("stats", {})
            self.ms1 = [
                SpectrumMeta(
                    spectrum_id=str(item["spectrum_id"]),
                    rt_min=float(item["rt_min"]),
                    tic=float(item["tic"]),
                    polarity=item.get("polarity"),
                    ms_level=int(item.get("ms_level", 1)),
                )
                for item in ms1_data
            ]
            self.stats = stats
            self.stats["cached"] = True
            return True
        except Exception:
            return False

    def _save_to_cache(self) -> None:
        if not self.use_cache:
            return
        cache_file = self._cache_path()
        if not cache_file:
            return
        try:
            payload = {
                "ms1": [
                    {
                        "spectrum_id": m.spectrum_id,
                        "rt_min": m.rt_min,
                        "tic": m.tic,
                        "polarity": m.polarity,
                        "ms_level": m.ms_level,
                    }
                    for m in self.ms1
                ],
                "stats": self.stats,
            }
            tmp_file = cache_file.with_suffix(".tmp")
            tmp_file.write_text(json.dumps(payload), encoding="utf-8")
            tmp_file.replace(cache_file)
        except Exception:
            pass

    def build(self) -> None:
        """Build MS1 index, using fast disk cache if available."""
        if self._load_from_cache():
            return

        ms1: List[SpectrumMeta] = []
        stats: Dict[str, Any] = {
            "total_spectra": 0,
            "ms1_kept": 0,
            "skipped_non_ms1": 0,
            "skipped_no_rt": 0,
            "skipped_no_intensity": 0,
            "skipped_error": 0,
            "fatal_error": None,
            "cached": False,
        }

        # Attempt 1: Fast header-only reading without full binary array decoding
        fast_success = False
        try:
            with mzml.MzML(str(self.path), decode_binary=False) as reader:
                for spectrum in reader:
                    stats["total_spectra"] += 1
                    try:
                        ms_level = _extract_ms_level(spectrum)
                        if ms_level != 1:
                            stats["skipped_non_ms1"] += 1
                            continue

                        rt_min = _extract_rt_minutes(spectrum, rt_unit=self.rt_unit)
                        if rt_min is None:
                            stats["skipped_no_rt"] += 1
                            continue

                        pol = _extract_polarity(spectrum)
                        tic_val = spectrum.get("total ion current")
                        if tic_val is not None:
                            try:
                                tic = float(tic_val)
                            except Exception:
                                tic = 0.0
                        else:
                            inten = spectrum.get("intensity array")
                            if inten is not None:
                                try:
                                    arr = inten.decode() if hasattr(inten, "decode") else np.asarray(inten, dtype=float)
                                    tic = float(np.sum(arr))
                                except Exception:
                                    tic = 0.0
                            else:
                                stats["skipped_no_intensity"] += 1
                                continue

                        ms1.append(
                            SpectrumMeta(
                                spectrum_id=_spectrum_id(spectrum),
                                rt_min=float(rt_min),
                                tic=float(tic),
                                polarity=pol,
                                ms_level=1,
                            )
                        )
                        stats["ms1_kept"] += 1
                    except Exception as exc:
                        stats["skipped_error"] += 1
                        if stats.get("fatal_error") is None:
                            stats["fatal_error"] = f"Error while parsing spectrum: {exc!r}"
                        continue
                fast_success = True
        except Exception:
            fast_success = False

        # Attempt 2: Fallback to full binary decoding if fast header parsing failed
        if not fast_success or (len(ms1) == 0 and stats["total_spectra"] > 0):
            ms1 = []
            stats = {
                "total_spectra": 0,
                "ms1_kept": 0,
                "skipped_non_ms1": 0,
                "skipped_no_rt": 0,
                "skipped_no_intensity": 0,
                "skipped_error": 0,
                "fatal_error": None,
                "cached": False,
            }
            try:
                with mzml.MzML(str(self.path)) as reader:
                    for spectrum in reader:
                        stats["total_spectra"] += 1
                        try:
                            ms_level = _extract_ms_level(spectrum)
                            if ms_level != 1:
                                stats["skipped_non_ms1"] += 1
                                continue

                            rt_min = _extract_rt_minutes(spectrum, rt_unit=self.rt_unit)
                            if rt_min is None:
                                stats["skipped_no_rt"] += 1
                                continue

                            inten = spectrum.get("intensity array")
                            if inten is None:
                                stats["skipped_no_intensity"] += 1
                                continue

                            pol = _extract_polarity(spectrum)
                            try:
                                tic = float(np.sum(np.asarray(inten, dtype=float)))
                            except Exception:
                                tic = 0.0

                            ms1.append(
                                SpectrumMeta(
                                    spectrum_id=_spectrum_id(spectrum),
                                    rt_min=float(rt_min),
                                    tic=float(tic),
                                    polarity=pol,
                                    ms_level=1,
                                )
                            )
                            stats["ms1_kept"] += 1
                        except Exception as exc:
                            stats["skipped_error"] += 1
                            if stats.get("fatal_error") is None:
                                stats["fatal_error"] = f"Error while parsing spectrum: {exc!r}"
                            continue
            except Exception as exc:
                stats["fatal_error"] = f"mzML read failed: {exc!r}"

        ms1.sort(key=lambda m: float(m.rt_min))
        self.ms1 = ms1
        self.stats = stats
        if ms1:
            self._save_to_cache()


def preview_dataframe_rows(df: pd.DataFrame, *, n: int = 10) -> List[Tuple[Any, ...]]:
    """Implement the `preview_dataframe_rows` behavior for this module.

    Text-only documentation note: modify internal logic here to change behavior.
    """
    out: List[Tuple[Any, ...]] = []
    try:
        for i in range(min(int(n), int(df.shape[0]))):
            out.append(tuple(df.iloc[i].tolist()))
    except Exception:
        return []
    return out


def infer_uv_columns(df: pd.DataFrame) -> Dict[str, Any]:
    """Infer UV time/signal columns from headers.

    Returns dict: cols, xcol, ycol, unit_guess, low_conf, reason, x_scores, y_scores.
    """
    if int(df.shape[1]) < 2:
        raise UVLoadError("CSV must have at least 2 columns (time, signal).")

    cols = [str(c) for c in df.columns]

    def score_x(name: str) -> int:
        """Implement the `score_x` behavior for this module.

        Text-only documentation note: modify internal logic here to change behavior.
        """
        n = name.lower()
        score = 0
        for k in ["rt", "retention", "time", "minute", "min", "second", "sec"]:
            if k in n:
                score += 1
        return score

    def score_y(name: str) -> int:
        """Implement the `score_y` behavior for this module.

        Text-only documentation note: modify internal logic here to change behavior.
        """
        n = name.lower()
        score = 0
        for k in ["uv", "abs", "absorb", "au", "signal", "intensity", "counts"]:
            if k in n:
                score += 1
        return score

    def _is_numeric_name(name: str) -> bool:
        try:
            float(name)
            return True
        except (ValueError, TypeError):
            return False

    x_scores = {c: score_x(c) for c in cols}
    x_best = max(cols, key=lambda c: x_scores.get(c, 0))
    y_candidates = [c for c in cols if c != x_best]
    y_scores = {c: score_y(c) for c in y_candidates}
    y_best = max(y_candidates, key=lambda c: y_scores.get(c, 0)) if y_candidates else x_best

    # Confidence heuristic: require a positive score and a clear winner.
    x_sorted = sorted((v, k) for k, v in x_scores.items())
    y_sorted = sorted((v, k) for k, v in y_scores.items())
    x_top = x_sorted[-1][0] if x_sorted else 0
    x_2nd = x_sorted[-2][0] if len(x_sorted) >= 2 else -1
    y_top = y_sorted[-1][0] if y_sorted else 0
    y_2nd = y_sorted[-2][0] if len(y_sorted) >= 2 else -1
    low_conf = (x_top <= 0) or (y_top <= 0) or (x_top == x_2nd and x_top > 0) or (y_top == y_2nd and y_top > 0)

    # Positional fallback: if all column names are numeric (no header row) or
    # scores are all zero, assume col[0]=time, col[1]=signal and treat as confident.
    if low_conf and all(_is_numeric_name(c) for c in cols):
        x_best = cols[0]
        y_best = cols[1] if len(cols) > 1 else cols[0]
        low_conf = False

    unit_guess = "minutes"
    xname = str(x_best).lower()
    if ("sec" in xname) or ("second" in xname):
        unit_guess = "seconds"
    elif ("min" in xname) or ("minute" in xname):
        unit_guess = "minutes"
    elif _is_numeric_name(x_best):
        # Infer from data range: if max x value > 60, likely seconds
        try:
            x_vals = pd.to_numeric(df[x_best], errors="coerce").dropna()
            if len(x_vals) > 0 and float(x_vals.max()) > 60:
                unit_guess = "seconds"
        except Exception:
            pass

    reason = ""
    if low_conf:
        reason = f"Heuristic scores were ambiguous (x best={x_best} score={x_scores.get(x_best, 0)}, y best={y_best} score={y_scores.get(y_best, 0)})."

    return {
        "cols": cols,
        "xcol": str(x_best),
        "ycol": str(y_best),
        "unit_guess": str(unit_guess),
        "low_conf": bool(low_conf),
        "reason": str(reason),
        "x_scores": dict(x_scores),
        "y_scores": dict(y_scores),
    }


def parse_uv_arrays(df: pd.DataFrame, *, xcol: str, ycol: str, unit_guess: str) -> Tuple[np.ndarray, np.ndarray, Tuple[float, float], List[str]]:
    """Convert UV DataFrame columns into sorted, de-duplicated arrays.

    Returns: (rt_min, signal, rt_range, import_warnings)
    """
    import_warnings: List[str] = []

    try:
        x = pd.to_numeric(df[str(xcol)], errors="coerce").to_numpy(dtype=float)
        y = pd.to_numeric(df[str(ycol)], errors="coerce").to_numpy(dtype=float)
    except Exception as exc:
        raise UVLoadError(f"Failed to parse columns '{xcol}'/'{ycol}': {exc}")

    mask = np.isfinite(x) & np.isfinite(y)
    x = x[mask]
    y = y[mask]
    if int(x.size) == 0:
        raise UVLoadError("No numeric data found in the selected CSV columns.")

    # Always store minutes.
    if str(unit_guess).lower().startswith("sec"):
        x = x / 60.0
    else:
        try:
            if float(np.nanmax(x)) > 500.0:
                import_warnings.append("Time values look large; if this CSV is in seconds, choose 'seconds' in UV import settings.")
        except Exception:
            pass

    order = np.argsort(x)
    x = x[order]
    y = y[order]

    # Handle duplicate RTs (average signal)
    try:
        if x.size > 1:
            ux, inv = np.unique(x, return_inverse=True)
            if ux.size != x.size:
                sumy = np.bincount(inv, weights=y)
                cnt = np.bincount(inv)
                y = sumy / np.maximum(1.0, cnt)
                x = ux
                import_warnings.append("Duplicate RT values detected; averaged signal for identical RTs.")
    except Exception:
        pass

    rt_min = np.asarray(x, dtype=float)
    signal = np.asarray(y, dtype=float)

    try:
        rt_range = (float(np.min(rt_min)), float(np.max(rt_min)))
    except Exception:
        rt_range = (float("nan"), float("nan"))

    return rt_min, signal, rt_range, import_warnings
