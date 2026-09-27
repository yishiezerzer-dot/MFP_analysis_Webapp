"""Read 96-well plate exports (BioTek Gen5 and plain 8x12 grids).

A Gen5 endpoint export is a metadata block ("Plate Number", "Reader Type:", ...), then a
grid whose header row holds 1..12 and whose rows are labelled A..H (Gen5 appends the
wavelength, e.g. "600", after column 12), then free-text notes. Any sheet or delimited file
that contains such a labelled 8x12 block is accepted; metadata is then empty.
"""
from __future__ import annotations

import csv
import re
from dataclasses import dataclass, field
from datetime import date, datetime, time
from pathlib import Path
from typing import Any, Dict, List, Optional

ROWS = "ABCDEFGH"
COLS = range(1, 13)


class PlateReadError(ValueError):
    pass


@dataclass
class PlateRead:
    values: Dict[str, Optional[float]]
    label: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)
    notes: List[str] = field(default_factory=list)


# Gen5 metadata labels (first cell, trailing colon optional) -> our keys.
_META_KEYS = {
    "software version": "software_version",
    "plate number": "plate_number",
    "date": "date",
    "time": "time",
    "reader type": "reader_type",
    "reader serial number": "reader_serial",
    "reading type": "reading_type",
    "plate type": "plate_type",
    "read": "read_type",
    "actual temperature": "temperature",
}


def _cell_text(v: Any) -> str:
    if v is None:
        return ""
    if isinstance(v, datetime):
        return v.isoformat()
    if isinstance(v, (date, time)):
        return v.isoformat()
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v).strip()


def _number(v: Any) -> Optional[float]:
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    try:
        return float(str(v).strip().replace(",", "."))
    except (TypeError, ValueError):
        return None


def _sheets(path: Path) -> List[List[List[Any]]]:
    suffix = path.suffix.lower()
    if suffix in (".xlsx", ".xlsm"):
        import openpyxl

        wb = openpyxl.load_workbook(path, data_only=True, read_only=True)
        try:
            return [[list(r) for r in ws.iter_rows(values_only=True)] for ws in wb.worksheets]
        finally:
            wb.close()
    if suffix == ".xls":
        import pandas as pd

        frames = pd.read_excel(path, sheet_name=None, header=None)
        return [df.where(df.notna(), None).values.tolist() for df in frames.values()]
    text = path.read_text(encoding="utf-8-sig", errors="replace")
    try:
        dialect = csv.Sniffer().sniff(text[:4096], delimiters=",;\t")
    except csv.Error:
        dialect = csv.excel
    return [[list(r) for r in csv.reader(text.splitlines(), dialect)]]


def _find_header(row: List[Any]) -> Optional[int]:
    """Index of the cell holding 1 when the row contains 1..12 in consecutive cells."""
    texts = [_cell_text(v) for v in row]
    for i in range(len(texts) - 11):
        if texts[i:i + 12] == [str(c) for c in COLS]:
            return i
    return None


def _blocks(rows: List[List[Any]]) -> List[tuple]:
    found = []
    for r, row in enumerate(rows):
        start = _find_header(row)
        if start is None or start == 0 or r + 8 >= len(rows) + 1:
            continue
        body = rows[r + 1:r + 9]
        if len(body) < 8:
            continue
        if [_cell_text(b[start - 1]).upper() if len(b) >= start else "" for b in body] != list(ROWS):
            continue
        found.append((r, start))
    return found


def _metadata(rows: List[List[Any]], until: int) -> Dict[str, Any]:
    meta: Dict[str, Any] = {}
    for row in rows[:until]:
        cells = [c for c in row if _cell_text(c)]
        if not cells:
            continue
        key = _cell_text(cells[0]).rstrip(":").strip().lower()
        if key in _META_KEYS and len(cells) > 1:
            name = _META_KEYS[key]
            value = cells[1]
            meta[name] = _number(value) if name == "temperature" else _cell_text(value)
            continue
        m = re.match(r"wavelengths?:\s*(.+)", _cell_text(cells[0]), re.I)
        if m:
            meta["wavelength"] = m.group(1).strip()
    return meta


def _notes(rows: List[List[Any]], after: int) -> List[str]:
    notes = []
    for row in rows[after:]:
        text = " ".join(_cell_text(c) for c in row if _cell_text(c))
        if text:
            notes.append(text)
    return notes


def read_plates(path: Path) -> List[PlateRead]:
    """Every labelled 8x12 block in the file (several reads per sheet are possible)."""
    reads: List[PlateRead] = []
    for rows in _sheets(Path(path)):
        blocks = _blocks(rows)
        for k, (r, start) in enumerate(blocks):
            values: Dict[str, Optional[float]] = {}
            label = None
            for i, row_letter in enumerate(ROWS):
                row = rows[r + 1 + i]
                for c in COLS:
                    idx = start + c - 1
                    values[f"{row_letter}{c}"] = _number(row[idx]) if idx < len(row) else None
                if label is None and start + 12 < len(row) and _cell_text(row[start + 12]):
                    label = _cell_text(row[start + 12])
            next_block = blocks[k + 1][0] if k + 1 < len(blocks) else len(rows)
            reads.append(PlateRead(
                values=values,
                label=label,
                metadata=_metadata(rows, r) if k == 0 else {},
                notes=_notes(rows[:next_block], r + 9),
            ))
    return reads


def read_plate(path: Path) -> PlateRead:
    reads = read_plates(path)
    if not reads:
        raise PlateReadError("No 8×12 plate block found (expected a header row 1–12 and rows labelled A–H).")
    return reads[0]


_RANGE = re.compile(r"^\s*(?:rows?\s+)?([A-H])\s*[-–]\s*([A-H])\s*[:\-–]?\s*(.+?)\s*$", re.I)
_SINGLE = re.compile(r"^\s*(?:row\s+)?([A-H])\s*[:\-–]\s*(.+?)\s*$", re.I)


def parse_layout_notes(notes: List[str]) -> List[Dict[str, Any]]:
    """Notes such as "A-C - LacGlyDOH 5:1:1" -> [{"name": ..., "rows": ["A", "B", "C"]}]."""
    groups = []
    for line in notes:
        m = _RANGE.match(line)
        if m:
            lo, hi, name = m.group(1).upper(), m.group(2).upper(), m.group(3)
            if ROWS.index(lo) <= ROWS.index(hi):
                groups.append({"name": name, "rows": list(ROWS[ROWS.index(lo):ROWS.index(hi) + 1])})
            continue
        m = _SINGLE.match(line)
        if m:
            groups.append({"name": m.group(2), "rows": [m.group(1).upper()]})
    return groups
