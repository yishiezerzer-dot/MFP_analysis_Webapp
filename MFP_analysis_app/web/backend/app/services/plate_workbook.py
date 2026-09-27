"""Calculation workbook for a plate: the raw plate plus every derived number as a live Excel formula.

Opening it in Excel (or LibreOffice) recomputes blank, growth control, mean, SD and % growth from
the raw OD values, so the analysis can be audited or redone by hand.
"""
from __future__ import annotations

import io
from typing import Any, Dict, List

import openpyxl
from openpyxl.styles import Font
from openpyxl.utils import get_column_letter

from lab_gui.plate_gen5 import ROWS, PlateRead
from lab_gui.plate_mic import PlateLayout, well_concentration

_BOLD = Font(bold=True)


def _raw_ref(well: str) -> str:
    row, col = well[0], int(well[1:])
    return f"'Raw plate'!{get_column_letter(1 + col)}{3 + ROWS.index(row)}"


def build_workbook(read: PlateRead, layout: PlateLayout, analysis: Dict[str, Any], *, subtract_blank: bool) -> bytes:
    excluded = set(layout.excluded)
    usable = lambda w: w not in excluded and read.values.get(w) is not None  # noqa: E731
    wb = openpyxl.Workbook()

    raw = wb.active
    raw.title = "Raw plate"
    raw["A1"] = "OD as imported" + (f" ({read.label} nm)" if read.label else "")
    raw["A1"].font = _BOLD
    for c in range(1, 13):
        raw.cell(row=2, column=1 + c, value=c).font = _BOLD
    for i, r in enumerate(ROWS):
        raw.cell(row=3 + i, column=1, value=r).font = _BOLD
        for c in range(1, 13):
            raw.cell(row=3 + i, column=1 + c, value=read.values.get(f"{r}{c}"))
    meta_row = 12
    for key, value in (read.metadata or {}).items():
        raw.cell(row=meta_row, column=1, value=key)
        raw.cell(row=meta_row, column=2, value=value)
        meta_row += 1

    lay = wb.create_sheet("Layout")
    lay.append(["Well", "Group", "Role", f"Concentration ({layout.dilution.unit})", "Excluded"])
    roles: Dict[str, tuple] = {}
    for g in layout.groups:
        for w in g.wells:
            roles[w] = (g.name, g.kind)
    for w in layout.growth_control:
        roles[w] = ("", "growth control")
    for w in layout.blank:
        roles[w] = ("", "blank")
    for r in ROWS:
        for c in range(1, 13):
            w = f"{r}{c}"
            name, role = roles.get(w, ("", ""))
            conc = well_concentration(w, layout.dilution) if role in ("sample", "reference") else None
            lay.append([w, name, role, conc, "yes" if w in excluded else ""])

    ctl = wb.create_sheet("Controls")
    blank_wells = [w for w in layout.blank if usable(w)]
    ctl["A1"] = "Blank (mean of blank wells)" if (subtract_blank and blank_wells) else "Blank (not subtracted)"
    ctl["B1"] = f"=AVERAGE({','.join(_raw_ref(w) for w in blank_wells)})" if (subtract_blank and blank_wells) else 0
    ctl["C1"] = ", ".join(blank_wells)
    ctl.append([])
    ctl.append(["Group", "Growth control mean (blank-subtracted)", "Wells"])
    gc_row: Dict[str, int] = {}
    for g in analysis["groups"]:
        wells = g["growth_control"]["wells"]
        ctl.append([g["name"], f"=AVERAGE({','.join(_raw_ref(w) for w in wells)})-'Controls'!$B$1" if wells else None, ", ".join(wells)])
        gc_row[g["name"]] = ctl.max_row

    calc = wb["Calculation"] if "Calculation" in wb.sheetnames else wb.create_sheet("Calculation", 1)
    header = ["Group", "Concentration", "Unit", "n", "Mean OD (blank-subtracted)", "SD", "% growth", "Wells used"]
    calc.append(header)
    for cell in calc[1]:
        cell.font = _BOLD
    for g in analysis["groups"]:
        for p in g["points"]:
            used = [x["well"] for x in p["wells"] if not x["excluded"] and usable(x["well"])]
            refs = ",".join(_raw_ref(w) for w in used)
            row = calc.max_row + 1
            calc.append([
                g["name"],
                p["concentration"],
                layout.dilution.unit,
                f"=COUNT({refs})" if used else 0,
                f"=AVERAGE({refs})-'Controls'!$B$1" if used else None,
                f"=STDEV.S({refs})" if len(used) > 1 else None,
                f"=E{row}/'Controls'!$B${gc_row[g['name']]}*100" if used and g["growth_control"]["wells"] else None,
                ", ".join(used),
            ])

    chk = wb.create_sheet("Checks")
    chk.append(["Level", "Check"])
    for c in analysis["checks"]:
        chk.append([c["level"], c["message"]])

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
