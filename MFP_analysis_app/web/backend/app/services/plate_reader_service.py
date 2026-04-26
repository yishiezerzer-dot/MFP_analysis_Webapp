"""Plate Reader service.

Thin wrapper around `lab_gui.plate_reader_io` + `lab_gui.plate_reader_model`
so the web app's MIC wizard uses the exact same computation as the desktop
app. Session state (uploaded file + cached DataFrames) is kept in-process.
"""
from __future__ import annotations

import threading
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional

import pandas as pd

from lab_gui.plate_reader_io import (
    list_excel_sheets,
    preview_dataframe,
    read_plate_file,
)
from lab_gui.plate_reader_model import (
    PlateReaderMICWizardConfig,
    PlateReaderMICWizardResult,
    build_mic_wizard_config_and_result,
)


@dataclass
class PlateSession:
    session_id: str
    display_name: str
    path: Path
    sheets: List[str]
    # Cached per (sheet_name, use_first_row_as_header) DataFrame
    _df_cache: Dict[tuple, pd.DataFrame] = field(default_factory=dict)
    _lock: threading.Lock = field(default_factory=threading.Lock)

    def load_dataframe(
        self,
        *,
        sheet_name: Optional[str],
        use_first_row_as_header: bool,
    ) -> pd.DataFrame:
        key = (str(sheet_name) if sheet_name else None, bool(use_first_row_as_header))
        with self._lock:
            if key in self._df_cache:
                return self._df_cache[key]
            header_row = 0 if use_first_row_as_header else None
            df = read_plate_file(self.path, sheet_name=sheet_name, header_row=header_row)
            self._df_cache[key] = df
            return df


class PlateReaderRegistry:
    def __init__(self) -> None:
        self._sessions: Dict[str, PlateSession] = {}
        self._lock = threading.Lock()

    def add_from_path(self, path: Path, *, display_name: Optional[str] = None) -> PlateSession:
        suf = path.suffix.lower()
        sheets: List[str] = list_excel_sheets(path) if suf in (".xlsx", ".xlsm", ".xls") else []
        session = PlateSession(
            session_id=uuid.uuid4().hex,
            display_name=display_name or path.name,
            path=path,
            sheets=sheets,
        )
        with self._lock:
            self._sessions[session.session_id] = session
        return session

    def get(self, sid: str) -> Optional[PlateSession]:
        with self._lock:
            return self._sessions.get(sid)

    def remove(self, sid: str) -> bool:
        with self._lock:
            return self._sessions.pop(sid, None) is not None

    def list(self) -> List[PlateSession]:
        with self._lock:
            return list(self._sessions.values())


registry = PlateReaderRegistry()


def preview(df: pd.DataFrame, *, max_rows: int = 200) -> Dict[str, Any]:
    cols, rows = preview_dataframe(df, max_rows=max_rows)
    return {
        "columns": cols,
        "rows": rows,
        "n_rows_total": int(df.shape[0]),
        "n_cols_total": int(df.shape[1]),
        "n_rows_preview": len(rows),
    }


def run_mic_wizard(
    df: pd.DataFrame,
    *,
    use_first_row_as_header: bool,
    sample_rows: List[int],
    control_rows: List[int],
    concentration_columns: List[str],
    tick_text: str,
    auto_tick_labels_power2: bool,
    title: str,
    x_label: str,
    y_label: str,
    plot_type: str,
    control_style: str,
) -> Dict[str, Any]:
    cfg, result, sample_nan = build_mic_wizard_config_and_result(
        df,
        use_first_row_as_header=use_first_row_as_header,
        sample_rows=sample_rows,
        control_rows=control_rows,
        concentration_columns=concentration_columns,
        tick_text=tick_text,
        auto_tick_labels_power2=auto_tick_labels_power2,
        title=title,
        x_label=x_label,
        y_label=y_label,
        plot_type=plot_type,
        control_style=control_style,
    )
    return {
        "config": _cfg_to_dict(cfg),
        "result": _result_to_dict(result),
        "sample_nan_ratio": float(sample_nan),
    }


def _cfg_to_dict(cfg: PlateReaderMICWizardConfig) -> Dict[str, Any]:
    return {
        "use_first_row_as_header": cfg.use_first_row_as_header,
        "sample_rows": list(cfg.sample_rows),
        "control_rows": list(cfg.control_rows),
        "concentration_columns": list(cfg.concentration_columns),
        "tick_labels": list(cfg.tick_labels),
        "auto_tick_labels_power2": cfg.auto_tick_labels_power2,
        "title": cfg.title,
        "x_label": cfg.x_label,
        "y_label": cfg.y_label,
        "plot_type": cfg.plot_type,
        "control_style": cfg.control_style,
        "invert_x": cfg.invert_x,
        "sample_color": cfg.sample_color,
        "control_color": cfg.control_color,
    }


def _result_to_dict(res: PlateReaderMICWizardResult) -> Dict[str, Any]:
    return {
        "concentrations": list(res.concentrations),
        "x_tick_labels": list(res.x_tick_labels),
        "sample_mean": list(res.sample_mean),
        "sample_std": list(res.sample_std),
        "control_mean": list(res.control_mean) if res.control_mean is not None else None,
        "control_std": list(res.control_std) if res.control_std is not None else None,
    }
