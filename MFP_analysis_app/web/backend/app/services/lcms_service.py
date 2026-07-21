"""LCMS service: wraps the existing `lab_gui.lcms_io` / `lcms_model` modules.

Keeps session state (one per uploaded mzML) in an in-process registry so
subsequent requests can fetch spectra without re-parsing the whole file.
"""
from __future__ import annotations

import threading
import tempfile
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

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
import lab_gui.lcms_polymer_match as poly_match


def _friendly_label(col_name: str, role: str) -> str:
    """Return a human-readable axis label when the column name is a raw number."""
    try:
        float(col_name)
        return "RT (min)" if role == "x" else "Signal"
    except (ValueError, TypeError):
        return col_name


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
    x_label: str
    y_label: str
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
        return self._store(session_id, display_name or path.name, path, idx)

    def restore_from_path(
        self,
        session_id: str,
        path: Path,
        *,
        display_name: Optional[str] = None,
        rt_unit: str = "minutes",
    ) -> LCMSSessionState:
        idx = MzMLTICIndex(path, rt_unit=rt_unit)
        idx.build()
        fatal = idx.stats.get("fatal_error")
        if fatal and not idx.ms1:
            raise LCMSLoadError(str(fatal))
        return self._store(session_id, display_name or path.name, path, idx)

    def _store(
        self,
        session_id: str,
        display_name: str,
        path: Path,
        idx: MzMLTICIndex,
    ) -> LCMSSessionState:
        state = LCMSSessionState(
            session_id=session_id,
            display_name=display_name,
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


async def get_or_restore(session_id: str) -> Optional[LCMSSessionState]:
    existing = registry.get(session_id)
    if existing is not None:
        return existing

    from ..blob_store import download_bytes, get_json, manifest_key

    manifest = await get_json(manifest_key("lcms", session_id))
    if manifest is None:
        return None

    data = await download_bytes(str(manifest["blob_url"]))
    tmp_dir = Path(tempfile.mkdtemp(prefix="mfp_lcms_restore_"))
    filename = str(manifest.get("filename") or "upload.mzML")
    dest = tmp_dir / filename
    dest.write_bytes(data)
    try:
        return registry.restore_from_path(
            session_id,
            dest,
            display_name=str(manifest.get("display_name") or filename),
            rt_unit=str(manifest.get("rt_unit") or "minutes"),
        )
    except LCMSLoadError:
        return None


def _ms1_candidates(
    state: LCMSSessionState,
    *,
    polarity: Optional[str] = None,
) -> List[Any]:
    metas = state.index.ms1
    if polarity in ("positive", "negative"):
        filtered = [m for m in metas if m.polarity == polarity]
        return filtered or metas
    return metas


def _spectrum_arrays_from_reader(reader: mzml.MzML, spectrum_id: str) -> Tuple[np.ndarray, np.ndarray]:
    try:
        spectrum = reader.get_by_id(str(spectrum_id))
    except Exception:
        spectrum = reader[str(spectrum_id)]
    mz_array = spectrum.get("m/z array")
    int_array = spectrum.get("intensity array")
    if mz_array is None or int_array is None:
        raise LCMSLoadError("Spectrum has no m/z or intensity arrays.")
    return np.asarray(mz_array, dtype=float), np.asarray(int_array, dtype=float)


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

    candidates = _ms1_candidates(state, polarity=polarity)

    rts = np.asarray([float(m.rt_min) for m in candidates], dtype=float)
    i = int(np.argmin(np.abs(rts - float(target_rt_min))))
    chosen = candidates[i]

    with state._reader_lock:
        rdr = mzml.MzML(str(state.path))
        try:
            mz_vals, int_vals = _spectrum_arrays_from_reader(rdr, str(chosen.spectrum_id))
        finally:
            close = getattr(rdr, "close", None)
            if callable(close):
                close()

    meta = {
        "spectrum_id": chosen.spectrum_id,
        "rt_min": float(chosen.rt_min),
        "tic": float(chosen.tic),
        "polarity": chosen.polarity,
        "n_peaks": int(mz_vals.size),
    }
    return meta, mz_vals, int_vals


def iter_ms1_spectra(
    state: LCMSSessionState,
    *,
    polarity: Optional[str] = None,
    rt_min: Optional[float] = None,
    rt_max: Optional[float] = None,
) -> Iterable[Tuple[Any, np.ndarray, np.ndarray]]:
    """Yield MS1 spectra using one locked mzML reader for scan-heavy actions."""
    metas = _ms1_candidates(state, polarity=polarity)
    if rt_min is not None:
        metas = [m for m in metas if float(m.rt_min) >= float(rt_min)]
    if rt_max is not None:
        metas = [m for m in metas if float(m.rt_min) <= float(rt_max)]
    if not metas:
        return
    with state._reader_lock:
        rdr = mzml.MzML(str(state.path))
        try:
            for meta in metas:
                mz_vals, int_vals = _spectrum_arrays_from_reader(rdr, str(meta.spectrum_id))
                yield meta, mz_vals, int_vals
        finally:
            close = getattr(rdr, "close", None)
            if callable(close):
                close()


def extracted_ion_chromatogram(
    state: LCMSSessionState,
    target_mz: float,
    *,
    tolerance: float = 0.01,
    polarity: Optional[str] = None,
) -> Dict[str, Any]:
    """Sum intensity in a target m/z window for every MS1 scan."""
    tol = max(0.0, float(tolerance))
    target = float(target_mz)
    rows: List[Tuple[float, float, Optional[str]]] = []
    best: Dict[str, Any] = {
        "rt_min": None,
        "intensity": 0.0,
        "mz": None,
        "spectrum_id": None,
        "polarity": None,
    }
    for meta, mz_vals, int_vals in iter_ms1_spectra(state, polarity=polarity):
        mask = np.abs(mz_vals - target) <= tol
        intensity = float(np.nansum(int_vals[mask])) if np.any(mask) else 0.0
        if intensity > float(best["intensity"]):
            local_mz = None
            if np.any(mask):
                local_idx = int(np.argmax(int_vals[mask]))
                local_mz = float(mz_vals[mask][local_idx])
            best = {
                "rt_min": float(meta.rt_min),
                "intensity": intensity,
                "mz": local_mz,
                "spectrum_id": meta.spectrum_id,
                "polarity": meta.polarity,
            }
        rows.append((float(meta.rt_min), intensity, meta.polarity))
    return {
        "target_mz": target,
        "tolerance": tol,
        "rt_min": [rt for rt, _intensity, _pol in rows],
        "intensity": [intensity for _rt, intensity, _pol in rows],
        "polarity": [pol for _rt, _intensity, pol in rows],
        "best": best,
        "n_scans": len(rows),
    }


def find_mz_across_scans(
    state: LCMSSessionState,
    target_mz: float,
    *,
    tolerance: float = 0.01,
    polarity: Optional[str] = None,
) -> Dict[str, Any]:
    eic = extracted_ion_chromatogram(
        state,
        target_mz,
        tolerance=tolerance,
        polarity=polarity,
    )
    return {
        "target_mz": eic["target_mz"],
        "tolerance": eic["tolerance"],
        "best": eic["best"],
        "n_scans": eic["n_scans"],
    }


def summed_spectrum_in_rt_range(
    state: LCMSSessionState,
    *,
    rt_min: float,
    rt_max: float,
    polarity: Optional[str] = None,
    bin_width: float = 0.01,
    min_rel: float = 0.0,
    max_bins: int = 25000,
) -> Dict[str, Any]:
    lo = min(float(rt_min), float(rt_max))
    hi = max(float(rt_min), float(rt_max))
    width = max(1e-6, float(bin_width))
    totals: Dict[int, float] = {}
    weighted_mz: Dict[int, float] = {}
    n_scans = 0
    for _meta, mz_vals, int_vals in iter_ms1_spectra(
        state,
        polarity=polarity,
        rt_min=lo,
        rt_max=hi,
    ):
        n_scans += 1
        keys = np.rint(mz_vals / width).astype(np.int64)
        for key, mz_value, intensity in zip(keys.tolist(), mz_vals.tolist(), int_vals.tolist()):
            if not np.isfinite(mz_value) or not np.isfinite(intensity):
                continue
            key_int = int(key)
            value = float(intensity)
            totals[key_int] = totals.get(key_int, 0.0) + value
            weighted_mz[key_int] = weighted_mz.get(key_int, 0.0) + float(mz_value) * value
    if not totals:
        return {
            "rt_min": lo,
            "rt_max": hi,
            "bin_width": width,
            "n_scans": n_scans,
            "mz": [],
            "intensity": [],
        }
    mz_out = np.asarray(
        [
            (weighted_mz.get(key, 0.0) / total) if total > 0 else key * width
            for key, total in totals.items()
        ],
        dtype=float,
    )
    int_out = np.asarray(list(totals.values()), dtype=float)
    imax = float(np.nanmax(int_out)) if int_out.size else 0.0
    if imax > 0 and min_rel > 0:
        keep = int_out >= float(min_rel) * imax
        mz_out = mz_out[keep]
        int_out = int_out[keep]
    if mz_out.size > max_bins:
        order = np.argsort(int_out)[::-1][:max_bins]
        mz_out = mz_out[order]
        int_out = int_out[order]
    order = np.argsort(mz_out)
    return {
        "rt_min": lo,
        "rt_max": hi,
        "bin_width": width,
        "n_scans": n_scans,
        "mz": [float(v) for v in mz_out[order].tolist()],
        "intensity": [float(v) for v in int_out[order].tolist()],
    }


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

    xcol = str(info["xcol"])
    ycol = str(info["ycol"])
    uv = UVSessionState(
        filename=filename,
        path=csv_path,
        rt_min=np.asarray(rt_min, dtype=float),
        signal=np.asarray(signal, dtype=float),
        x_col=xcol,
        y_col=ycol,
        x_label=_friendly_label(xcol, "x"),
        y_label=_friendly_label(ycol, "y"),
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


def _parse_polymer_monomers(text: str) -> List[Tuple[str, float]]:
    monomers: List[Tuple[str, float]] = []
    auto_i = 1
    for raw in str(text or "").splitlines():
        line = raw.strip()
        if not line:
            continue
        if "," in line:
            name_s, mass_s = [part.strip() for part in line.rsplit(",", 1)]
            name = name_s or f"M{auto_i}"
        else:
            parts = [p.strip() for p in line.split() if p.strip()]
            if len(parts) > 1:
                name = " ".join(parts[:-1])
                mass_s = parts[-1]
            else:
                name = f"M{auto_i}"
                mass_s = parts[0]
        if name.startswith("M") and name[1:].isdigit():
            auto_i += 1
        try:
            monomers.append((name, float(mass_s)))
        except (IndexError, ValueError):
            continue
    return monomers


def _parse_polymer_charges(text: str) -> List[int]:
    charges: List[int] = []
    for part in str(text or "1").replace(";", ",").split(","):
        try:
            charge = int(part.strip())
        except ValueError:
            continue
        if charge > 0:
            charges.append(charge)
    return charges or [1]


def polymer_match_labels(
    mz: np.ndarray,
    intensity: np.ndarray,
    *,
    polarity: Optional[str],
    settings: Dict[str, Any],
) -> List[Dict[str, Any]]:
    """Return polymer match labels using the same pure engine as the Tk app."""
    if not bool(settings.get("enabled")):
        return []
    monomers = _parse_polymer_monomers(str(settings.get("monomers_text") or ""))
    if not monomers or mz.size == 0 or intensity.size == 0:
        return []

    order = np.argsort(mz)
    mz_s = np.asarray(mz, dtype=float)[order]
    int_s = np.asarray(intensity, dtype=float)[order]
    adduct_mass = float(settings.get("adduct_mass", 1.007276) or 1.007276)
    cluster_adduct_mass = float(settings.get("cluster_adduct_mass", -1.007276) or -1.007276)
    if polarity in ("positive", "negative"):
        h = 1.007276
        sign = 1.0 if polarity == "positive" else -1.0
        if abs(abs(adduct_mass) - h) <= 0.01:
            adduct_mass = sign * abs(adduct_mass)
        if abs(abs(cluster_adduct_mass) - h) <= 0.01:
            cluster_adduct_mass = sign * abs(cluster_adduct_mass)

    best_by_peak = poly_match.compute_polymer_best_by_peak_sorted(
        mz_s,
        int_s,
        monomer_names=[name for name, _mass in monomers],
        monomer_masses=[mass for _name, mass in monomers],
        charges=_parse_polymer_charges(str(settings.get("charges") or "1")),
        max_dp=max(1, min(200, int(settings.get("max_dp", 12) or 12))),
        bond_delta=float(settings.get("bond_delta", -18.010565) or -18.010565),
        extra_delta=float(settings.get("extra_delta", 0.0) or 0.0),
        polarity=polarity,
        base_adduct_mass=adduct_mass,
        enable_decarb=bool(settings.get("decarb")),
        enable_oxid=bool(settings.get("oxid")),
        enable_h2o_loss=bool(settings.get("h2o_loss")),
        enable_cluster=bool(settings.get("cluster")),
        cluster_adduct_mass=cluster_adduct_mass,
        enable_na=bool(settings.get("adduct_na")),
        enable_k=bool(settings.get("adduct_k")),
        enable_cl=bool(settings.get("adduct_cl")),
        enable_formate=bool(settings.get("adduct_formate")),
        enable_acetate=bool(settings.get("adduct_acetate")),
        tol_value=float(settings.get("tol_value", 0.02) or 0.02),
        tol_unit=str(settings.get("tol_unit") or "Da"),
        min_rel_int=float(settings.get("min_rel_int", 0.01) or 0.01),
        allow_variant_combo=True,
    )
    labels: List[Dict[str, Any]] = []
    kind_order = ["poly", "h2o", "ox", "decarb", "oxdecarb", "2m"]
    for peak_i, kinds in best_by_peak.items():
        ordered = [(kind, kinds[kind]) for kind in kind_order if kind in kinds]
        if not ordered:
            ordered = list(kinds.items())
        for kind, (abs_err, text, mz_act, inten_act) in ordered:
            labels.append(
                {
                    "mz": float(mz_act),
                    "intensity": float(inten_act),
                    "text": str(text),
                    "kind": str(kind),
                    "abs_err": float(abs_err),
                    "source": "polymer",
                    "peak_index": int(peak_i),
                }
            )
    return labels
