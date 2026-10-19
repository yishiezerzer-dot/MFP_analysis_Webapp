"""Sanity rules for automatic LCMS peak labels.

Every candidate label gets a status ("ok", "flagged" or "alternative") and the reasons behind it.
Rules never drop a label: a chemist reviews the flags and decides. The rules work on small "facts"
objects so each one can be tested on its own; lcms_pipeline turns its results into facts.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass, field
from typing import Dict, List, Literal, Optional, Sequence, Set

from pydantic import BaseModel, Field

LabelStatus = Literal["ok", "flagged", "alternative"]


class SanityRules(BaseModel):
    # UV peak quality
    sn_ok: float = Field(10.0, description="UV S/N at or above this is fine.")
    sn_weak: float = Field(3.0, description="UV S/N from here up to sn_ok is 'weak'; below it, 'below noise'.")
    min_width_min: float = Field(0.02, description="Narrowest believable UV peak (FWHM, min).")
    max_width_min: float = Field(1.0, description="Broadest believable UV peak (FWHM, min).")
    min_prominence_rel: float = Field(0.002, description="UV prominence relative to the tallest peak.")
    # The matched ion
    min_rel_intensity: float = Field(0.01, description="Ion intensity relative to the base peak of the summed window.")
    max_abs_err_da: float = Field(0.5, description="Largest |Δm| between observed and calculated m/z.")
    # MS and UV agree in time
    eic_check: bool = True
    eic_apex_tol_min: float = Field(0.1, description="EIC apex must be this close to the (offset) UV apex.")
    # Adducts
    require_protonated_for_adducts: bool = Field(
        True, description="Flag Na/Cl/... forms when the [M+H]⁺/[M−H]⁻ form of the same species is absent."
    )
    # Series
    series_lookback: int = Field(3, ge=1, description="How many lower DPs (n−1 … n−k) count as series support.")
    isolated_min_dp: int = Field(3, ge=2, description="A label of at least this DP with no lower member is 'isolated'.")
    elution_direction: Literal["decreasing", "increasing", "off"] = Field(
        "increasing", description="Expected RT trend as DP rises within a series."
    )
    elution_rt_tol_min: float = Field(0.02, description="RT differences below this are not counted as order violations.")
    isomer_window_min: float = Field(
        1.0, ge=0, description="The same species on UV peaks this close (gap by gap) is a set of isomers, not ambiguous."
    )
    # Ranking
    top_k: int = Field(2, ge=1, description="Candidates kept per UV peak; the rest become alternatives.")


@dataclass
class PeakFacts:
    id: str
    rt_min: float
    sn: float
    width_min: float
    prominence_rel: float


@dataclass
class LabelFacts:
    id: str
    peak_id: str
    rank: int  # 1 = best candidate for its UV peak
    species: str  # composition + variant, without the ion, e.g. "2-GA + 1-LA"
    series: str  # monomers present, e.g. "GA+LA"
    dp: int
    monomers: List[str]
    adduct: str  # "H", "Na", "Cl", "K", "NH4", "HCOO", "Ac", ...
    has_protonated_form: bool  # [M+H]⁺ / [M−H]⁻ of the same species seen in the same window
    rel_intensity: float
    abs_err_da: float
    ms_rt_min: float  # UV apex + offset
    eic_apex_rt_min: Optional[float] = None


@dataclass
class Verdict:
    status: LabelStatus = "ok"
    reasons: List[str] = field(default_factory=list)
    series_support: float = 0.0
    support_members: List[int] = field(default_factory=list)  # lower DPs found


def _sn_reason(sn: float, rules: SanityRules) -> Optional[str]:
    if sn >= rules.sn_ok:
        return None
    if sn >= rules.sn_weak:
        return f"weak UV peak (S/N {sn:.1f}, below {rules.sn_ok:g})"
    return f"UV peak below noise (S/N {sn:.1f})"


def check_peak(peak: PeakFacts, rules: SanityRules) -> List[str]:
    """UV peak quality: S/N, width and prominence."""
    reasons: List[str] = []
    sn = _sn_reason(peak.sn, rules)
    if sn:
        reasons.append(sn)
    if peak.width_min < rules.min_width_min:
        reasons.append(f"UV peak too narrow ({peak.width_min:.3f} min, min {rules.min_width_min:g})")
    elif peak.width_min > rules.max_width_min:
        reasons.append(f"UV peak too broad ({peak.width_min:.2f} min, max {rules.max_width_min:g})")
    if peak.prominence_rel < rules.min_prominence_rel:
        reasons.append(f"UV peak prominence {peak.prominence_rel:.1%} of the largest (min {rules.min_prominence_rel:.1%})")
    return reasons


def check_ion(label: LabelFacts, rules: SanityRules) -> List[str]:
    """The matched ion is real enough: intensity vs base peak, mass error."""
    reasons: List[str] = []
    if label.rel_intensity < rules.min_rel_intensity:
        reasons.append(f"ion only {label.rel_intensity:.1%} of the base peak (min {rules.min_rel_intensity:.0%})")
    if label.abs_err_da > rules.max_abs_err_da:
        reasons.append(f"|Δm| {label.abs_err_da:.2f} Da above {rules.max_abs_err_da:g} Da")
    return reasons


def check_eic(label: LabelFacts, rules: SanityRules) -> List[str]:
    """The ion's EIC peaks where the UV peak is (after the UV→MS offset)."""
    if not rules.eic_check:
        return []
    if label.eic_apex_rt_min is None:
        return ["no EIC apex near the UV peak"]
    delta = label.eic_apex_rt_min - label.ms_rt_min
    if abs(delta) > rules.eic_apex_tol_min:
        return [f"EIC apex at {label.eic_apex_rt_min:.2f} min, {delta:+.2f} min from the UV apex"]
    return []


def check_monomers(label: LabelFacts, run_monomers: Sequence[str]) -> List[str]:
    """Only this run's monomers may appear in a composition."""
    allowed = {m.strip() for m in run_monomers}
    unknown = sorted({m for m in label.monomers if m not in allowed})
    return [f"monomer(s) not in this run's list: {', '.join(unknown)}"] if unknown else []


def check_adduct(label: LabelFacts, enabled_adducts: Set[str], rules: SanityRules) -> List[str]:
    """Adducts limited to the enabled set; a Na/Cl form wants its protonated partner."""
    reasons: List[str] = []
    if label.adduct != "H" and label.adduct not in enabled_adducts:
        reasons.append(f"adduct {label.adduct} is not enabled")
    if rules.require_protonated_for_adducts and label.adduct != "H" and not label.has_protonated_form:
        reasons.append(f"[M+{label.adduct}] without a matching [M±H] form")
    return reasons


def series_support(labels: Sequence[LabelFacts], rules: SanityRules) -> Dict[str, Verdict]:
    """Score each label by the lower-DP members of its series detected anywhere in the run.

    support = (lower DPs found among n−1 … n−lookback) / (how many of those can exist, ≥ DP 1).
    A label of DP ≥ isolated_min_dp with no lower member at all is flagged as isolated.
    """
    dps_by_series: Dict[str, Set[int]] = defaultdict(set)
    for lab in labels:
        dps_by_series[lab.series].add(lab.dp)
    out: Dict[str, Verdict] = {}
    for lab in labels:
        window = [d for d in range(lab.dp - 1, lab.dp - 1 - rules.series_lookback, -1) if d >= 1]
        found = [d for d in window if d in dps_by_series[lab.series]]
        verdict = Verdict(series_support=(len(found) / len(window)) if window else 1.0, support_members=found)
        any_lower = any(d < lab.dp for d in dps_by_series[lab.series])
        if lab.dp >= rules.isolated_min_dp and not any_lower:
            verdict.reasons.append(f"isolated: no lower-DP {lab.series} member found, likely not real")
        out[lab.id] = verdict
    return out


def elution_order(labels: Sequence[LabelFacts], rules: SanityRules) -> Dict[str, List[str]]:
    """Within a series RT should move one way as DP rises; flag the members that break the trend.

    Outliers are the members with the most violations in their series, if that is at least half of
    their comparisons (with three members one bad point can't be told from its neighbour: both flag).
    """
    if rules.elution_direction == "off":
        return {}
    sign = -1.0 if rules.elution_direction == "decreasing" else 1.0
    by_series: Dict[str, List[LabelFacts]] = defaultdict(list)
    for lab in labels:
        by_series[lab.series].append(lab)
    out: Dict[str, List[str]] = {}
    for series, members in by_series.items():
        if len({m.dp for m in members}) < 3:
            continue
        bad: Dict[str, int] = {}
        compared: Dict[str, int] = {}
        for lab in members:
            others = [m for m in members if m.dp != lab.dp]
            compared[lab.id] = len(others)
            bad[lab.id] = 0
            for other in others:
                # Positive when the higher-DP member of the pair elutes later.
                d_rt = (other.ms_rt_min - lab.ms_rt_min) * (1 if other.dp > lab.dp else -1)
                if sign * d_rt < -rules.elution_rt_tol_min:
                    bad[lab.id] += 1
        worst = max(bad.values(), default=0)
        trend = "earlier" if sign < 0 else "later"
        for lab in members:
            n_bad = bad[lab.id]
            if n_bad and n_bad == worst and n_bad * 2 >= compared[lab.id]:
                out[lab.id] = [f"elution order: {series} DP {lab.dp} breaks the trend (higher DP should elute {trend})"]
    return out


def ambiguity(labels: Sequence[LabelFacts], rules: SanityRules) -> Dict[str, List[str]]:
    """The same species named on more than one UV peak.

    Top-ranked on neighbouring peaks (each gap ≤ isomer_window_min) is a cluster of isomers and fine.
    Top-ranked in separate clusters: when one cluster has more peaks than any other it is taken as the
    real one and the labels outside it are 'ambiguous'; on a tie all of them are. A runner-up
    (rank 2 … top_k) that is the top label of another peak is most likely that peak's tail.
    """
    top_peaks: Dict[str, List[str]] = defaultdict(list)
    cluster: Dict[str, int] = {}  # peak id → isomer cluster within its species
    main: Dict[str, Optional[int]] = {}  # species → its largest cluster, None on a tie
    by_species: Dict[str, List[LabelFacts]] = defaultdict(list)
    for lab in labels:
        if lab.rank == 1:
            top_peaks[lab.species].append(lab.peak_id)
            by_species[lab.species].append(lab)
    for members in by_species.values():
        members.sort(key=lambda m: m.ms_rt_min)
        n = 0
        for prev, cur in zip([None, *members], members):
            if prev is not None and cur.ms_rt_min - prev.ms_rt_min > rules.isomer_window_min:
                n += 1
            cluster[cur.peak_id] = n
        sizes = Counter(cluster[m.peak_id] for m in members).most_common(2)
        main[members[0].species] = sizes[0][0] if len(sizes) == 1 or sizes[0][1] > sizes[1][1] else None
    out: Dict[str, List[str]] = {}
    for lab in labels:
        if lab.rank > rules.top_k:
            continue
        elsewhere = sorted(p for p in top_peaks.get(lab.species, []) if p != lab.peak_id)
        if not elsewhere:
            continue
        if lab.rank == 1:
            far = [p for p in elsewhere if cluster[p] != cluster[lab.peak_id]]
            if far and cluster[lab.peak_id] != main[lab.species]:
                out[lab.id] = [
                    f"ambiguous: {lab.species} is also the top label of {', '.join(far)}, "
                    f"more than {rules.isomer_window_min:g} min away"
                ]
        else:
            out[lab.id] = [f"probably the tail of {', '.join(elsewhere)}, where {lab.species} is the top label"]
    return out


def apply_rules(
    peaks: Sequence[PeakFacts],
    labels: Sequence[LabelFacts],
    rules: SanityRules,
    *,
    run_monomers: Sequence[str],
    enabled_adducts: Set[str],
) -> Dict[str, Verdict]:
    """Status and reasons for every label. Ranks beyond top_k are 'alternative' (still checked)."""
    peak_by_id = {p.id: p for p in peaks}
    peak_reasons = {p.id: check_peak(p, rules) for p in peaks}
    support = series_support(labels, rules)
    order = elution_order(labels, rules)
    ambiguous = ambiguity(labels, rules)
    verdicts: Dict[str, Verdict] = {}
    for lab in labels:
        verdict = support[lab.id]
        reasons = list(peak_reasons.get(lab.peak_id, [])) if lab.peak_id in peak_by_id else []
        reasons += check_ion(lab, rules)
        reasons += check_eic(lab, rules)
        reasons += check_monomers(lab, run_monomers)
        reasons += check_adduct(lab, enabled_adducts, rules)
        reasons += verdict.reasons
        reasons += order.get(lab.id, [])
        reasons += ambiguous.get(lab.id, [])
        verdict.reasons = reasons
        if lab.rank > rules.top_k:
            verdict.status = "alternative"
        else:
            verdict.status = "flagged" if reasons else "ok"
        verdicts[lab.id] = verdict
    return verdicts
