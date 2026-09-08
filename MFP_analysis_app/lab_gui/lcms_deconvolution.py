"""LC-MS ESI Multi-charge and Isotopic Deconvolution.

Deduces neutral mass M (or monoisotopic mass M0) from multi-charge states
[M + zH]z+ (positive mode) or [M - zH]z- (negative mode), and isotopic spacings
delta(m/z) = 1.003355 / z.

Outputs:
1. Deconvoluted components with assigned charge states, neutral masses, and scores.
2. Zero-charge mass spectrum (True Mass vs Deconvoluted Intensity).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Sequence, Tuple
import numpy as np

PROTON_MASS = 1.00727647
NEUTRON_MASS = 1.003355


@dataclass
class DeconvolutedChargeState:
    charge: int
    observed_mz: float
    theoretical_mz: float
    intensity: float
    error_da: float
    error_ppm: float

    def to_dict(self) -> Dict[str, Any]:
        return {
            "charge": self.charge,
            "observed_mz": round(float(self.observed_mz), 5),
            "theoretical_mz": round(float(self.theoretical_mz), 5),
            "intensity": float(self.intensity),
            "error_da": round(float(self.error_da), 5),
            "error_ppm": round(float(self.error_ppm), 2),
        }


@dataclass
class DeconvolutedComponent:
    mass: float
    total_intensity: float
    score: float
    charge_states: List[DeconvolutedChargeState] = field(default_factory=list)
    method: str = "envelope"  # "envelope", "isotopic", or "hybrid"

    def to_dict(self) -> Dict[str, Any]:
        return {
            "mass": round(float(self.mass), 4),
            "total_intensity": float(self.total_intensity),
            "score": round(float(self.score), 3),
            "method": self.method,
            "charges": [cs.charge for cs in self.charge_states],
            "charge_states": [cs.to_dict() for cs in self.charge_states],
        }


def find_nearest_peak(
    target_mz: float,
    mz_array: np.ndarray,
    int_array: np.ndarray,
    tolerance_da: float,
) -> Optional[Tuple[int, float, float, float]]:
    """Return (index, mz, intensity, abs_err) for the nearest peak within tolerance."""
    if len(mz_array) == 0:
        return None
    idx = np.searchsorted(mz_array, target_mz)
    best_idx = None
    best_err = tolerance_da + 1.0

    # check neighbors idx - 1, idx, idx + 1
    candidates = [i for i in (idx - 1, idx, idx + 1) if 0 <= i < len(mz_array)]
    for c in candidates:
        err = abs(mz_array[c] - target_mz)
        if err <= tolerance_da and err < best_err:
            best_err = err
            best_idx = c

    if best_idx is not None:
        return best_idx, float(mz_array[best_idx]), float(int_array[best_idx]), float(best_err)
    return None


def calculate_mass_from_mz(
    mz: float,
    z: int,
    polarity: str = "positive",
    adduct_mass: float = PROTON_MASS,
) -> float:
    """Calculate neutral mass M from m/z and charge z."""
    sign = 1.0 if polarity.lower().startswith("pos") else -1.0
    return z * (mz - sign * adduct_mass)


def calculate_mz_from_mass(
    mass: float,
    z: int,
    polarity: str = "positive",
    adduct_mass: float = PROTON_MASS,
) -> float:
    """Calculate theoretical m/z from neutral mass M and charge z."""
    sign = 1.0 if polarity.lower().startswith("pos") else -1.0
    return (mass + z * sign * adduct_mass) / z


def deconvolute_spectrum(
    mz_array: Sequence[float],
    intensity_array: Sequence[float],
    *,
    min_charge: int = 1,
    max_charge: int = 8,
    tolerance: float = 0.05,
    tolerance_unit: str = "da",
    polarity: str = "positive",
    adduct_mass: float = PROTON_MASS,
    min_rel_intensity: float = 0.01,
    mz_min: Optional[float] = None,
    mz_max: Optional[float] = None,
) -> Dict[str, Any]:
    """Perform multi-charge and isotopic deconvolution on an MS1 spectrum.

    Parameters
    ----------
    mz_array : sequence of m/z values (assumed sorted or will be sorted)
    intensity_array : sequence of intensity values
    min_charge : minimum charge state to consider (>= 1)
    max_charge : maximum charge state to consider (<= 25)
    tolerance : matching tolerance value (Da or ppm)
    tolerance_unit : 'da' or 'ppm'
    polarity : 'positive' or 'negative'
    adduct_mass : mass of adduct ion (defaults to PROTON_MASS 1.007276)
    min_rel_intensity : minimum peak intensity relative to spectrum base peak (0.01 = 1%)
    mz_min : optional lower m/z cutoff
    mz_max : optional upper m/z cutoff

    Returns
    -------
    Dict with:
    - 'components': List of DeconvolutedComponent dicts sorted by total_intensity descending
    - 'zero_charge_spectrum': Dict with 'mass' and 'intensity' arrays for true-mass plotting
    - 'summary': Statistics on total deconvoluted intensity, component count, charge distribution
    """
    mzs = np.asarray(mz_array, dtype=np.float64)
    ints = np.asarray(intensity_array, dtype=np.float64)

    if len(mzs) == 0 or len(ints) == 0:
        return {
            "components": [],
            "zero_charge_spectrum": {"mass": [], "intensity": []},
            "summary": {"total_components": 0, "deconvoluted_intensity": 0.0},
        }

    # Sort if not strictly ascending
    if not np.all(mzs[:-1] <= mzs[1:]):
        order = np.argsort(mzs)
        mzs = mzs[order]
        ints = ints[order]

    # Filter by optional mz bounds
    mask = np.ones(len(mzs), dtype=bool)
    if mz_min is not None:
        mask &= mzs >= mz_min
    if mz_max is not None:
        mask &= mzs <= mz_max
    mzs = mzs[mask]
    ints = ints[mask]

    if len(mzs) == 0:
        return {
            "components": [],
            "zero_charge_spectrum": {"mass": [], "intensity": []},
            "summary": {"total_components": 0, "deconvoluted_intensity": 0.0},
        }

    max_int = float(np.max(ints)) if len(ints) > 0 else 1.0
    cutoff = max_int * max(0.0, min_rel_intensity)

    # Filter peaks above relative threshold for seed search
    seed_indices = np.where(ints >= cutoff)[0]
    # Sort seeds by intensity descending
    seed_indices = seed_indices[np.argsort(-ints[seed_indices])]

    def get_tol_da(target_mz: float) -> float:
        if tolerance_unit.lower() == "ppm":
            return target_mz * (tolerance / 1e6)
        return float(tolerance)

    sign = 1.0 if polarity.lower().startswith("pos") else -1.0
    found_components: List[DeconvolutedComponent] = []
    used_peak_indices = set()

    # --- Phase 1: Multi-Charge Envelope Deconvolution ---
    # For pairs of seed peaks (m1 > m2)
    min_z = max(1, min_charge)
    max_z = min(25, max_charge)

    # Candidate masses scored by consistency
    mass_candidates: Dict[float, List[Tuple[int, int, float, float]]] = {}  # mass_round -> list of (z, peak_idx, mz, int)

    for i in range(len(seed_indices)):
        idx1 = seed_indices[i]
        m1 = mzs[idx1]
        int1 = ints[idx1]

        for z in range(min_z, max_z + 1):
            mass_cand = calculate_mass_from_mz(m1, z, polarity=polarity, adduct_mass=adduct_mass)
            if mass_cand < 50.0:
                continue

            # Now test if other charge states for this mass exist in the spectrum
            envelope_states: List[DeconvolutedChargeState] = []
            cand_tol_da = get_tol_da(m1)
            # Add self as charge state z
            envelope_states.append(
                DeconvolutedChargeState(
                    charge=z,
                    observed_mz=m1,
                    theoretical_mz=m1,
                    intensity=int1,
                    error_da=0.0,
                    error_ppm=0.0,
                )
            )

            # Look for companion charge states z_other in [min_z, max_z]
            for z_other in range(min_z, max_z + 1):
                if z_other == z:
                    continue
                target_other_mz = calculate_mz_from_mass(
                    mass_cand, z_other, polarity=polarity, adduct_mass=adduct_mass
                )
                tol_other = get_tol_da(target_other_mz)
                match = find_nearest_peak(target_other_mz, mzs, ints, tol_other)
                if match is not None:
                    matched_idx, matched_mz, matched_int, err_da = match
                    if matched_int >= cutoff * 0.5:
                        err_ppm = (err_da / matched_mz) * 1e6
                        envelope_states.append(
                            DeconvolutedChargeState(
                                charge=z_other,
                                observed_mz=matched_mz,
                                theoretical_mz=target_other_mz,
                                intensity=matched_int,
                                error_da=err_da,
                                error_ppm=err_ppm,
                            )
                        )

            # If we found at least 2 charge states in the envelope
            if len(envelope_states) >= 2:
                # Calculate weighted mass
                total_w = sum(cs.intensity for cs in envelope_states)
                refined_mass = sum(
                    calculate_mass_from_mz(cs.observed_mz, cs.charge, polarity, adduct_mass) * cs.intensity
                    for cs in envelope_states
                ) / max(total_w, 1e-9)

                # Recompute theoretical mzs and errors with refined mass
                for cs in envelope_states:
                    cs.theoretical_mz = calculate_mz_from_mass(
                        refined_mass, cs.charge, polarity, adduct_mass
                    )
                    cs.error_da = abs(cs.observed_mz - cs.theoretical_mz)
                    cs.error_ppm = (cs.error_da / cs.theoretical_mz) * 1e6

                # Score: base score for number of charge states + penalty for ppm errors
                mean_ppm = float(np.mean([cs.error_ppm for cs in envelope_states]))
                max_tol_ppm = (tolerance if tolerance_unit == "ppm" else (tolerance / 500.0) * 1e6)
                ppm_factor = max(0.0, 1.0 - (mean_ppm / max(max_tol_ppm, 10.0)))
                # 2 states -> ~0.75, 3 states -> ~0.88, 4+ states -> 0.95+
                state_factor = min(1.0, len(envelope_states) / 4.0)
                score = round(0.5 * state_factor + 0.5 * ppm_factor, 3)

                envelope_states.sort(key=lambda s: s.charge)
                found_components.append(
                    DeconvolutedComponent(
                        mass=refined_mass,
                        total_intensity=total_w,
                        score=score,
                        charge_states=envelope_states,
                        method="envelope",
                    )
                )

    # --- Phase 2: High-Resolution Isotopic Spacing Deconvolution ---
    # For peaks with resolved isotopic envelopes (e.g. delta(m/z) ~ 1.003355 / z)
    for idx in seed_indices:
        if idx in used_peak_indices:
            continue
        base_mz = mzs[idx]
        base_int = ints[idx]

        for z in range(min_z, max_z + 1):
            iso_delta = NEUTRON_MASS / z
            cand_tol = get_tol_da(base_mz + iso_delta)
            match1 = find_nearest_peak(base_mz + iso_delta, mzs, ints, cand_tol)

            if match1 is not None:
                _, m_plus_1, int_plus_1, err1 = match1
                # Must be plausible isotopic ratio: M+1 intensity between 5% and 250% of M
                ratio1 = int_plus_1 / max(base_int, 1e-9)
                if 0.04 <= ratio1 <= 2.8:
                    cand_mass = calculate_mass_from_mz(base_mz, z, polarity, adduct_mass)
                    if cand_mass < 50.0:
                        continue

                    iso_states = [
                        DeconvolutedChargeState(
                            charge=z,
                            observed_mz=base_mz,
                            theoretical_mz=base_mz,
                            intensity=base_int + int_plus_1,
                            error_da=err1,
                            error_ppm=(err1 / base_mz) * 1e6,
                        )
                    ]

                    # Check for M+2 isotope
                    match2 = find_nearest_peak(base_mz + 2 * iso_delta, mzs, ints, cand_tol)
                    if match2 is not None:
                        _, m_plus_2, int_plus_2, _ = match2
                        iso_states[0].intensity += int_plus_2

                    found_components.append(
                        DeconvolutedComponent(
                            mass=cand_mass,
                            total_intensity=iso_states[0].intensity,
                            score=0.78 if match2 is not None else 0.65,
                            charge_states=iso_states,
                            method="isotopic",
                        )
                    )

    # --- Phase 3: Cluster & Deduplicate Components ---
    # Merge components that share the same mass within 0.1 Da or 50 ppm
    components_by_mass: List[DeconvolutedComponent] = []
    # Sort candidates by total intensity descending
    found_components.sort(key=lambda c: c.total_intensity, reverse=True)

    for comp in found_components:
        # Check if already accounted for by an existing component
        merged = False
        comp_tol = max(0.08, comp.mass * 0.00003)  # 30 ppm or 0.08 Da
        for existing in components_by_mass:
            if abs(existing.mass - comp.mass) <= comp_tol:
                # Merge charge states
                existing_charges = {cs.charge: cs for cs in existing.charge_states}
                for cs in comp.charge_states:
                    if cs.charge not in existing_charges:
                        existing.charge_states.append(cs)
                        existing.total_intensity += cs.intensity
                    elif cs.intensity > existing_charges[cs.charge].intensity:
                        existing_charges[cs.charge] = cs
                existing.charge_states.sort(key=lambda s: s.charge)
                existing.score = max(existing.score, comp.score)
                if len(existing.charge_states) > 1 and existing.method == "isotopic":
                    existing.method = "hybrid"
                merged = True
                break

        if not merged:
            components_by_mass.append(comp)

    # Sort final components by total intensity descending
    components_by_mass.sort(key=lambda c: c.total_intensity, reverse=True)

    # --- Phase 4: Construct Deconvoluted Zero-Charge Spectrum ---
    # Generate discrete stick spectrum at the deconvoluted masses
    zero_masses: List[float] = []
    zero_intensities: List[float] = []

    for comp in components_by_mass:
        zero_masses.append(round(comp.mass, 4))
        zero_intensities.append(float(comp.total_intensity))

    # Also sort zero charge spectrum by mass
    if zero_masses:
        sort_order = np.argsort(zero_masses)
        zero_masses = [zero_masses[i] for i in sort_order]
        zero_intensities = [zero_intensities[i] for i in sort_order]

    total_deconvoluted = sum(c.total_intensity for c in components_by_mass)

    return {
        "components": [c.to_dict() for c in components_by_mass],
        "zero_charge_spectrum": {
            "mass": zero_masses,
            "intensity": zero_intensities,
        },
        "summary": {
            "total_components": len(components_by_mass),
            "deconvoluted_intensity": float(total_deconvoluted),
            "polarity": polarity,
            "min_charge": min_charge,
            "max_charge": max_charge,
        },
    }
