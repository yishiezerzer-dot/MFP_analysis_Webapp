"""LCMS CSV export automation actions."""
from __future__ import annotations

import asyncio
from typing import Any, List

from ..models import (
    LCMSExportCSVOutput,
    LCMSExportComparisonMatrixCSVInput,
    LCMSExportFeatureTableCSVInput,
)
from ..registry import ActionSpec, register
from .lcms_common import get_lcms_session
from .lcms_features import feature_value, group_feature_rows_for_matrix


def escape_csv(value: Any) -> str:
    text = "" if value is None else str(value)
    if any(ch in text for ch in [",", "\"", "\n", "\r"]):
        return "\"" + text.replace("\"", "\"\"") + "\""
    return text


def rows_to_csv(rows: List[List[Any]]) -> str:
    return "\n".join(",".join(escape_csv(value) for value in row) for row in rows)


@register(
    ActionSpec(
        id="lcms.export_feature_table_csv",
        summary="Export supplied integrated LCMS feature rows as CSV text.",
        input_model=LCMSExportFeatureTableCSVInput,
        output_model=LCMSExportCSVOutput,
        risk="safe",
        scope="backend",
    )
)
async def export_feature_table_csv(args: LCMSExportFeatureTableCSVInput) -> LCMSExportCSVOutput:
    def work() -> LCMSExportCSVOutput:
        if args.session_id:
            get_lcms_session(args.session_id)
        rows: List[List[Any]] = [[
            "FeatureID",
            "SourceFile",
            "mz",
            "ToleranceDa",
            "Polarity",
            "RTApexMin",
            "RTStartMin",
            "RTEndMin",
            "Height",
            "Area",
            "Baseline",
            "NPoints",
            "Source",
            "Label",
            "ExpectedProduct",
            "Annotation",
            "CreatedAt",
        ]]
        for row in args.rows:
            rows.append([
                row.id,
                row.source_file,
                f"{row.mz:.6f}",
                f"{row.tolerance:.6f}",
                row.polarity,
                f"{row.rt_apex:.5f}",
                f"{row.rt_start:.5f}",
                f"{row.rt_end:.5f}",
                f"{row.height:.6e}",
                f"{row.area:.6e}",
                f"{row.baseline:.6e}",
                row.n_points,
                row.source,
                row.label,
                row.expected_product,
                row.annotation,
                row.created_at,
            ])
        return LCMSExportCSVOutput(filename="lcms_feature_table.csv", csv=rows_to_csv(rows))

    return await asyncio.to_thread(work)


def _format_rt_range(group) -> str:
    spread = float(group.rt_max) - float(group.rt_min)
    if spread > 0.01:
        return f"{group.rt_min:.3f}-{group.rt_max:.3f}"
    return f"{group.rt_apex:.3f}"


@register(
    ActionSpec(
        id="lcms.export_comparison_matrix_csv",
        summary="Export an LCMS comparison matrix as CSV text.",
        input_model=LCMSExportComparisonMatrixCSVInput,
        output_model=LCMSExportCSVOutput,
        risk="safe",
        scope="backend",
    )
)
async def export_comparison_matrix_csv(args: LCMSExportComparisonMatrixCSVInput) -> LCMSExportCSVOutput:
    def format_cell(cell, max_value: float) -> str:
        if cell is None:
            return ""
        value = feature_value(cell.row, args.metric)
        if args.normalize_rows and max_value > 0:
            return f"{(value / max_value) * 100:.1f}%"
        return f"{value:.2e}" if value >= 1000 or value < 0.01 else f"{value:.2f}"

    def work() -> LCMSExportCSVOutput:
        if args.session_id:
            get_lcms_session(args.session_id)
        matrix = group_feature_rows_for_matrix(
            args.rows,
            metric=args.metric,
            group_mode=args.group_mode,
            mz_tolerance=float(args.mz_tolerance),
        )
        rows: List[List[Any]] = [[
            "Feature",
            "Annotation",
            "MeanMz",
            "RTRangeMin",
            "Polarity",
            "Metric",
            "Normalized",
            *[matrix.column_labels.get(column_id, column_id) for column_id in matrix.column_ids],
        ]]
        for group in matrix.groups:
            cell_max = 0.0
            for cell in group.cells.values():
                value = feature_value(cell.row, args.metric)
                if value > cell_max:
                    cell_max = value
            rows.append([
                group.label,
                group.annotation,
                f"{group.mz:.6f}",
                _format_rt_range(group),
                group.polarity,
                args.metric,
                "yes" if args.normalize_rows else "no",
                *[format_cell(group.cells.get(column_id), cell_max) for column_id in matrix.column_ids],
            ])
        return LCMSExportCSVOutput(filename="lcms_comparison_matrix.csv", csv=rows_to_csv(rows))

    return await asyncio.to_thread(work)

