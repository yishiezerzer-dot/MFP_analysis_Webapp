"""One test per automatic-labelling sanity rule (app/services/lcms_sanity.py)."""
from dataclasses import replace

from app.services.lcms_sanity import (
    LabelFacts,
    PeakFacts,
    SanityRules,
    IMPLAUSIBLE,
    ambiguity,
    apply_rules,
    check_adduct,
    check_artifact,
    check_chemistry,
    check_eic,
    check_ion,
    check_monomers,
    check_peak,
    elution_order,
    series_neighbours,
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
    # Real oligomer peaks sit at 0.2–2% of a large early peak, so the floor is 0.2%.
    assert check_peak(peak(prominence_rel=0.005), RULES) == []
    assert "prominence 0.1% of the largest (min 0.2%)" in check_peak(peak(prominence_rel=0.001), RULES)[0]


def test_uv_peak_must_be_distinct():
    # Distinct = rises clearly above its surroundings OR is as sharp as the run's typical peak (a shoulder).
    assert check_peak(peak(rise_frac=0.4, sharpness_rel=0.1), RULES) == []
    assert check_peak(peak(rise_frac=0.1, sharpness_rel=2.0), RULES) == []
    reasons = check_peak(peak(rise_frac=0.1, sharpness_rel=0.2), RULES)
    assert reasons == ["not a distinct peak: a broad bump rising 10% above its surroundings, 0.2× as sharp as a typical peak"]


def test_ion_at_least_five_percent_of_base_peak():
    assert check_ion(label(rel_intensity=0.06), RULES) == []
    assert check_ion(label(rel_intensity=0.02), RULES) == ["ion only 2.0% of the base peak (min 5%)"]


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
    # Default: higher DP elutes later (reversed phase). DP 4 comes out early, against the trend.
    rts = {2: 4.0, 3: 5.0, 4: 3.5, 5: 7.0, 6: 8.0}
    labs = [label(id=f"d{n}", dp=n, ms_rt_min=rt, species=f"{n}-Ser") for n, rt in rts.items()]
    flagged = elution_order(labs, RULES)
    assert list(flagged) == ["d4"]
    assert "should elute later" in flagged["d4"][0]
    assert elution_order(labs, RULES.model_copy(update={"elution_direction": "off"})) == {}


def test_elution_direction_is_configurable():
    labs = [label(id=f"d{n}", dp=n, ms_rt_min=2.0 + n, species=f"{n}-Ser") for n in (2, 3, 4, 5)]
    assert elution_order(labs, RULES) == {}
    assert len(elution_order(labs, RULES.model_copy(update={"elution_direction": "decreasing"}))) == 4


def test_same_species_on_two_distant_peaks_is_ambiguous():
    labs = [label(id="a", peak_id="p1", ms_rt_min=5.0), label(id="b", peak_id="p2", ms_rt_min=9.0),
            label(id="c", peak_id="p3", species="4-Ser", dp=4)]
    flagged = ambiguity(labs, RULES)
    assert set(flagged) == {"a", "b"}
    assert "ambiguous" in flagged["a"][0] and "p2" in flagged["a"][0]


def test_same_species_on_neighbouring_peaks_are_isomers():
    # Chained: 5.0 → 5.8 → 6.6 are one isomer cluster (each gap ≤ 1 min); 12.0 is far away.
    rts = {"a": 5.0, "b": 5.8, "c": 6.6}
    labs = [label(id=k, peak_id=f"p_{k}", ms_rt_min=rt) for k, rt in rts.items()]
    assert ambiguity(labs, RULES) == {}
    far = labs + [label(id="d", peak_id="p_d", ms_rt_min=12.0)]
    flagged = ambiguity(far, RULES)  # the 3-peak cluster is the real one; the lone far peak is doubtful
    assert flagged == {"d": ["ambiguous: 3-Ser is also the top label of p_a, p_b, p_c, more than 1 min away"]}
    assert set(ambiguity(labs, RULES.model_copy(update={"isomer_window_min": 0.0}))) == {"a", "b", "c"}


def test_runner_up_that_tops_another_peak_is_a_tail():
    labs = [label(id="top", peak_id="p1"), label(id="tail", peak_id="p2", rank=2), label(id="own", peak_id="p2", species="4-Ser", dp=4)]
    flagged = ambiguity(labs, RULES)
    assert set(flagged) == {"tail"}
    assert "tail of p1" in flagged["tail"][0]


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


def test_dry_down_chemistry_limits_amino_acids_per_chain():
    assert check_chemistry(label(amino_acids=3, hydroxy_acids=0), RULES) == []
    assert check_chemistry(label(amino_acids=4, hydroxy_acids=2), RULES) == [
        "unlikely chemistry: 4 amino acids in one chain (a dry-down rarely adds more than 3)"
    ]
    assert "and no hydroxy acid" in check_chemistry(label(amino_acids=5, hydroxy_acids=0), RULES)[0]
    assert all(r.startswith(IMPLAUSIBLE) for r in check_chemistry(label(amino_acids=5), RULES))


def test_label_needs_a_neighbour_in_its_series():
    # 6-Glc + 2-Arg alone among n-Glc + 1-Arg: no 5- or 7-Glc + 2-Arg anywhere → no neighbours.
    def lab(i, glc, arg, **kw):
        return label(id=i, peak_id=f"p{i}", species=f"{glc}-Glc + {arg}-Arg", dp=glc + arg,
                     counts={"Glc": glc, "Arg": arg}, hydroxy_names=["Glc"], **kw)
    labs = [lab("a", 4, 1), lab("b", 5, 1), lab("c", 6, 1), lab("d", 6, 2), lab("e", 3, 2), lab("f", 4, 2), lab("g", 1, 1)]
    flagged = series_neighbours(labs, RULES)
    assert set(flagged) == {"d"}
    assert flagged["d"] == ["no series neighbours: no 5-Glc + 2-Arg or 7-Glc + 2-Arg labelled anywhere in the run"]
    assert flagged["d"][0].startswith(IMPLAUSIBLE)


def test_ion_present_all_through_the_run_is_an_artifact():
    assert check_artifact(label(constant_ratio=0.2), RULES) == []
    assert check_artifact(label(constant_ratio=None), RULES) == []
    assert check_artifact(label(constant_ratio=0.8), RULES) == [
        "artifact: the ion is present all through the run (median 80% of its height here)"
    ]


def test_failed_peaks_do_not_make_a_label_ambiguous():
    labs = [label(id="real", peak_id="p1", ms_rt_min=5.0), label(id="junk", peak_id="p2", ms_rt_min=20.0)]
    assert set(ambiguity(labs, RULES)) == {"real", "junk"}
    assert set(ambiguity(labs, RULES, bad_peaks={"p2"})) == {"junk"}
