"""LCMS Kendrick mass defect automation action."""
from __future__ import annotations

import asyncio
from typing import Dict, List

import numpy as np

from ...services import lcms_service
from ..models import (
    LCMSComputeKendrickPlotInput,
    LCMSComputeKendrickPlotOutput,
    LCMSKendrickPoint,
    LCMSKendrickSeries,
)
from ..registry import ActionSpec, register
from .lcms_common import get_lcms_session

KENDRICK_POINT_LIMIT = 8000


def build_kendrick_points(
    mz: np.ndarray,
    intensity: np.ndarray,
    *,
    repeat_mass: float,
    min_rel_intensity: float,
    tolerance_value: float,
    tolerance_unit: str,
    min_series_points: int,
) -> Dict[str, object]:
    max_intensity = float(np.nanmax(intensity)) if intensity.size else 0.0
    if max_intensity <= 0.0:
        return {"points": [], "series": [], "truncated": False}
    threshold = max_intensity * (max(0.0, float(min_rel_intensity)) / 100.0)
    nominal_repeat_mass = max(1, int(round(float(repeat_mass))))
    scale = nominal_repeat_mass / float(repeat_mass)
    raw: List[LCMSKendrickPoint] = []
    for index, (mz_value, inten_value) in enumerate(zip(mz.tolist(), intensity.tolist())):
        if not np.isfinite(mz_value) or not np.isfinite(inten_value) or float(inten_value) < threshold:
            continue
        kendrick_mass = float(mz_value) * scale
        kendrick_nominal_mass = int(round(kendrick_mass))
        raw.append(
            LCMSKendrickPoint(
                id=f"{index}-{float(mz_value):.6f}",
                mz=float(mz_value),
                intensity=float(inten_value),
                rel_intensity=(float(inten_value) / max_intensity) * 100.0,
                kendrick_mass=kendrick_mass,
                kendrick_nominal_mass=kendrick_nominal_mass,
                kmd=float(kendrick_nominal_mass - kendrick_mass),
                series_id=None,
            )
        )
    truncated = len(raw) > KENDRICK_POINT_LIMIT
    points = sorted(sorted(raw, key=lambda p: p.intensity, reverse=True)[:KENDRICK_POINT_LIMIT], key=lambda p: p.kmd)

    def tol_for(point: LCMSKendrickPoint) -> float:
        if tolerance_unit == "ppm":
            return max(1e-9, float(tolerance_value) * 1e-6 * point.mz * scale)
        return max(1e-9, float(tolerance_value))

    clusters: List[List[LCMSKendrickPoint]] = []
    running_sum = 0.0
    running_count = 0
    for point in points:
        mean = running_sum / running_count if running_count else point.kmd
        if running_count == 0 or abs(point.kmd - mean) > tol_for(point):
            clusters.append([point])
            running_sum = point.kmd
            running_count = 1
        else:
            clusters[-1].append(point)
            running_sum += point.kmd
            running_count += 1

    series: List[LCMSKendrickSeries] = []
    for cluster in clusters:
        if len(cluster) < int(min_series_points):
            continue
        series_id = len(series) + 1
        center = sum(point.kmd for point in cluster) / len(cluster)
        max_cluster_intensity = max(point.intensity for point in cluster)
        for point in cluster:
            point.series_id = series_id
        series.append(
            LCMSKendrickSeries(
                id=series_id,
                center=float(center),
                count=len(cluster),
                max_intensity=float(max_cluster_intensity),
            )
        )
    return {
        "points": sorted(points, key=lambda p: p.mz),
        "series": series,
        "truncated": truncated,
    }


@register(
    ActionSpec(
        id="lcms.compute_kendrick_plot",
        summary="Compute Kendrick mass defect plot points and series.",
        input_model=LCMSComputeKendrickPlotInput,
        output_model=LCMSComputeKendrickPlotOutput,
        risk="safe",
        scope="backend",
    )
)
async def compute_kendrick_plot(args: LCMSComputeKendrickPlotInput) -> LCMSComputeKendrickPlotOutput:
    def work() -> LCMSComputeKendrickPlotOutput:
        state = get_lcms_session(args.session_id)
        meta, mz, intensity = lcms_service.fetch_spectrum_at_rt(state, float(args.rt_min), polarity=args.polarity)
        result = build_kendrick_points(
            np.asarray(mz, dtype=float),
            np.asarray(intensity, dtype=float),
            repeat_mass=float(args.repeat_mass),
            min_rel_intensity=float(args.min_rel_intensity),
            tolerance_value=float(args.tolerance_value),
            tolerance_unit=args.tolerance_unit,
            min_series_points=int(args.min_series_points),
        )
        return LCMSComputeKendrickPlotOutput(
            meta=meta,
            repeat_mass=float(args.repeat_mass),
            nominal_repeat_mass=max(1, int(round(float(args.repeat_mass)))),
            points=result["points"],
            series=result["series"],
            truncated=bool(result["truncated"]),
        )

    return await asyncio.to_thread(work)

