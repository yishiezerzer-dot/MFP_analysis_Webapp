"""One test per automatic-labelling sanity rule (app/services/lcms_sanity.py)."""
from dataclasses import replace

from app.services.lcms_sanity import (
    LabelFacts,
    PeakFacts,
    SanityRules,
    ambiguity,
    apply_rules,
    check_adduct,
    check_eic,
    check_ion,
    check_monomers,
    check_peak,
    elution_order,
    series_support,
)

RULES = SanityRules()


def peak(**kw) -> PeakFacts:
    base = dict(id="p1", rt_min=5.0, sn=50.0, width_min=0.15, prominence_rel=0.5)
    base.update(kw)
    return PeakFacts(**base)


def label(**kw) -> LabelFacts:
    base = dict(
        id="l1", peak_id="p1", rank=1, species="3-Ser", series="Ser", dp=3, monomers=["Ser"], adduct="H",
        has_protonated_form=True, rel_intensity=0.4, abs_err_da=0.1, ms_rt_min=5.0, eic_apex_rt_min=5.02,
    )
    base.update(kw)
    return LabelFacts(**base)


def test_uv_signal_to_noise():
    assert check_peak(peak(sn=25), RULES) == []
    assert "weak UV peak" in check_peak(peak(sn=6), RULES)[0]
    assert "below noise" in check_peak(peak(sn=2), RULES)[0]


def test_uv_peak_width_range():
    assert "too narrow" in check_peak(peak(width_min=0.005), RULES)[0]
    assert "too broad" in check_peak(peak(width_min=3.0), RULES)[0]


def test_uv_minimum_prominence():
    assert "prominence" in check_peak(peak(prominence_rel=0.005), RULES)[0]


def test_ion_at_least_one_percent_of_base_peak():
    assert check_ion(label(rel_intensity=0.02), RULES) == []
    assert "of the base peak" in check_ion(label(rel_intensity=0.004), RULES)[0]


def test_mass_error_within_half_a_dalton():
    assert check_ion(label(abs_err_da=0.45), RULES) == []
    assert "|Δm|" in check_ion(label(abs_err_da=0.6), RULES)[0]


def test_eic_apex_close_to_uv_apex():
    assert check_eic(label(eic_apex_rt_min=5.08), RULES) == []
    assert "EIC apex" in check_eic(label(eic_apex_rt_min=5.3), RULES)[0]
    assert check_eic(label(eic_apex_rt_min=None), RULES) == ["no EIC apex near the UV peak"]


def test_only_this_runs_monomers():
    assert check_monomers(label(monomers=["Ser"]), ["Ser", "Gly"]) == []
    assert "Lys" in check_monomers(label(monomers=["Ser", "Lys"]), ["Ser"])[0]


def test_adducts_limited_to_enabled_set():
    assert check_adduct(label(adduct="K"), {"Na", "Cl"}, RULES)[0] == "adduct K is not enabled"
    assert check_adduct(label(adduct="Na"), {"Na", "Cl"}, RULES) == []


def test_sodium_without_protonated_form_is_flagged():
    reasons = check_adduct(label(adduct="Na", has_protonated_form=False), {"Na"}, RULES)
    assert reasons == ["[M+Na] without a matching [M±H] form"]


def test_series_support_scores_lower_members():
    labs = [label(id=f"d{n}", dp=n, species=f"{n}-Ser") for n in (2, 3, 4, 5)]
    support = series_support(labs, RULES)
    assert support["d5"].series_support == 1.0  # 4, 3, 2 all present
    assert support["d5"].support_members == [4, 3, 2]
    assert support["d3"].series_support == 0.5  # 2 present, 1 (monomer) not
    assert support["d2"].reasons == []  # below isolated_min_dp


def test_isolated_high_dp_is_flagged():
    labs = [label(id="ser8", dp=8, species="8-Ser"), label(id="gly2", dp=2, series="Gly", species="2-Gly", monomers=["Gly"])]
    support = series_support(labs, RULES)
    assert support["ser8"].series_support == 0.0
    assert "isolated" in support["ser8"].reasons[0]
    assert support["gly2"].reasons == []


def test_elution_order_flags_the_outlier():
    # Default: higher DP elutes earlier. DP 4 comes out late, against the trend.
    rts = {2: 8.0, 3: 7.0, 4: 9.5, 5: 5.0, 6: 4.0}
    labs = [label(id=f"d{n}", dp=n, ms_rt_min=rt, species=f"{n}-Ser") for n, rt in rts.items()]
    flagged = elution_order(labs, RULES)
    assert list(flagged) == ["d4"]
    assert "elution order" in flagged["d4"][0]
    assert elution_order(labs, RULES.model_copy(update={"elution_direction": "off"})) == {}


def test_elution_direction_is_configurable():
    labs = [label(id=f"d{n}", dp=n, ms_rt_min=2.0 + n, species=f"{n}-Ser") for n in (2, 3, 4, 5)]
    assert len(elution_order(labs, RULES)) == 4  # all against a decreasing trend
    assert elution_order(labs, RULES.model_copy(update={"elution_direction": "increasing"})) == {}


def test_same_species_on_two_peaks_is_ambiguous():
    labs = [label(id="a", peak_id="p1"), label(id="b", peak_id="p2"), label(id="c", peak_id="p3", species="4-Ser", dp=4)]
    flagged = ambiguity(labs, RULES)
    assert set(flagged) == {"a", "b"}
    assert "ambiguous" in flagged["a"][0]


def test_top_k_keeps_two_and_never_drops_labels():
    labs = [label(id=f"r{r}", rank=r, species=f"{r + 1}-Ser", dp=r + 1) for r in (1, 2, 3)]
    verdicts = apply_rules([peak()], labs, RULES, run_monomers=["Ser"], enabled_adducts={"Na", "Cl"})
    assert set(verdicts) == {"r1", "r2", "r3"}
    assert verdicts["r3"].status == "alternative"
    assert verdicts["r1"].status in ("ok", "flagged")


def test_clean_label_is_ok_and_peak_flags_reach_its_labels():
    lab = label(dp=2, species="2-Ser")
    ok = apply_rules([peak()], [lab], RULES, run_monomers=["Ser"], enabled_adducts=set())
    assert ok["l1"].status == "ok" and ok["l1"].reasons == []
    weak = apply_rules([peak(sn=5)], [lab], RULES, run_monomers=["Ser"], enabled_adducts=set())
    assert weak["l1"].status == "flagged"
    assert "weak UV peak" in weak["l1"].reasons[0]
    assert replace(lab).id == "l1"
