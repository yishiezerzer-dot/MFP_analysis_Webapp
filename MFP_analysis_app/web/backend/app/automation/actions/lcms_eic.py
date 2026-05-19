"""LCMS EIC automation actions."""
from __future__ import annotations

import asyncio
from typing import Dict, List, Optional

from ...services import lcms_service
from ..models import (
    LCMSCreateEICInput,
    LCMSCreateEICOutput,
    LCMSIntegrateEICDataInput,
    LCMSIntegrateEICDataOutput,
)
from ..registry import ActionInputError, ActionSpec, register
from .lcms_common import get_lcms_session


def integrate_eic_peak(rt_min: List[float], intensity: List[float], reference_rt: Optional[float] = None) -> Dict[str, float | int]:
    points = sorted(
        [
            (float(rt), float(intensity[index] if index < len(intensity) else 0.0))
            for index, rt in enumerate(rt_min)
            if rt is not None
        ],
        key=lambda point: point[0],
    )
    if not points:
        raise ActionInputError("EIC has no finite points")

    apex_index = 0
    if reference_rt is not None:
        local_maxes: List[int] = []
        for i, (_rt, inten) in enumerate(points):
            if inten <= 0:
                continue
            prev = points[i - 1][1] if i > 0 else float("-inf")
            nxt = points[i + 1][1] if i < len(points) - 1 else float("-inf")
            if inten >= prev and inten >= nxt:
                local_maxes.append(i)
        if local_maxes:
            apex_index = min(local_maxes, key=lambda i: abs(points[i][0] - float(reference_rt)))
        else:
            apex_index = max(range(len(points)), key=lambda i: points[i][1])
    else:
        apex_index = max(range(len(points)), key=lambda i: points[i][1])

    height = points[apex_index][1]
    start = apex_index
    while start > 0 and points[start - 1][1] <= points[start][1]:
        start -= 1
    end = apex_index
    while end < len(points) - 1 and points[end + 1][1] <= points[end][1]:
        end += 1

    outside = [points[i][1] for i in range(0, start)] + [points[i][1] for i in range(end + 1, len(points))]
    if len(outside) >= 5:
        outside.sort()
        baseline = outside[len(outside) // 2]
    else:
        edge_candidates = [points[start][1], points[end][1]]
        if start > 0:
            edge_candidates.append(points[start - 1][1])
        if end < len(points) - 1:
            edge_candidates.append(points[end + 1][1])
        baseline = min(edge_candidates) if edge_candidates else 0.0
    baseline = max(0.0, float(baseline))

    peak_signal = max(0.0, height - baseline)
    threshold = baseline + peak_signal * 0.05
    while start < apex_index and points[start][1] < threshold:
        start += 1
    while end > apex_index and points[end][1] < threshold:
        end -= 1
    if start == end:
        start = max(0, start - 1)
        end = min(len(points) - 1, end + 1)

    area = 0.0
    for i in range(start, end):
        y0 = max(0.0, points[i][1] - baseline)
        y1 = max(0.0, points[i + 1][1] - baseline)
        dx = max(0.0, points[i + 1][0] - points[i][0])
        area += ((y0 + y1) / 2.0) * dx

    return {
        "rt_start": points[start][0],
        "rt_apex": points[apex_index][0],
        "rt_end": points[end][0],
        "height": float(height),
        "area": float(area),
        "baseline": float(baseline),
        "n_points": int(end - start + 1),
    }


@register(
    ActionSpec(
        id="lcms.create_eic",
        summary="Create an extracted ion chromatogram for one LCMS session.",
        input_model=LCMSCreateEICInput,
        output_model=LCMSCreateEICOutput,
        risk="safe",
        scope="backend",
    )
)
async def create_eic(args: LCMSCreateEICInput) -> LCMSCreateEICOutput:
    def work() -> LCMSCreateEICOutput:
        state = get_lcms_session(args.session_id)
        return LCMSCreateEICOutput(
            **lcms_service.extracted_ion_chromatogram(
                state,
                float(args.mz),
                tolerance=float(args.tolerance),
                polarity=args.polarity,
            )
        )

    return await asyncio.to_thread(work)


@register(
    ActionSpec(
        id="lcms.integrate_eic_data",
        summary="Integrate a supplied EIC payload.",
        input_model=LCMSIntegrateEICDataInput,
        output_model=LCMSIntegrateEICDataOutput,
        risk="safe",
        scope="backend",
    )
)
async def integrate_eic_data(args: LCMSIntegrateEICDataInput) -> LCMSIntegrateEICDataOutput:
    def work() -> LCMSIntegrateEICDataOutput:
        if args.session_id:
            get_lcms_session(args.session_id)
        return LCMSIntegrateEICDataOutput(
            **integrate_eic_peak(args.eic.rt_min, args.eic.intensity, args.reference_rt)
        )

    return await asyncio.to_thread(work)

