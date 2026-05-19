"""LCMS polymer and expected-product automation actions."""
from __future__ import annotations

import asyncio
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

from lab_gui import lcms_polymer_match as poly_match

from ...services import lcms_service
from ..models import (
    LCMSComputeExpectedProductsOutput,
    LCMSExpectedProductHit,
    LCMSExpectedProductsInput,
    LCMSMatchPolymersForSpectrumOutput,
    LCMSSpectrumPolymerInput,
)
from ..registry import ActionSpec, register
from .lcms_common import get_lcms_session


def _parse_monomers(text: str) -> List[Tuple[str, float]]:
    out: List[Tuple[str, float]] = []
    for index, raw in enumerate(str(text or "").splitlines(), start=1):
        clean = raw.strip()
        if not clean:
            continue
        parts = clean.replace(",", " ").split()
        if not parts:
            continue
        try:
            mass = float(parts[-1])
        except ValueError:
            continue
        name = " ".join(parts[:-1]) or f"M{index}"
        out.append((name, mass))
    return out


def _parse_charges(text: str) -> List[int]:
    charges: List[int] = []
    for part in str(text or "1").replace(";", ",").split(","):
        try:
            value = int(part.strip())
        except ValueError:
            continue
        if value > 0:
            charges.append(value)
    return charges or [1]


def _tol_da(mz: float, settings: Dict[str, Any], resolution_mode: str, low_resolution_tolerance: float) -> float:
    value = max(0.0, float(settings.get("tol_value", 0.02) or 0.02))
    unit = str(settings.get("tol_unit") or "Da").lower()
    configured = abs(float(mz)) * value / 1e6 if unit == "ppm" else value
    if resolution_mode == "low":
        return max(configured, max(0.01, float(low_resolution_tolerance)))
    return configured


def _ion_label(core: str, adduct_label: str, adduct_mass: float, charge: int, polarity: Optional[str]) -> str:
    sign = "-" if polarity == "negative" else "+"
    suffix = sign if charge <= 1 else f"{charge}{sign}"
    label = str(adduct_label or "")
    if label:
        return f"[{core}{label}]{suffix}"
    if abs(float(adduct_mass) - poly_match.PROTON_MASS) <= 0.002:
        proton = "+H"
    elif abs(float(adduct_mass) + poly_match.PROTON_MASS) <= 0.002:
        proton = "-H"
    else:
        proton = f"{float(adduct_mass):+.4f}"
    return f"[{core}{proton}]{suffix}"


def _best_match(
    mz: np.ndarray,
    intensity: np.ndarray,
    target_mz: float,
    tolerance_da: float,
) -> Optional[poly_match.PeakMatch]:
    return poly_match.find_best_peak_match(
        mz,
        intensity,
        float(target_mz),
        tol_da=float(tolerance_da),
        prefer_intensity=True,
    )


def compute_expected_product_hits(
    mz: np.ndarray,
    intensity: np.ndarray,
    *,
    polarity: Optional[str],
    settings: Dict[str, Any],
    max_dp: int,
    resolution_mode: str,
    low_resolution_tolerance: float,
) -> List[LCMSExpectedProductHit]:
    monomers = _parse_monomers(str(settings.get("monomers_text") or ""))
    if not monomers:
        return []

    order = np.argsort(mz)
    mz_s = np.asarray(mz, dtype=float)[order]
    int_s = np.asarray(intensity, dtype=float)[order]
    names = [name for name, _mass in monomers]
    masses = [mass for _name, mass in monomers]
    charges = _parse_charges(str(settings.get("charges") or "1"))
    dp_max = max(1, min(200, int(max_dp)))

    base_adduct = float(settings.get("adduct_mass", poly_match.PROTON_MASS) or poly_match.PROTON_MASS)
    cluster_adduct = float(settings.get("cluster_adduct_mass", base_adduct) or base_adduct)
    adducts = poly_match.build_default_adduct_deltas(
        polarity=polarity,
        base_adduct_mass=base_adduct,
        enable_na=bool(settings.get("adduct_na")),
        enable_k=bool(settings.get("adduct_k")),
        enable_cl=bool(settings.get("adduct_cl")),
        enable_formate=bool(settings.get("adduct_formate")),
        enable_acetate_default=bool(settings.get("adduct_acetate")),
    )
    cluster_adducts = poly_match.build_default_adduct_deltas(
        polarity=polarity,
        base_adduct_mass=cluster_adduct,
        enable_na=bool(settings.get("adduct_na")),
        enable_k=bool(settings.get("adduct_k")),
        enable_cl=bool(settings.get("adduct_cl")),
        enable_formate=bool(settings.get("adduct_formate")),
        enable_acetate_default=bool(settings.get("adduct_acetate")),
    )
    variants = poly_match.generate_variants(
        max_ox=1 if settings.get("oxid") else 0,
        max_decarb=1 if settings.get("decarb") else 0,
        max_h2o_loss=1 if settings.get("h2o_loss") else 0,
        allow_combo=True,
    )

    hits: List[LCMSExpectedProductHit] = []
    seen: set[str] = set()

    def add_hit(composition: str, neutral_mass: float, variant: str, ion: str, expected_mz: float) -> None:
        key = f"{composition}|{variant}|{ion}|{expected_mz:.6f}"
        if key in seen:
            return
        seen.add(key)
        tolerance_da = _tol_da(expected_mz, settings, resolution_mode, low_resolution_tolerance)
        match = _best_match(mz_s, int_s, expected_mz, tolerance_da)
        hits.append(
            LCMSExpectedProductHit(
                id=key,
                composition=composition,
                neutral_mass=float(neutral_mass),
                variant=variant,
                ion=ion,
                expected_mz=float(expected_mz),
                tolerance_da=float(tolerance_da),
                observed_mz=None if match is None else float(match.matched_mz),
                intensity=None if match is None else float(match.intensity),
                abs_err=None if match is None else float(match.abs_err),
                ppm_err=None if match is None else float(match.ppm_err),
            )
        )

    for counts in poly_match.generate_polymer_compositions(len(masses), dp_max, 1):
        dp = int(sum(counts))
        parts: List[str] = []
        mass = 0.0
        for index, count in enumerate(counts):
            if int(count) <= 0:
                continue
            mass += int(count) * float(masses[index])
            parts.append(f"{int(count)}-{names[index]}")
        composition = " + ".join(parts)
        neutral_base = mass + (dp - 1) * float(settings.get("bond_delta", 0.0) or 0.0) + float(settings.get("extra_delta", 0.0) or 0.0)
        for variant in variants:
            neutral_mass = neutral_base + float(variant.mass_delta)
            for charge in charges:
                for adduct_label, adduct_mass in adducts:
                    expected_mz = (neutral_mass + float(adduct_mass)) / float(charge)
                    add_hit(
                        composition,
                        neutral_mass,
                        str(variant.tag),
                        _ion_label("M", adduct_label, adduct_mass, int(charge), polarity),
                        expected_mz,
                    )
        if settings.get("cluster"):
            for charge in charges:
                for adduct_label, adduct_mass in cluster_adducts:
                    expected_mz = (2 * neutral_base + float(adduct_mass)) / float(charge)
                    tolerance_da = _tol_da(expected_mz, settings, resolution_mode, low_resolution_tolerance)
                    dimer_match = _best_match(mz_s, int_s, expected_mz, tolerance_da)
                    if dimer_match is None:
                        continue
                    monomer_mz = neutral_base + float(adduct_mass)
                    monomer_match = _best_match(mz_s, int_s, monomer_mz, _tol_da(monomer_mz, settings, resolution_mode, low_resolution_tolerance))
                    monomer_intensity = 0.0 if monomer_match is None else float(monomer_match.intensity)
                    if monomer_intensity < float(dimer_match.intensity):
                        continue
                    add_hit(
                        composition,
                        2 * neutral_base,
                        "2M",
                        _ion_label("2M", adduct_label, adduct_mass, int(charge), polarity),
                        expected_mz,
                    )

    hits.sort(key=lambda hit: (hit.observed_mz is None, -(hit.intensity or 0.0)))
    return hits


@register(
    ActionSpec(
        id="lcms.match_polymers_for_spectrum",
        summary="Annotate a spectrum with polymer matches.",
        input_model=LCMSSpectrumPolymerInput,
        output_model=LCMSMatchPolymersForSpectrumOutput,
        risk="safe",
        scope="backend",
    )
)
async def match_polymers_for_spectrum(args: LCMSSpectrumPolymerInput) -> LCMSMatchPolymersForSpectrumOutput:
    def work() -> LCMSMatchPolymersForSpectrumOutput:
        state = get_lcms_session(args.session_id)
        meta, mz, intensity = lcms_service.fetch_spectrum_at_rt(state, float(args.rt_min), polarity=args.polarity)
        labels = lcms_service.polymer_match_labels(mz, intensity, polarity=meta.get("polarity"), settings=args.settings)
        return LCMSMatchPolymersForSpectrumOutput(meta=meta, labels=labels)

    return await asyncio.to_thread(work)


@register(
    ActionSpec(
        id="lcms.compute_expected_products",
        summary="Compute expected polymer products for one spectrum.",
        input_model=LCMSExpectedProductsInput,
        output_model=LCMSComputeExpectedProductsOutput,
        risk="safe",
        scope="backend",
    )
)
async def compute_expected_products(args: LCMSExpectedProductsInput) -> LCMSComputeExpectedProductsOutput:
    def work() -> LCMSComputeExpectedProductsOutput:
        state = get_lcms_session(args.session_id)
        meta, mz, intensity = lcms_service.fetch_spectrum_at_rt(state, float(args.rt_min), polarity=args.polarity)
        hits = compute_expected_product_hits(
            mz,
            intensity,
            polarity=meta.get("polarity"),
            settings=args.settings,
            max_dp=int(args.max_dp),
            resolution_mode=args.resolution_mode,
            low_resolution_tolerance=float(args.low_resolution_tolerance),
        )
        return LCMSComputeExpectedProductsOutput(meta=meta, hits=hits)

    return await asyncio.to_thread(work)

