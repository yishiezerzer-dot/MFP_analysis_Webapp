"""Data Studio service.

Wraps `lab_gui.data_studio_io` so the web app uses the same table loading
+ transform pipeline as the desktop app. Session state holds the raw
DataFrame plus the last-applied transform pipeline; it is cached and
recomputed lazily when the pipeline changes.
"""
from __future__ import annotations

import math
import threading
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

from lab_gui.data_studio_io import (
    apply_transform_steps,
    column_type_map,
    get_sheet_names,
    load_table,
    normalize_series,
    numeric_columns,
    schema_hash_from_columns,
)


# ------------------------------ session state ------------------------------


@dataclass
class DataStudioSession:
    session_id: str
    display_name: str
    path: Path
    sheet_name: Optional[str] = None
    header_row: int = 0
    decimal_comma: bool = False
    sheets: List[str] = field(default_factory=list)
    # raw + transformed dataframe caches
    _raw: Optional[pd.DataFrame] = None
    _transformed: Optional[pd.DataFrame] = None
    _transform_steps: List[Dict[str, Any]] = field(default_factory=list)
    _lock: threading.Lock = field(default_factory=threading.Lock)

    def raw(self) -> pd.DataFrame:
        with self._lock:
            if self._raw is None:
                self._raw = load_table(
                    self.path,
                    sheet_name=self.sheet_name,
                    header_row=int(self.header_row),
                    decimal_comma=bool(self.decimal_comma),
                    auto_cast=True,
                )
            return self._raw

    def set_load_options(
        self,
        *,
        sheet_name: Optional[str],
        header_row: int,
        decimal_comma: bool,
    ) -> None:
        with self._lock:
            changed = (
                (self.sheet_name != sheet_name)
                or (int(self.header_row) != int(header_row))
                or (bool(self.decimal_comma) != bool(decimal_comma))
            )
            if changed:
                self.sheet_name = sheet_name
                self.header_row = int(header_row)
                self.decimal_comma = bool(decimal_comma)
                self._raw = None
                self._transformed = None

    def apply_transforms(self, steps: List[Dict[str, Any]]) -> pd.DataFrame:
        with self._lock:
            if self._raw is None:
                self._raw = load_table(
                    self.path,
                    sheet_name=self.sheet_name,
                    header_row=int(self.header_row),
                    decimal_comma=bool(self.decimal_comma),
                    auto_cast=True,
                )
            steps_changed = list(steps or []) != list(self._transform_steps or [])
            if self._transformed is None or steps_changed:
                self._transform_steps = list(steps or [])
                if self._transform_steps:
                    self._transformed = apply_transform_steps(self._raw, self._transform_steps)
                else:
                    self._transformed = self._raw.copy()
            return self._transformed


# ------------------------------ registry ------------------------------


class DataStudioRegistry:
    def __init__(self) -> None:
        self._sessions: Dict[str, DataStudioSession] = {}
        self._lock = threading.Lock()

    def add_from_path(self, path: Path, *, display_name: Optional[str] = None) -> DataStudioSession:
        suffix = path.suffix.lower()
        sheets = get_sheet_names(path) if suffix in (".xlsx", ".xlsm", ".xls") else []
        s = DataStudioSession(
            session_id=uuid.uuid4().hex,
            display_name=display_name or path.name,
            path=path,
            sheet_name=(sheets[0] if sheets else None),
            sheets=sheets,
        )
        with self._lock:
            self._sessions[s.session_id] = s
        return s

    def restore_from_path(
        self,
        session_id: str,
        path: Path,
        *,
        display_name: Optional[str] = None,
    ) -> DataStudioSession:
        suffix = path.suffix.lower()
        sheets = get_sheet_names(path) if suffix in (".xlsx", ".xlsm", ".xls") else []
        s = DataStudioSession(
            session_id=session_id,
            display_name=display_name or path.name,
            path=path,
            sheet_name=(sheets[0] if sheets else None),
            sheets=sheets,
        )
        with self._lock:
            self._sessions[session_id] = s
        return s

    def get(self, sid: str) -> Optional[DataStudioSession]:
        with self._lock:
            return self._sessions.get(sid)

    def remove(self, sid: str) -> bool:
        with self._lock:
            return self._sessions.pop(sid, None) is not None

    def list(self) -> List[DataStudioSession]:
        with self._lock:
            return list(self._sessions.values())


registry = DataStudioRegistry()


async def get_or_restore(session_id: str) -> Optional[DataStudioSession]:
    existing = registry.get(session_id)
    if existing is not None:
        return existing

    import tempfile

    from ..blob_store import download_bytes, get_json, manifest_key

    manifest = await get_json(manifest_key("data_studio", session_id))
    if manifest is None:
        return None

    data = await download_bytes(str(manifest["blob_url"]))
    tmp_dir = Path(tempfile.mkdtemp(prefix="mfp_ds_restore_"))
    filename = str(manifest.get("filename") or "upload.csv")
    dest = tmp_dir / filename
    dest.write_bytes(data)
    return registry.restore_from_path(
        session_id,
        dest,
        display_name=str(manifest.get("display_name") or filename),
    )


# ------------------------------ helpers ------------------------------


def session_summary(s: DataStudioSession) -> Dict[str, Any]:
    # Avoid forcing a load here — caller may not want to pay the IO cost just
    # to list sessions. Shape is reported only when raw is already cached.
    shape: Optional[Tuple[int, int]] = None
    if s._raw is not None:
        shape = (int(s._raw.shape[0]), int(s._raw.shape[1]))
    return {
        "session_id": s.session_id,
        "display_name": s.display_name,
        "path": str(s.path),
        "sheets": list(s.sheets),
        "sheet_name": s.sheet_name,
        "header_row": int(s.header_row),
        "decimal_comma": bool(s.decimal_comma),
        "shape": shape,
    }


def describe_frame(df: pd.DataFrame) -> Dict[str, Any]:
    types = column_type_map(df)
    cols = [str(c) for c in df.columns]
    return {
        "columns": cols,
        "dtypes": [types.get(c, "unknown") for c in cols],
        "numeric_columns": numeric_columns(df),
        "n_rows": int(df.shape[0]),
        "n_cols": int(df.shape[1]),
        "schema_hash": schema_hash_from_columns(types),
    }


def preview_rows(df: pd.DataFrame, *, max_rows: int = 200) -> Dict[str, Any]:
    rows: List[List[Any]] = []
    n = min(int(max_rows), int(df.shape[0]))
    for i in range(n):
        row: List[Any] = []
        for c in df.columns:
            v = df.iloc[i][c]
            row.append(_json_safe(v))
        rows.append(row)
    return {
        "columns": [str(c) for c in df.columns],
        "rows": rows,
        "n_rows_preview": n,
        "n_rows_total": int(df.shape[0]),
        "n_cols_total": int(df.shape[1]),
    }


def build_plot_series(
    df: pd.DataFrame,
    *,
    x_col: Optional[str],
    y_cols: List[str],
    y_normalize: str = "none",
    x_normalize: str = "none",
    max_points: int = 10000,
) -> Dict[str, Any]:
    """Return {x, series:[{name, y}], meta}, decimated to max_points."""

    if not y_cols:
        return {"x": None, "series": [], "meta": {"x_col": x_col, "n_series": 0}}

    cols = [c for c in y_cols if c in df.columns]
    x_vals: Optional[np.ndarray] = None
    x_is_numeric = False
    if x_col and x_col in df.columns:
        series = df[x_col]
        x_is_numeric = bool(pd.api.types.is_numeric_dtype(series))
        if x_is_numeric:
            x_vals = pd.to_numeric(series, errors="coerce").to_numpy(dtype=float)
        else:
            # leave strings as-is for categorical axes
            x_vals = series.astype(str).to_numpy()

    # normalize x if numeric and requested
    if x_vals is not None and x_is_numeric and x_normalize and x_normalize != "none":
        x_vals = normalize_series(x_vals, _canonical_norm_mode(x_normalize))

    # Build decimation indices once using the longest series length.
    n_rows = int(df.shape[0])
    if max_points <= 0 or n_rows <= max_points:
        idx = np.arange(n_rows)
    else:
        stride = max(1, n_rows // int(max_points))
        idx = np.arange(0, n_rows, stride)

    series_out: List[Dict[str, Any]] = []
    for c in cols:
        y = pd.to_numeric(df[c], errors="coerce").to_numpy(dtype=float)
        if y_normalize and y_normalize != "none":
            y = normalize_series(y, _canonical_norm_mode(y_normalize))
        series_out.append({"name": str(c), "y": [_f(y[i]) for i in idx]})

    out: Dict[str, Any] = {
        "series": series_out,
        "meta": {
            "x_col": x_col,
            "x_is_numeric": x_is_numeric,
            "n_series": len(series_out),
            "n_points_full": n_rows,
            "n_points_returned": int(len(idx)),
        },
    }
    if x_vals is not None:
        if x_is_numeric:
            out["x"] = [_f(x_vals[i]) for i in idx]
        else:
            out["x"] = [str(x_vals[i]) for i in idx]
    else:
        out["x"] = [int(i) for i in idx]  # row index fallback
    return out


def build_histogram(
    df: pd.DataFrame,
    *,
    y_cols: List[str],
    bins: int = 30,
) -> Dict[str, Any]:
    series_out: List[Dict[str, Any]] = []
    for c in y_cols:
        if c not in df.columns:
            continue
        y = pd.to_numeric(df[c], errors="coerce").to_numpy(dtype=float)
        y = y[np.isfinite(y)]
        if y.size == 0:
            series_out.append({"name": str(c), "counts": [], "edges": []})
            continue
        counts, edges = np.histogram(y, bins=int(bins))
        series_out.append(
            {
                "name": str(c),
                "counts": [int(v) for v in counts.tolist()],
                "edges": [_f(v) for v in edges.tolist()],
            }
        )
    return {"series": series_out, "meta": {"bins": int(bins)}}


# ------------------------------ utils ------------------------------


def _canonical_norm_mode(mode: str) -> str:
    m = (mode or "").strip().lower()
    if m in ("zscore", "z-score", "z"):
        return "Z-score"
    return "Min-Max"


def _json_safe(v: Any) -> Any:
    # keep numbers as numbers (plotly benefits), NaN → None
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (np.floating, float)):
        f = float(v)
        if math.isnan(f) or math.isinf(f):
            return None
        return f
    if v is None:
        return None
    if isinstance(v, (int,)):
        return int(v)
    try:
        if pd.isna(v):
            return None
    except Exception:
        pass
    return str(v)


def _f(v: float) -> Optional[float]:
    try:
        f = float(v)
    except Exception:
        return None
    if math.isnan(f) or math.isinf(f):
        return None
    return f
