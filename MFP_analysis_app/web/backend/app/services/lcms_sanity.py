"""Sanity rules for automatic LCMS peak labels.

Every candidate label gets a status ("ok", "flagged" or "alternative") and the reasons behind it.
Rules never drop a label: a chemist reviews the flags and decides. The rules work on small "facts"
objects so each one can be tested on its own; lcms_pipeline turns its results into facts.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from typing import Dict, List, Literal, Optional, Sequence, Set

from pydantic import BaseModel, Field

LabelStatus = Literal["ok", "flagged", "alternative"]
# Reasons that make a candidate implausible rather than merely doubtful: the pipeline then takes the
# peak's next candidate, as a chemist does when the biggest match cannot be right.
IMPLAUSIBLE = ("artifact:", "unlikely chemistry:", "no series neighbours:", "wrong charge:")


class SanityRules(BaseModel):
    # UV peak quality
    sn_ok: float = Field(10.0, description="UV S/N at or above this is fine.")
    sn_weak: float = Field(3.0, description="UV S/N from here up to sn_ok is 'weak'; below it, 'below noise'.")
    min_width_min: float = Field(0.02, description="Narrowest believable UV peak (FWHM, min).")
    max_width_min: float = Field(1.0, description="Broadest believable UV peak (FWHM, min).")
    min_prominence_rel: float = Field(0.002, description="UV prominence relative to the tallest peak.")
    # A peak is distinct if it rises clearly above its surroundings OR is about as sharp as the run's
    # typical peak (shoulders in an isomer cluster); broad bumps on a tail fail both (G1, 3.7–4.6 min).
    min_rise_frac: float = Field(0.3, ge=0, le=1, description="Share of its height a peak rises above its surroundings.")
    min_sharpness_rel: float = Field(0.5, ge=0, description="Prominence/width relative to the run's median peak.")
    # The matched ion
    min_rel_intensity: float = Field(0.05, description="Ion intensity relative to the base peak of the summed window.")
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
    # Chemistry of a dry-down (hydroxy acid + amino acid, days at 85 °C): incorporation is by
    # ester–amide exchange, so few amino acids per chain, and they need a hydroxy-acid backbone.
    max_amino_acids: int = Field(3, ge=1, description="More amino acids than this in one chain is unlikely.")
    neighbour_min_dp: int = Field(3, ge=2, description="From this DP up a label needs a series neighbour in the run.")
    max_constant_ratio: float = Field(
        0.5, gt=0, description="An ion whose run-wide median EIC is at least this share of its height here is an artifact."
    )
    # On these single-quad exports nothing sits half a Dalton from an ion unless the ion is 2+. A missing
    # +1 isotope is not used: noise fills +1 as often as real isotopes do, and weak real ions lack one.
    half_isotope_ratio: float = Field(0.25, gt=0, description="A +0.5 peak this tall (vs the ion) marks a 2+ ion.")
    # Ranking
    top_k: int = Field(2, ge=1, description="Candidates kept per UV peak; the rest become alternatives.")


@dataclass
class PeakFacts:
    id: str
    rt_min: float
    sn: float
    width_min: float
    prominence_rel: float
    rise_frac: float = 1.0  # prominence / height above the run's baseline
    sharpness_rel: float = 1.0  # (prominence / width) / the run's median


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
    uv_apex: float = 0.0  # height of the label's UV peak
    counts: Dict[str, int] = field(default_factory=dict)  # monomer → units, e.g. {"Glc": 6, "Arg": 2}
    hydroxy_names: List[str] = field(default_factory=list)  # this run's hydroxy-acid monomers
    amino_acids: int = 0  # amino-acid units in the chain
    hydroxy_acids: int = 0
    constant_ratio: Optional[float] = None  # run-wide median EIC / EIC height at this peak
    form: str = "linear"  # "dimer" for a noncovalent dimer, which has no series of its own
    alternatives: List[str] = field(default_factory=list)  # other species the same ion fits (dimer vs chain)
    charge: int = 1
    half_step_ratio: Optional[float] = None  # tallest peak 0.5/z above the ion, relative to the ion
    full_step_ratio: Optional[float] = None  # tallest peak 1/z above the ion (the first isotope)


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
    if peak.rise_frac < rules.min_rise_frac and peak.sharpness_rel < rules.min_sharpness_rel:
        reasons.append(
            f"not a distinct peak: a broad bump rising {peak.rise_frac:.0%} above its surroundings, "
            f"{peak.sharpness_rel:.1f}× as sharp as a typical peak"
        )
    return reasons


def check_ion(label: LabelFacts, rules: SanityRules) -> List[str]:
    """The matched ion is real enough: intensity vs base peak, mass error."""
    reasons: List[str] = []
    if label.rel_intensity < rules.min_rel_intensity:
        reasons.append(f"ion only {label.rel_intensity:.1%} of the base peak (min {rules.min_rel_intensity:.0%})")
    if label.abs_err_da > rules.max_abs_err_da:
        reasons.append(f"|Δm| {label.abs_err_da:.2f} Da above {rules.max_abs_err_da:g} Da")
    return reasons


def check_eic(label: LabelFacts, rules: SanityRules, span: Optional[tuple[float, float]] = None) -> List[str]:
    """The ion's EIC peaks where the UV peak is (after the UV→MS offset), or anywhere in `span`: the time
    range of the isomer cluster the label belongs to, which the MS often does not separate."""
    if not rules.eic_check:
        return []
    if label.eic_apex_rt_min is None:
        return ["no EIC apex near the UV peak"]
    delta = label.eic_apex_rt_min - label.ms_rt_min
    tol = rules.eic_apex_tol_min
    if span is not None and span[0] - tol <= label.eic_apex_rt_min <= span[1] + tol:
        return []
    if abs(delta) > tol:
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


def check_chemistry(label: LabelFacts, rules: SanityRules) -> List[str]:
    """A dry-down rarely puts more than a few amino acids into one chain, least of all without a hydroxy acid."""
    if label.amino_acids <= rules.max_amino_acids:
        return []
    reason = (
        f"unlikely chemistry: {label.amino_acids} amino acids in one chain "
        f"(a dry-down rarely adds more than {rules.max_amino_acids})"
    )
    if label.hydroxy_acids == 0:
        reason += " and no hydroxy acid to carry them"
    return [reason]


def check_artifact(label: LabelFacts, rules: SanityRules) -> List[str]:
    """An ion present all through the run (solvent, plasticiser) is not this peak's compound."""
    if label.constant_ratio is None or label.constant_ratio < rules.max_constant_ratio:
        return []
    return [f"artifact: the ion is present all through the run (median {label.constant_ratio:.0%} of its height here)"]


def check_charge(label: LabelFacts, rules: SanityRules) -> List[str]:
    """Isotopes 0.5 apart around a 1+ label: the ion is really 2+, so the composition is wrong."""
    if label.charge != 1 or label.half_step_ratio is None:
        return []
    if label.half_step_ratio < rules.half_isotope_ratio or label.half_step_ratio <= (label.full_step_ratio or 0.0):
        return []
    return [f"wrong charge: isotope peaks 0.5 apart ({label.half_step_ratio:.0%} of the ion), so this is probably a 2+ ion"]


def check_isobaric(label: LabelFacts, rules: SanityRules) -> List[str]:
    """One ion, two readings (a chain and a noncovalent dimer): only more analysis tells them apart."""
    if not label.alternatives:
        return []
    return [f"two readings: the same ion also fits {' or '.join(label.alternatives)}; choose in review"]


def _composition(counts: Dict[str, int]) -> frozenset:
    return frozenset((k, v) for k, v in counts.items() if v > 0)


def _species_text(counts: Dict[str, int]) -> str:
    return " + ".join(f"{n}-{name}" for name, n in counts.items() if n > 0)


def series_neighbours(labels: Sequence[LabelFacts], rules: SanityRules) -> Dict[str, List[str]]:
    """A top label of DP ≥ neighbour_min_dp needs a neighbour among the run's top labels: the same chain
    with one hydroxy acid more or less (any monomer when none is known as a hydroxy acid), or the same
    species on another peak. A lone 6-Glc + 2-Arg among n-Glc + 1-Arg chains is most likely wrong."""
    top = [lab for lab in labels if lab.rank == 1 and lab.counts]
    seen: Dict[frozenset, Set[str]] = defaultdict(set)
    for lab in top:
        seen[_composition(lab.counts)].add(lab.peak_id)
    out: Dict[str, List[str]] = {}
    for lab in top:
        if lab.dp < rules.neighbour_min_dp or seen[_composition(lab.counts)] - {lab.peak_id}:
            continue
        vary = [m for m in lab.counts if m in lab.hydroxy_names] or list(lab.counts)
        options = []
        for name in vary:
            for step in (-1, 1):
                counts = {**lab.counts, name: lab.counts[name] + step}
                if counts[name] >= 0 and any(counts.values()):
                    options.append(counts)
        if any(seen.get(_composition(c)) for c in options):
            continue
        listed = " or ".join(_species_text(c) for c in options)
        out[lab.id] = [f"no series neighbours: no {listed} labelled anywhere in the run"]
    return out


def series_support(labels: Sequence[LabelFacts], rules: SanityRules) -> Dict[str, Verdict]:
    """Score each label by the lower-DP members of its series detected anywhere in the run.

    support = (lower DPs found among n−1 … n−lookback) / (how many of those can exist, ≥ DP 1).
    A label of DP ≥ isolated_min_dp with no lower member at all is flagged as isolated.
    """
    dps_by_series: Dict[str, Set[int]] = defaultdict(set)
    for lab in labels:
        if lab.form != "dimer":
            dps_by_series[lab.series].add(lab.dp)
    out: Dict[str, Verdict] = {}
    for lab in labels:
        if lab.form == "dimer":
            out[lab.id] = Verdict(series_support=1.0)
            continue
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
        if lab.form != "dimer":
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


def isomer_clusters(labels: Sequence[LabelFacts], rules: SanityRules) -> Dict[str, List[List[LabelFacts]]]:
    """Per species, its top labels grouped into isomer clusters: neighbouring peaks, each gap ≤ isomer_window_min."""
    by_species: Dict[str, List[LabelFacts]] = defaultdict(list)
    for lab in labels:
        if lab.rank == 1:
            by_species[lab.species].append(lab)
    out: Dict[str, List[List[LabelFacts]]] = {}
    for species, members in by_species.items():
        members.sort(key=lambda m: m.ms_rt_min)
        groups: List[List[LabelFacts]] = []
        for prev, cur in zip([None, *members], members):
            if prev is None or cur.ms_rt_min - prev.ms_rt_min > rules.isomer_window_min:
                groups.append([])
            groups[-1].append(cur)
        out[species] = groups
    return out


def ambiguity(labels: Sequence[LabelFacts], rules: SanityRules, bad_peaks: Set[str] = frozenset()) -> Dict[str, List[str]]:
    """The same species named on more than one UV peak.

    Top-ranked on neighbouring peaks (each gap ≤ isomer_window_min) is a cluster of isomers and fine.
    Top-ranked in separate clusters: the cluster with the biggest UV peak is taken as the real one (more
    peaks breaks a tie) and the labels outside it are 'ambiguous'; on a full tie all of them are. A
    runner-up (rank 2 … top_k) that is the top label of another peak is most likely that peak's tail.
    Peaks that fail the UV peak checks (bad_peaks) never make another peak's label ambiguous.
    """
    top_peaks: Dict[str, List[str]] = defaultdict(list)
    cluster: Dict[str, int] = {}  # peak id → isomer cluster within its species
    main: Dict[str, Optional[int]] = {}  # species → its real cluster, None on a tie
    for species, groups in isomer_clusters(labels, rules).items():
        keys = []
        for n, group in enumerate(groups):
            for m in group:
                top_peaks[species].append(m.peak_id)
                cluster[m.peak_id] = n
            good = [m for m in group if m.peak_id not in bad_peaks]
            if good:
                keys.append(((max(m.uv_apex for m in good), len(good)), n))
        keys.sort(reverse=True)
        main[species] = keys[0][1] if len(keys) == 1 or (keys and keys[0][0] > keys[1][0]) else None
    out: Dict[str, List[str]] = {}
    for lab in labels:
        if lab.rank > rules.top_k:
            continue
        elsewhere = sorted(p for p in top_peaks.get(lab.species, []) if p != lab.peak_id and p not in bad_peaks)
        if not elsewhere:
            continue
        if lab.rank == 1:
            far = [p for p in elsewhere if cluster[p] != cluster[lab.peak_id]]
            if far and (cluster[lab.peak_id] != main[lab.species] or lab.peak_id in bad_peaks):
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
    ambiguous = ambiguity(labels, rules, {pid for pid, r in peak_reasons.items() if r})
    span: Dict[str, tuple[float, float]] = {}  # top label → its isomer cluster's time range
    for groups in isomer_clusters(labels, rules).values():
        for group in groups:
            if len(group) > 1:
                for m in group:
                    span[m.id] = (group[0].ms_rt_min, group[-1].ms_rt_min)
    neighbours = series_neighbours(labels, rules)
    verdicts: Dict[str, Verdict] = {}
    for lab in labels:
        verdict = support[lab.id]
        reasons = list(peak_reasons.get(lab.peak_id, [])) if lab.peak_id in peak_by_id else []
        reasons += check_ion(lab, rules)
        reasons += check_eic(lab, rules, span.get(lab.id))
        reasons += check_monomers(lab, run_monomers)
        reasons += check_adduct(lab, enabled_adducts, rules)
        reasons += check_chemistry(lab, rules)
        reasons += check_artifact(lab, rules)
        reasons += check_charge(lab, rules)
        reasons += check_isobaric(lab, rules)
        reasons += neighbours.get(lab.id, [])
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
