"""LCMS feature table and comparison matrix automation actions."""
from __future__ import annotations

import asyncio
from typing import Dict, List, Optional

from ..models import (
    LCMSBuildComparisonMatrixInput,
    LCMSBuildComparisonMatrixOutput,
    LCMSFeatureMatrixCell,
    LCMSFeatureMatrixGroup,
    LCMSFeatureRow,
)
from ..registry import ActionSpec, register
from .lcms_common import get_lcms_session
from ...services.lcms_service import registry


def feature_value(row: LCMSFeatureRow, metric: str) -> float:
    return float(row.area if metric == "area" else row.height)


def group_feature_rows_for_matrix(
    rows: List[LCMSFeatureRow],
    *,
    metric: str,
    group_mode: str,
    mz_tolerance: float,
) -> LCMSBuildComparisonMatrixOutput:
    sessions = registry.list()
    session_by_id = {session.session_id: session for session in sessions}
    column_ids: List[str] = []
    column_labels: Dict[str, str] = {}
    for session in sessions:
        column_ids.append(session.session_id)
        column_labels[session.session_id] = session.display_name

    for row in rows:
        column_id = row.session_id if row.session_id and row.session_id in session_by_id else f"file:{row.source_file or 'unknown'}"
        if column_id not in column_ids:
            column_ids.append(column_id)
        column_labels.setdefault(column_id, column_id[5:] if column_id.startswith("file:") else column_id)

    def evidence_key(row: LCMSFeatureRow) -> Optional[str]:
        evidence = (row.expected_product or row.label or "").strip()
        if not evidence:
            return None
        return "|".join(["ev", evidence.lower(), (row.annotation or "").strip().lower(), row.polarity or ""])

    tolerance = max(1e-6, float(mz_tolerance))
    groups: List[LCMSFeatureMatrixGroup] = []
    for row in rows:
        column_id = row.session_id if row.session_id and row.session_id in session_by_id else f"file:{row.source_file or 'unknown'}"
        key = evidence_key(row) if group_mode == "evidence" else None
        group: Optional[LCMSFeatureMatrixGroup] = None
        if key:
            group = next((item for item in groups if item.id == key), None)
        if group is None:
            # Compare against the group's anchor m/z (its seed row's m/z), NOT a
            # running mean. Running-mean clustering is transitive: a chain of
            # rows each within tolerance of the previous can collapse into one
            # group whose endpoints differ by far more than the tolerance.
            for item in groups:
                if item.id.startswith("ev|"):
                    continue
                if (item.polarity or "") != (row.polarity or ""):
                    continue
                if abs(float(item.anchor_mz) - float(row.mz)) <= tolerance:
                    group = item
                    break
        if group is None:
            label = row.expected_product or row.label or f"m/z {row.mz:.4f}"
            group = LCMSFeatureMatrixGroup(
                id=key or f"mz-{len(groups)}-{row.mz:.4f}-{row.polarity or 'unk'}",
                label=label,
                annotation=row.annotation or "",
                polarity=row.polarity,
                mz=float(row.mz),
                rt_apex=float(row.rt_apex),
                anchor_mz=float(row.mz),
                rt_min=float(row.rt_apex),
                rt_max=float(row.rt_apex),
                rows=[],
                cells={},
            )
            groups.append(group)
        group.rows.append(row)
        group.mz = sum(float(item.mz) for item in group.rows) / len(group.rows)
        group.rt_apex = sum(float(item.rt_apex) for item in group.rows) / len(group.rows)
        if float(row.rt_apex) < group.rt_min:
            group.rt_min = float(row.rt_apex)
        if float(row.rt_apex) > group.rt_max:
            group.rt_max = float(row.rt_apex)
        if not group.annotation and row.annotation:
            group.annotation = row.annotation
        previous = group.cells.get(column_id)
        if previous is None:
            group.cells[column_id] = LCMSFeatureMatrixCell(row=row, collisions=[])
        else:
            # Multiple rows landed in the same (group, sample) cell. Pick the
            # larger by metric as the headline value, but keep the others so
            # callers can surface a "+N more" badge or sum them if they prefer.
            if feature_value(row, metric) > feature_value(previous.row, metric):
                group.cells[column_id] = LCMSFeatureMatrixCell(
                    row=row,
                    collisions=[previous.row, *previous.collisions],
                )
            else:
                previous.collisions.append(row)

    groups.sort(key=lambda item: (item.mz, item.label))
    return LCMSBuildComparisonMatrixOutput(groups=groups, column_ids=column_ids, column_labels=column_labels)


@register(
    ActionSpec(
        id="lcms.build_comparison_matrix",
        summary="Group integrated LCMS feature rows into a comparison matrix.",
        input_model=LCMSBuildComparisonMatrixInput,
        output_model=LCMSBuildComparisonMatrixOutput,
        risk="safe",
        scope="backend",
    )
)
async def build_comparison_matrix(args: LCMSBuildComparisonMatrixInput) -> LCMSBuildComparisonMatrixOutput:
    def work() -> LCMSBuildComparisonMatrixOutput:
        if args.session_id:
            get_lcms_session(args.session_id)
        return group_feature_rows_for_matrix(
            args.rows,
            metric=args.metric,
            group_mode=args.group_mode,
            mz_tolerance=float(args.mz_tolerance),
        )

    return await asyncio.to_thread(work)

