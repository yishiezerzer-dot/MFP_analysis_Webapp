"""LCMS service: wraps the existing `lab_gui.lcms_io` / `lcms_model` modules.

Keeps session state (one per uploaded mzML) in an in-process registry so
subsequent requests can fetch spectra without re-parsing the whole file.
"""
from __future__ import annotations

import threading
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
    workspace_id: str = "general"
    uv: Optional[UVSessionState] = None
    # One open reader per session (use only while holding _reader_lock). Opening re-indexes the
    # whole file, which cost ~1 s per spectrum click on a 140 MB file when done per request.
    _reader: Optional[Any] = None
    _peaks: Optional["PeakTable"] = None

    def reader(self) -> Any:
        """Open (once) and return the mzML reader. Caller must hold _reader_lock."""
        if self._reader is None:
            # Uses the file's own <indexList> when present; falls back to scanning it.
            self._reader = mzml.PreIndexedMzML(str(self.path))
        return self._reader

    def close_reader(self) -> None:
        with self._reader_lock:
            if self._reader is not None:
                try:
                    self._reader.close()
                finally:
                    self._reader = None
            self._peaks = None  # drop memory maps so the files can be deleted

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
    """Process-local registry of loaded mzML sessions with SQLite persistence."""

    def __init__(self) -> None:
        self._sessions: Dict[str, LCMSSessionState] = {}
        self._lock = threading.Lock()

    def add_from_path(
        self,
        path: Path,
        *,
        workspace_id: str = "general",
        display_name: Optional[str] = None,
        rt_unit: str = "minutes",
    ) -> LCMSSessionState:
        idx = MzMLTICIndex(path, rt_unit=rt_unit)
        idx.build()
        fatal = idx.stats.get("fatal_error")
        if fatal and not idx.ms1:
            raise LCMSLoadError(str(fatal))
        session_id = uuid.uuid4().hex
        state = self._store(session_id, display_name or path.name, path, idx, workspace_id=workspace_id)
        from ..db import save_session_record
        save_session_record(
            session_id=session_id,
            workspace_id=workspace_id,
            module="lcms",
            display_name=state.display_name,
            file_path=str(path),
            extra={"rt_unit": rt_unit},
        )
        return state

    def restore_from_path(
        self,
        session_id: str,
        path: Path,
        *,
        workspace_id: str = "general",
        display_name: Optional[str] = None,
        rt_unit: str = "minutes",
    ) -> LCMSSessionState:
        idx = MzMLTICIndex(path, rt_unit=rt_unit)
        idx.build()
        fatal = idx.stats.get("fatal_error")
        if fatal and not idx.ms1:
            raise LCMSLoadError(str(fatal))
        return self._store(session_id, display_name or path.name, path, idx, workspace_id=workspace_id)

    def _store(
        self,
        session_id: str,
        display_name: str,
        path: Path,
        idx: MzMLTICIndex,
        workspace_id: str = "general",
    ) -> LCMSSessionState:
        state = LCMSSessionState(
            session_id=session_id,
            display_name=display_name,
            path=path,
            index=idx,
            _reader_lock=threading.Lock(),
            workspace_id=workspace_id,
        )
        with self._lock:
            previous = self._sessions.get(session_id)
            self._sessions[session_id] = state
        if previous is not None:
            previous.close_reader()
        return state

    def get(self, session_id: str) -> Optional[LCMSSessionState]:
        with self._lock:
            state = self._sessions.get(session_id)
        if state is not None:
            return state

        from ..db import get_session_record
        rec = get_session_record(session_id)
        if rec and rec.get("module") == "lcms":
            return self._restore_record(rec)
        return None

    def _restore_record(self, rec: Dict[str, Any]) -> Optional[LCMSSessionState]:
        from ..db import clear_restore_error, record_restore_error
        extra = rec.get("extra") or {}
        p = Path(rec["file_path"])
        if not p.exists():
            record_restore_error(rec, f"File not found: {p.name}")
            return None
        try:
            state = self.restore_from_path(
                rec["session_id"],
                p,
                workspace_id=rec.get("workspace_id", "general"),
                display_name=rec.get("display_name"),
                rt_unit=extra.get("rt_unit", "minutes"),
            )
        except Exception as exc:  # noqa: BLE001 - any parser failure is reported, not raised
            record_restore_error(rec, f"Could not load {p.name}: {exc}", exc)
            return None
        clear_restore_error(rec["session_id"])

        uv_path_str = extra.get("uv_path")
        if uv_path_str:
            uv_p = Path(uv_path_str)
            try:
                if not uv_p.exists():
                    raise FileNotFoundError(f"File not found: {uv_p.name}")
                attach_uv_from_csv(
                    state,
                    uv_p,
                    filename=extra.get("uv_filename") or uv_p.name,
                    rt_unit=extra.get("uv_rt_unit", "auto"),
                )
            except Exception as exc:  # noqa: BLE001 - session is usable without its UV trace
                record_restore_error(rec, f"Loaded, but its UV trace could not be re-attached: {exc}", exc)
        return state

    def remove(self, session_id: str) -> bool:
        from ..db import delete_session_record, get_session_record, remove_unreferenced_files
        rec = get_session_record(session_id)
        cache_path = None
        if rec:
            # Resolve the index cache location while the mzML still exists (it keys on file stats).
            rt_unit = (rec.get("extra") or {}).get("rt_unit", "minutes")
            cache_path = MzMLTICIndex(Path(rec["file_path"]), rt_unit=rt_unit)._cache_path()
        delete_session_record(session_id)
        with self._lock:
            state = self._sessions.pop(session_id, None)
        in_memory = state is not None
        if state is not None:
            state.close_reader()  # an open handle would block deleting the file on Windows
        if rec:
            removed = remove_unreferenced_files(rec)
            if cache_path is not None and Path(rec["file_path"]).resolve() in removed:
                cache_path.unlink(missing_ok=True)
                peaks_base = cache_path.with_name(cache_path.stem + ".peaks")
                for f in _peak_table_files(peaks_base):
                    f.unlink(missing_ok=True)
        return in_memory or rec is not None

    def list(self, workspace_id: Optional[str] = None) -> List[LCMSSessionState]:
        from ..db import list_session_records
        records = list_session_records(workspace_id=workspace_id, module="lcms")
        for rec in records:
            sid = rec["session_id"]
            with self._lock:
                already = sid in self._sessions
            if not already:
                self._restore_record(rec)
        with self._lock:
            if workspace_id:
                return [s for s in self._sessions.values() if s.workspace_id == workspace_id]
            return list(self._sessions.values())


registry = LCMSRegistry()


@dataclass
class PeakTable:
    """All MS1 peaks of a file in index (RT) order: scan i owns mz[offsets[i]:offsets[i+1]].

    Memory-mapped from files next to the index cache, so repeated EICs and region sums are
    vectorised array operations instead of decoding every spectrum again.
    """

    mz: np.ndarray  # float64
    intensity: np.ndarray  # float32 (relative precision ~1e-7)
    offsets: np.ndarray  # int64, len n_scans + 1


def _peak_table_base(state: "LCMSSessionState") -> Optional[Path]:
    cache_json = state.index._cache_path()
    return None if cache_json is None else cache_json.with_name(cache_json.stem + ".peaks")


def _peak_table_files(base: Path) -> Tuple[Path, Path, Path]:
    return (
        base.with_name(base.name + ".mz.f64"),
        base.with_name(base.name + ".int.f32"),
        base.with_name(base.name + ".offsets.npy"),
    )


def peak_table(state: "LCMSSessionState") -> PeakTable:
    """Load or build the session's peak table. Caller must hold state._reader_lock."""
    if state._peaks is not None:
        return state._peaks
    base = _peak_table_base(state)
    if base is None:
        raise LCMSLoadError("mzML file is missing.")
    mz_file, int_file, off_file = _peak_table_files(base)
    n_scans = len(state.index.ms1)
    offsets: Optional[np.ndarray] = None
    if off_file.exists() and mz_file.exists() and int_file.exists():
        offsets = np.load(off_file)
        total = int(offsets[-1]) if offsets.size else 0
        if offsets.size != n_scans + 1 or mz_file.stat().st_size != total * 8 or int_file.stat().st_size != total * 4:
            offsets = None  # stale or partial cache
    if offsets is None:
        # Stream spectra to disk one at a time so a large file never sits in RAM at once.
        rdr = state.reader()
        counts = []
        tmp_mz = mz_file.with_name(mz_file.name + ".tmp")
        tmp_int = int_file.with_name(int_file.name + ".tmp")
        with open(tmp_mz, "wb") as f_mz, open(tmp_int, "wb") as f_int:
            for meta in state.index.ms1:
                mz_vals, int_vals = _spectrum_arrays_from_reader(rdr, str(meta.spectrum_id))
                f_mz.write(np.ascontiguousarray(mz_vals, dtype=np.float64).tobytes())
                f_int.write(np.ascontiguousarray(int_vals, dtype=np.float32).tobytes())
                counts.append(int(mz_vals.size))
        offsets = np.concatenate([[0], np.cumsum(counts, dtype=np.int64)]).astype(np.int64)
        tmp_mz.replace(mz_file)
        tmp_int.replace(int_file)
        np.save(off_file, offsets)
    total = int(offsets[-1])
    if total == 0:
        mz_arr, int_arr = np.zeros(0, dtype=np.float64), np.zeros(0, dtype=np.float32)
    else:
        mz_arr = np.memmap(mz_file, dtype=np.float64, mode="r", shape=(total,))
        int_arr = np.memmap(int_file, dtype=np.float32, mode="r", shape=(total,))
    state._peaks = PeakTable(mz=mz_arr, intensity=int_arr, offsets=offsets)
    return state._peaks


def _scan_selection(state: "LCMSSessionState", polarity: Optional[str]) -> np.ndarray:
    """Boolean mask over state.index.ms1 for the requested polarity (same rules as _ms1_candidates)."""
    metas = state.index.ms1
    if polarity in ("positive", "negative"):
        sel = np.fromiter((m.polarity == polarity for m in metas), dtype=bool, count=len(metas))
        if not sel.any():
            raise LCMSLoadError(f"This file has no {polarity}-polarity MS1 scans.")
        return sel
    return np.ones(len(metas), dtype=bool)


def _ms1_candidates(
    state: LCMSSessionState,
    *,
    polarity: Optional[str] = None,
) -> List[Any]:
    metas = state.index.ms1
    if polarity in ("positive", "negative"):
        filtered = [m for m in metas if m.polarity == polarity]
        if not filtered:
            raise LCMSLoadError(f"This file has no {polarity}-polarity MS1 scans.")
        return filtered
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

    # No per-session spectrum cache: with the persistent reader a spectrum is ~10 ms to decode,
    # and caching decoded arrays grew memory without bound across sessions.
    with state._reader_lock:
        mz_vals, int_vals = _spectrum_arrays_from_reader(state.reader(), str(chosen.spectrum_id))

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
        rdr = state.reader()
        for meta in metas:
            mz_vals, int_vals = _spectrum_arrays_from_reader(rdr, str(meta.spectrum_id))
            yield meta, mz_vals, int_vals


def extracted_ion_chromatogram(
    state: LCMSSessionState,
    target_mz: float,
    *,
    tolerance: float = 0.01,
    tolerance_unit: str = "da",
    polarity: Optional[str] = None,
) -> Dict[str, Any]:
    """Sum intensity in a target m/z window for every MS1 scan."""
    target = float(target_mz)
    tol_val = max(0.0, float(tolerance))
    unit = str(tolerance_unit).lower()
    if unit == "ppm":
        tol = max(1e-9, tol_val * 1e-6 * target)
    else:
        unit = "da"
        tol = tol_val

    metas = state.index.ms1
    sel = _scan_selection(state, polarity)
    with state._reader_lock:
        table = peak_table(state)
    # One pass over every peak: window mask, then sum intensities per scan.
    hit = np.flatnonzero(np.abs(table.mz - target) <= tol)
    hit_scan = np.searchsorted(table.offsets, hit, side="right") - 1
    hit_int = np.nan_to_num(np.asarray(table.intensity[hit], dtype=np.float64))
    sums = np.bincount(hit_scan, weights=hit_int, minlength=len(metas))

    idx = np.flatnonzero(sel)
    rows = [(float(metas[i].rt_min), float(sums[i]), metas[i].polarity) for i in idx]
    best: Dict[str, Any] = {"rt_min": None, "intensity": 0.0, "mz": None, "spectrum_id": None, "polarity": None}
    if idx.size and float(sums[idx].max()) > 0.0:
        b = int(idx[int(np.argmax(sums[idx]))])  # first scan with the maximum, as before
        in_scan = hit[hit_scan == b]
        local = in_scan[int(np.argmax(table.intensity[in_scan]))]
        best = {
            "rt_min": float(metas[b].rt_min),
            "intensity": float(sums[b]),
            "mz": float(table.mz[local]),
            "spectrum_id": metas[b].spectrum_id,
            "polarity": metas[b].polarity,
        }
    return {
        "target_mz": target,
        "tolerance": tol,
        "tolerance_value": tol_val,
        "tolerance_unit": unit,
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
    tolerance_unit: str = "da",
    polarity: Optional[str] = None,
) -> Dict[str, Any]:
    eic = extracted_ion_chromatogram(
        state,
        target_mz,
        tolerance=tolerance,
        tolerance_unit=tolerance_unit,
        polarity=polarity,
    )
    return {
        "target_mz": eic["target_mz"],
        "tolerance": eic["tolerance"],
        "tolerance_value": eic.get("tolerance_value", eic["tolerance"]),
        "tolerance_unit": eic.get("tolerance_unit", "da"),
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
    metas = state.index.ms1
    sel = _scan_selection(state, polarity)
    rts = np.fromiter((float(m.rt_min) for m in metas), dtype=float, count=len(metas))
    scan_mask = sel & (rts >= lo) & (rts <= hi)
    n_scans = int(scan_mask.sum())
    with state._reader_lock:
        table = peak_table(state)
    peak_mask = np.repeat(scan_mask, np.diff(table.offsets))
    mz_vals = np.asarray(table.mz[peak_mask], dtype=np.float64)
    int_vals = np.asarray(table.intensity[peak_mask], dtype=np.float64)
    finite = np.isfinite(mz_vals) & np.isfinite(int_vals)
    mz_vals, int_vals = mz_vals[finite], int_vals[finite]
    if mz_vals.size == 0:
        return {
            "rt_min": lo,
            "rt_max": hi,
            "bin_width": width,
            "n_scans": n_scans,
            "mz": [],
            "intensity": [],
        }
    # Bin by rounded m/z; each bin reports its intensity-weighted mean m/z and summed intensity.
    keys, inverse = np.unique(np.rint(mz_vals / width).astype(np.int64), return_inverse=True)
    int_out = np.bincount(inverse, weights=int_vals)
    weighted = np.bincount(inverse, weights=mz_vals * int_vals)
    mz_out = np.where(int_out > 0, weighted / np.where(int_out > 0, int_out, 1.0), keys * width)
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


def _is_number(value: Any) -> bool:
    try:
        float(str(value))
        return True
    except ValueError:
        return False


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
                if all(_is_number(c) for c in df.columns):
                    # No header row: re-read so the first data point isn't consumed as column names.
                    df = pd.read_csv(path, sep=sep, engine="python", comment="#", header=None)
                    df.columns = [str(c) for c in df.columns]
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


def attach_uv_from_csv(
    state: LCMSSessionState,
    csv_path: Path,
    *,
    filename: str,
    rt_unit: str = "auto",
) -> UVSessionState:
    """Parse a UV/DAD CSV and attach it to the given LCMS session.

    rt_unit: "minutes" / "seconds" as chosen by the user, or "auto" to use the header hint
    (e.g. "Time (sec)"), defaulting to minutes.
    """
    df = _read_uv_csv(csv_path)
    info = infer_uv_columns(df)
    if rt_unit in ("minutes", "seconds"):
        info["unit_guess"] = rt_unit
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
    from ..db import get_session_record, save_session_record
    rec = get_session_record(state.session_id)
    if rec:
        extra = rec.get("extra") or {}
        extra["uv_path"] = str(csv_path)
        extra["uv_filename"] = filename
        extra["uv_rt_unit"] = rt_unit
        save_session_record(
            session_id=state.session_id,
            workspace_id=state.workspace_id,
            module="lcms",
            display_name=state.display_name,
            file_path=str(state.path),
            extra=extra,
        )
    return uv


def clear_uv(state: LCMSSessionState) -> bool:
    had = state.uv is not None
    state.uv = None
    if had:
        from ..db import get_session_record, save_session_record
        rec = get_session_record(state.session_id)
        if rec:
            extra = rec.get("extra") or {}
            extra.pop("uv_path", None)
            extra.pop("uv_filename", None)
            extra.pop("uv_rt_unit", None)
            save_session_record(
                session_id=state.session_id,
                workspace_id=state.workspace_id,
                module="lcms",
                display_name=state.display_name,
                file_path=str(state.path),
                extra=extra,
            )
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
    adduct_mass = poly_match.setting_float(settings, "adduct_mass", 1.007276)
    cluster_adduct_mass = poly_match.setting_float(settings, "cluster_adduct_mass", -1.007276)
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
        max_dp=max(1, min(200, int(poly_match.setting_float(settings, "max_dp", 12)))),
        bond_delta=poly_match.setting_float(settings, "bond_delta", -18.010565),
        extra_delta=poly_match.setting_float(settings, "extra_delta", 0.0),
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
        custom_adducts=settings.get("custom_adducts"),
        tol_value=poly_match.setting_float(settings, "tol_value", 0.02),
        tol_unit=str(settings.get("tol_unit") or "Da"),
        min_rel_int=poly_match.setting_float(settings, "min_rel_int", 0.01),
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
