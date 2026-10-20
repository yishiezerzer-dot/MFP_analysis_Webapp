"""Files from a pipeline result: the labelled UV figure (SVG, PNG) and the peak workbook (xlsx)."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List

from matplotlib.figure import Figure
from openpyxl import Workbook
from openpyxl.styles import Font

from .lcms_pipeline import PipelineResult, apply_layout, displayed_labels, plot_frame

MARGIN = {"left": 70.0, "right": 20.0, "top": 40.0, "bottom": 50.0}
DPI = 100.0
PRINT_SIZE_MM = (180.0, 100.0)  # the lab's publication export
PRINT_DPI = 600
_BOLD = Font(bold=True)
# The lab's figure style: slate labels, faint leaders (full-strength lines hide small peaks).
_STATUS_COLOUR = {"ok": "#46536a", "flagged": "#b45309", "alternative": "#6b7280"}
_LEADER = {"color": "#334155", "alpha": 0.3, "lw": 0.8}


def build_figure(result: PipelineResult) -> Figure:
    """UV trace with the approved labels where the layout put them (same pixel frame as the app)."""
    frame = plot_frame(result)
    w = MARGIN["left"] + frame.width_px + MARGIN["right"]
    h = MARGIN["top"] + frame.height_px + MARGIN["bottom"]
    shown = displayed_labels(result)
    callouts = sorted((lab for lab in shown if lab.layout and lab.layout.callout), key=lambda lab: lab.layout.callout)
    footnote = "   ".join(f"{lab.layout.callout}: {lab.text}" for lab in callouts)
    if footnote:
        h += 16.0 * (1 + len(footnote) // 140)
    fig = Figure(figsize=(w / DPI, h / DPI), dpi=DPI)
    ax = fig.add_axes((MARGIN["left"] / w, (h - MARGIN["top"] - frame.height_px) / h, frame.width_px / w, frame.height_px / h))
    ax.plot(result.uv_rt, result.uv_signal, color="#1e2636", lw=1.0)
    ax.set_xlim(frame.x_min, frame.x_max)
    ax.set_ylim(frame.y_min, frame.y_max)
    ax.set_xlabel("Retention time, UV (min)")
    ax.set_ylabel("UV signal")
    ax.spines[["top", "right"]].set_visible(False)
    ax.grid(False)
    ax.set_title(
        f"{result.display_name} · {result.polarity} · UV→MS offset {result.alignment.offset_min:+.3f} min",
        fontsize=10, loc="left",
    )
    peak_by_id = {p.id: p for p in result.peaks}
    font_pt = result.settings.layout.font_px * 72.0 / DPI
    for lab in shown:
        if lab.layout is None:
            continue
        peak = peak_by_id[lab.peak_id]
        px, py = frame.x_px(peak.rt_min), frame.y_px(peak.apex)
        ax.annotate(
            lab.layout.shown_text,
            xy=(peak.rt_min, peak.apex),
            xytext=(frame.x_data(px + lab.layout.ax), frame.y_data(py + lab.layout.ay)),
            textcoords="data",
            ha="center",
            va="center",
            rotation=90 if result.settings.layout.orientation == "vertical" else 0,
            fontsize=font_pt,
            color=_STATUS_COLOUR.get(lab.status, "#111827"),
            arrowprops={"arrowstyle": "-", **_LEADER, "shrinkA": 0, "shrinkB": 0},
            annotation_clip=False,
        )
    if footnote:
        fig.text(MARGIN["left"] / w, 4 / h, footnote, fontsize=7, va="bottom", wrap=True)
    return fig


def sized_for_print(result: PipelineResult, size_mm: tuple[float, float] = PRINT_SIZE_MM) -> PipelineResult:
    """A copy whose plot area makes the whole figure size_mm, with the labels laid out again for it."""
    copy = result.model_copy(deep=True)
    copy.settings.layout = copy.settings.layout.model_copy(update={
        "plot_width_px": size_mm[0] / 25.4 * DPI - MARGIN["left"] - MARGIN["right"],
        "plot_height_px": size_mm[1] / 25.4 * DPI - MARGIN["top"] - MARGIN["bottom"],
    })
    apply_layout(copy)
    return copy


def write_figures(result: PipelineResult, out_dir: Path) -> None:
    fig = build_figure(result)
    fig.savefig(out_dir / "figure.svg", format="svg")
    fig.savefig(out_dir / "figure.png", format="png", dpi=200)
    build_figure(sized_for_print(result)).savefig(out_dir / "figure-print.png", format="png", dpi=PRINT_DPI)


def _sheet(wb: Workbook, title: str, header: List[str], rows: List[List[Any]]) -> None:
    ws = wb.create_sheet(title=title)
    ws.append(header)
    for cell in ws[1]:
        cell.font = _BOLD
    for row in rows:
        ws.append(row)
    for col in ws.columns:
        width = max(len(str(c.value or "")) for c in col)
        ws.column_dimensions[col[0].column_letter].width = min(max(width + 2, 8), 70)
    ws.freeze_panes = "A2"


def _flatten(prefix: str, value: Any, out: List[List[Any]]) -> None:
    if isinstance(value, dict):
        for k, v in value.items():
            _flatten(f"{prefix}.{k}" if prefix else str(k), v, out)
    elif isinstance(value, list) and value and isinstance(value[0], dict):
        out.append([prefix, json.dumps(value)])
    else:
        out.append([prefix, ", ".join(map(str, value)) if isinstance(value, list) else value])


def write_workbook(result: PipelineResult, path: Path, provenance: Dict[str, Any]) -> None:
    wb = Workbook()
    wb.remove(wb.active)
    labels_by_peak: Dict[str, list] = {}
    for lab in result.labels:
        labels_by_peak.setdefault(lab.peak_id, []).append(lab)
    peak_rows = []
    for p in result.peaks:
        top = next((lab for lab in labels_by_peak.get(p.id, []) if lab.rank == 1), None)
        peak_rows.append([
            p.id, round(p.rt_min, 4), round(p.ms_rt_min, 4), p.apex, round(p.start_min, 4), round(p.end_min, 4),
            round(p.width_min, 4), p.area, round(p.sn, 1), round(100 * p.prominence_rel, 2), p.n_scans,
            top.text if top else "", top.status if top else "", top.review if top else "", "; ".join(p.reasons),
        ])
    _sheet(wb, "Peaks", [
        "Peak", "UV RT (min)", "MS RT (min)", "Apex", "Start (min)", "End (min)", "FWHM (min)", "Area", "S/N",
        "Prominence (% of largest)", "MS scans summed", "Top label", "Status", "Review", "Peak reasons",
    ], peak_rows)
    cand_rows = []
    for lab in result.labels:
        cand_rows.append([
            lab.id, lab.peak_id, lab.rank, lab.text, lab.species, lab.series, lab.dp, lab.adduct, round(lab.mz, 4),
            round(lab.abs_err_da, 4), round(100 * lab.rel_intensity, 2), round(lab.score, 4),
            None if lab.eic_apex_rt_min is None else round(lab.eic_apex_rt_min, 4), lab.eic_shape_r, round(lab.series_support, 2),
            ", ".join(map(str, lab.support_members)), lab.status, lab.review, "; ".join(lab.reasons),
            lab.layout.callout if lab.layout and lab.layout.callout else None,
            "; ".join(f"{i.text} ({100 * i.rel_intensity:.1f}%)" for i in lab.ions),
        ])
    _sheet(wb, "Candidates", [
        "Label", "Peak", "Rank", "Label text", "Species", "Series", "DP", "Adduct", "m/z", "|Δm| (Da)",
        "Intensity (% of base peak)", "Score", "EIC apex (min)", "EIC–UV shape r", "Series support", "Lower DPs found", "Status",
        "Review", "Reasons", "Callout no.", "All ions",
    ], cand_rows)
    settings_rows: List[List[Any]] = []
    _flatten("", result.settings.model_dump(), settings_rows)
    settings_rows.append(["alignment.offset_min", result.alignment.offset_min])
    settings_rows.append(["alignment.method", result.alignment.method])
    settings_rows.append(["uv_noise_sigma", result.uv_noise])
    for key, value in provenance.items():
        settings_rows.append([f"provenance.{key}", value])
    _sheet(wb, "Settings", ["Setting", "Value"], settings_rows)
    wb.save(path)


def write_outputs(result: PipelineResult, out_dir: Path, provenance: Dict[str, Any]) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "result.json").write_text(result.model_dump_json(), encoding="utf-8")
    write_figures(result, out_dir)
    write_workbook(result, out_dir / "peaks.xlsx", provenance)
