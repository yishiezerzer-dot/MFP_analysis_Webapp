"""LCMS spectrum, TIC, and m/z automation actions."""
from __future__ import annotations

import asyncio
from typing import Any, Dict, List

import numpy as np

from ...services import lcms_service
from ..models import (
    LCMSFindMzInput,
    LCMSFindMzOutput,
    LCMSGetSpectrumAtRTInput,
    LCMSGetSpectrumAtRTOutput,
    LCMSGetTICInput,
    LCMSGetTICOutput,
    LCMSSumTICRegionSpectrumInput,
    LCMSSumTICRegionSpectrumOutput,
    LCMSTopSpectrumPeaksInput,
    LCMSTopSpectrumPeaksOutput,
)
from ..registry import ActionSpec
from ..registry import register
from .lcms_common import get_lcms_session, tic_payload


def _spectrum_payload(args: LCMSGetSpectrumAtRTInput) -> Dict[str, Any]:
    state = get_lcms_session(args.session_id)
    meta, mz, intensity = lcms_service.fetch_spectrum_at_rt(
        state,
        float(args.rt_min),
        polarity=args.polarity,
    )
    labels = [
        {**label, "source": "auto"}
        for label in lcms_service.top_n_peaks(
            mz,
            intensity,
            n=int(args.top_n),
            min_rel=float(args.min_rel),
        )
    ]
    polymer_labels: List[Dict[str, Any]] = []
    if args.polymer_settings:
        polymer_labels = lcms_service.polymer_match_labels(
            mz,
            intensity,
            polarity=meta.get("polarity"),
            settings=args.polymer_settings,
        )
    return {
        "meta": meta,
        "mz": [float(v) for v in mz.tolist()],
        "intensity": [float(v) for v in intensity.tolist()],
        "labels": labels + polymer_labels,
        "polymer_labels": polymer_labels,
    }


@register(
    ActionSpec(
        id="lcms.get_tic",
        summary="Return TIC arrays for one LCMS session.",
        input_model=LCMSGetTICInput,
        output_model=LCMSGetTICOutput,
        risk="safe",
        scope="backend",
    )
)
async def get_tic(args: LCMSGetTICInput) -> LCMSGetTICOutput:
    def work() -> LCMSGetTICOutput:
        state = get_lcms_session(args.session_id)
        return LCMSGetTICOutput(**tic_payload(state, args.polarity))

    return await asyncio.to_thread(work)


@register(
    ActionSpec(
        id="lcms.get_spectrum_at_rt",
        summary="Return the MS1 spectrum nearest a retention time.",
        input_model=LCMSGetSpectrumAtRTInput,
        output_model=LCMSGetSpectrumAtRTOutput,
        risk="safe",
        scope="backend",
    )
)
async def get_spectrum_at_rt(args: LCMSGetSpectrumAtRTInput) -> LCMSGetSpectrumAtRTOutput:
    def work() -> LCMSGetSpectrumAtRTOutput:
        return LCMSGetSpectrumAtRTOutput(**_spectrum_payload(args))

    return await asyncio.to_thread(work)


@register(
    ActionSpec(
        id="lcms.get_top_spectrum_peaks",
        summary="Return top peaks from the MS1 spectrum nearest a retention time.",
        input_model=LCMSTopSpectrumPeaksInput,
        output_model=LCMSTopSpectrumPeaksOutput,
        risk="safe",
        scope="backend",
    )
)
async def get_top_spectrum_peaks(args: LCMSTopSpectrumPeaksInput) -> LCMSTopSpectrumPeaksOutput:
    def work() -> LCMSTopSpectrumPeaksOutput:
        state = get_lcms_session(args.session_id)
        meta, mz, intensity = lcms_service.fetch_spectrum_at_rt(
            state,
            float(args.rt_min),
            polarity=args.polarity,
        )
        peaks = lcms_service.top_n_peaks(
            np.asarray(mz, dtype=float),
            np.asarray(intensity, dtype=float),
            n=int(args.n),
            min_rel=float(args.min_rel),
        )
        return LCMSTopSpectrumPeaksOutput(meta=meta, peaks=peaks)

    return await asyncio.to_thread(work)


@register(
    ActionSpec(
        id="lcms.find_mz",
        summary="Find a target m/z across indexed MS1 scans.",
        input_model=LCMSFindMzInput,
        output_model=LCMSFindMzOutput,
        risk="safe",
        scope="backend",
    )
)
async def find_mz(args: LCMSFindMzInput) -> LCMSFindMzOutput:
    def work() -> LCMSFindMzOutput:
        state = get_lcms_session(args.session_id)
        return LCMSFindMzOutput(
            **lcms_service.find_mz_across_scans(
                state,
                float(args.mz),
                tolerance=float(args.tolerance),
                polarity=args.polarity,
            )
        )

    return await asyncio.to_thread(work)


@register(
    ActionSpec(
        id="lcms.sum_tic_region_spectrum",
        summary="Combine all MS1 scans in a TIC retention-time region.",
        input_model=LCMSSumTICRegionSpectrumInput,
        output_model=LCMSSumTICRegionSpectrumOutput,
        risk="safe",
        scope="backend",
    )
)
async def sum_tic_region_spectrum(args: LCMSSumTICRegionSpectrumInput) -> LCMSSumTICRegionSpectrumOutput:
    def work() -> LCMSSumTICRegionSpectrumOutput:
        state = get_lcms_session(args.session_id)
        payload = lcms_service.summed_spectrum_in_rt_range(
            state,
            rt_min=float(args.rt_min),
            rt_max=float(args.rt_max),
            polarity=args.polarity,
            bin_width=float(args.bin_width),
            min_rel=float(args.min_rel),
            max_bins=int(args.max_bins),
        )
        return LCMSSumTICRegionSpectrumOutput(**payload)

    return await asyncio.to_thread(work)

