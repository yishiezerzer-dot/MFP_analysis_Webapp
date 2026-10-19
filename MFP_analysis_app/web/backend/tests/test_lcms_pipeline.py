"""LCMS pipeline core: alignment, UV peak picking, label parsing, and a run on the example data."""
import shutil
from pathlib import Path

import numpy as np
import pytest

from app.db import get_upload_dir
from app.services.lcms_pipeline import (
    PipelineSettings,
    align_uv_to_ms,
    parse_label,
    pick_uv_peaks,
    PipelineLabel,
    UVPeak,
    monomer_kind,
    plot_frame,
    promote_plausible,
    rank_candidates,
    run_pipeline,
)
from app.services.lcms_service import attach_uv_from_csv, registry

DATA = Path(__file__).resolve().parents[1] / "app" / "examples" / "data"
GA, LA = 76.016044, 90.031694


def gaussians(t, centres, width=0.06, heights=None):
    heights = heights or [1.0] * len(centres)
    return sum(h * np.exp(-0.5 * ((t - c) / width) ** 2) for c, h in zip(centres, heights))


@pytest.mark.parametrize("true_offset", [0.12, -0.25, 0.0])
def test_alignment_recovers_a_synthetic_shift(true_offset):
    centres = [2.0, 3.1, 4.7, 6.2, 8.0]
    heights = [1.0, 0.4, 0.8, 0.3, 0.6]
    ms_rt = np.arange(0, 10, 0.05)
    uv_rt = np.arange(0, 10, 0.01)
    ms = gaussians(ms_rt, centres, heights=heights) + 0.02
    # The UV sees the same peaks `true_offset` minutes earlier, on a drifting baseline.
    uv = gaussians(uv_rt, [c - true_offset for c in centres], heights=heights[::-1]) + 0.05 * uv_rt
    result = align_uv_to_ms(ms_rt, ms, uv_rt, uv, max_lag_min=1.0)
    assert result.method == "xcorr"
    assert result.offset_min == pytest.approx(true_offset, abs=0.015)


def test_uv_peaks_have_widths_areas_and_sn():
    rng = np.random.default_rng(0)
    t = np.arange(0, 10, 0.01)
    y = gaussians(t, [2.0, 5.0, 7.5], width=0.08, heights=[100, 10, 1.0]) + rng.normal(0, 0.1, t.size)
    peaks, noise = pick_uv_peaks(t, y, offset_min=0.1)
    big = [p for p in peaks if p.sn > 50]
    assert [round(p.rt_min, 1) for p in big] == [2.0, 5.0]
    first = big[0]
    assert first.width_min == pytest.approx(2.355 * 0.08, rel=0.1)  # FWHM of a Gaussian
    assert first.start_min < first.rt_min < first.end_min
    assert first.area == pytest.approx(100 * 0.08 * np.sqrt(2 * np.pi), rel=0.1)
    assert first.ms_rt_min == pytest.approx(first.rt_min + 0.1)
    assert noise == pytest.approx(0.1, rel=0.3)
    assert any(abs(p.rt_min - 7.5) < 0.05 for p in peaks)  # the small one is kept (rules flag it later)


def test_a_hump_on_a_big_peaks_tail_is_not_a_distinct_peak():
    # G1-like: a small bump on the slow tail of a large peak vs an equally tall sharp peak on the baseline.
    t = np.arange(0, 20, 0.0067)
    tail = 1500 * np.exp(-0.5 * ((t - 3.0) / 0.03) ** 2) + 30 * np.exp(-np.clip(t - 3.0, 0, None) / 2.0) * (t > 3.0)
    y = tail + gaussians(t, [4.6, 14.5], width=0.05, heights=[4.0, 25.0])
    peaks, _ = pick_uv_peaks(t, y)
    hump = next(p for p in peaks if abs(p.rt_min - 4.6) < 0.05)
    sharp = next(p for p in peaks if abs(p.rt_min - 14.5) < 0.05)
    assert hump.rise_frac < 0.3 < sharp.rise_frac
    assert hump.sharpness_rel < 0.5 < sharp.sharpness_rel


def test_other_adducts_only_when_the_peak_has_no_protonated_match():
    na_big = {"text": "3-GA [M+Na]⁺", "mz": 233.0, "intensity": 900.0, "abs_err": 0.05}
    h_small = {"text": "1-GA + 1-Arg [M+H]⁺", "mz": 233.1, "intensity": 300.0, "abs_err": 0.05}
    ranked = rank_candidates([na_big, h_small], 1000.0, 0.5, adduct_fallback=True)
    assert [c["species"] for c in ranked] == ["1-GA + 1-Arg"]
    assert [c["species"] for c in rank_candidates([na_big], 1000.0, 0.5, adduct_fallback=True)] == ["3-GA"]
    assert len(rank_candidates([na_big, h_small], 1000.0, 0.5, adduct_fallback=False)) == 2


def test_label_text_is_split_into_parts():
    p = parse_label("2-GA + 1-LA -H2O [M+Na]⁺")
    assert p["counts"] == {"GA": 2, "LA": 1} and p["dp"] == 3 and p["series"] == "GA+LA"
    assert p["variant"] == "-H2O" and p["adduct"] == "Na" and p["species"] == "2-GA + 1-LA -H2O"
    assert parse_label("3-Ser [M−H]⁻")["adduct"] == "H"
    assert parse_label("2-GA [M+2H]²⁺")["charge"] == 2
    assert parse_label("not a label") is None


def open_example():
    up = get_upload_dir("lcms")
    mz = up / "pipeline_test.mzML"
    uv = up / "pipeline_test_uv.csv"
    shutil.copyfile(DATA / "example_plga.mzML", mz)
    shutil.copyfile(DATA / "example_plga_uv.csv", uv)
    state = registry.add_from_path(mz, workspace_id="pipeline_ws", display_name="example", rt_unit="minutes")
    attach_uv_from_csv(state, uv, filename="uv.csv")
    return state


def test_example_run_finds_the_oligomers():
    settings = PipelineSettings(
        monomers=[{"name": "GA", "mass": GA}, {"name": "LA", "mass": LA}],
        rules={"elution_direction": "increasing"},  # in this synthetic method longer chains elute later
    )
    steps = []
    result = run_pipeline(open_example(), settings, lambda f, s: steps.append((f, s)))
    assert result.alignment.offset_min == pytest.approx(0.12, abs=0.02)  # the UV detector leads by 0.12 min
    assert steps[-1] == (1.0, "Done") and all(a[0] <= b[0] for a, b in zip(steps, steps[1:]))
    top = {round(p.ms_rt_min, 2): next(l for l in result.labels if l.id == p.label_ids[0]).species for p in result.peaks}
    # Truth from make_examples.py: RT = 1.2 + 1.35·DP + 0.28·n_LA.
    assert top[3.9] == "2-GA" and top[4.18] == "1-GA + 1-LA" and top[4.46] == "2-LA"
    approved = [l for l in result.labels if l.review == "approved"]
    assert len(approved) >= 15
    assert all(l.status == "ok" and l.rank == 1 and l.layout is not None for l in approved)
    assert all(l.layout is None for l in result.labels if l.review != "approved")
    peak_by_id = {p.id: p for p in result.peaks}
    for lab in approved:  # label centres in data units: above the peak, near it in time
        assert lab.layout.y_data > peak_by_id[lab.peak_id].apex
        assert abs(lab.layout.x_data - peak_by_id[lab.peak_id].rt_min) < 1.0
    assert all(l.status == "alternative" for l in result.labels if l.rank > 2)
    # The figure starts at the start of the run and ends just after the last labelled peak.
    frame = plot_frame(result)
    ends = [peak_by_id[l.peak_id].end_min for l in approved]
    assert frame.x_min == result.uv_rt[0] and max(ends) < frame.x_max <= result.uv_rt[-1]
    result.labels = [l.model_copy(update={"review": "pending"}) for l in result.labels]
    assert plot_frame(result).x_min <= min(p.start_min for p in result.peaks)  # nothing approved: all peaks


def test_ions_present_all_through_the_run_are_artifacts():
    from app.services.lcms_pipeline import _eic_facts

    state = open_example()
    _, plasticiser = _eic_facts(state, 391.28, 0.5, "positive", 4.0, 0.5)
    _, oligomer = _eic_facts(state, 149.04, 0.5, "positive", 4.0, 0.5)  # 2-GA [M+H]⁺, elutes at 3.9 min
    assert plasticiser > 0.5 > oligomer


def test_flank_background_subtraction_removes_ions_present_all_through_the_run():
    from app.services.lcms_pipeline import peak_window_spectrum, pick_uv_peaks

    state = open_example()
    on = PipelineSettings(monomers=[{"name": "GA", "mass": GA}], background={"method": "flanks"})
    off = on.model_copy(update={"background": on.background.model_copy(update={"enabled": False})})
    peaks, _ = pick_uv_peaks(state.uv.rt_min, state.uv.signal, offset_min=0.12)
    peak = max(peaks, key=lambda p: p.prominence)

    def near(spec, mz):
        return sum(i for m, i in zip(spec.mz, spec.intensity) if abs(m - mz) < 0.3)

    raw = peak_window_spectrum(state, peak, off, 0.12, 0.05)
    clean = peak_window_spectrum(state, peak, on, 0.12, 0.05)
    assert near(clean, 391.28) < 0.2 * near(raw, 391.28)  # the plasticiser in every scan
    assert near(clean, 149.04) > 0.8 * near(raw, 149.04)  # the oligomer eluting in this peak stays
    assert clean.background_scans > 0 and 0 < clean.background_removed < 1


def test_chain_forms_and_charges_are_validated_and_named():
    from app.services.lcms_pipeline import tag_form

    s = PipelineSettings(monomers=[{"name": "GA", "mass": GA}], forms={"cyclic": True, "end_groups": [{"name": "Me ester", "mass": 14.01565}]}, charges=[2, 1, 1])
    assert s.forms.forms(s.bond_delta) == [("linear", 0.0), ("cyclic", s.bond_delta), ("Me ester", 14.01565)]
    assert s.charges == [1, 2]
    parsed, text = tag_form(parse_label("3-GA [M+H]⁺"), "3-GA [M+H]⁺", "cyclic")
    assert text == "3-GA (cyclic) [M+H]⁺" and parsed["series"] == "GA (cyclic)"
    with pytest.raises(ValueError):
        PipelineSettings(monomers=[{"name": "GA", "mass": GA}], forms={"linear": False})
    with pytest.raises(ValueError):
        PipelineSettings(monomers=[{"name": "GA", "mass": GA}], charges=[0, 9])


def test_monomer_kind_is_known_from_its_name():
    assert [monomer_kind(n) for n in ("Arg", "His", "lysine", "Glc", "GA", "Lac", "lactic acid", "X1")] == [
        "amino_acid", "amino_acid", "amino_acid", "hydroxy_acid", "hydroxy_acid", "hydroxy_acid", "hydroxy_acid", "other"
    ]
    assert PipelineSettings(monomers=[{"name": "Foo", "mass": 100, "kind": "amino_acid"}]).monomers[0].kind == "amino_acid"


def _lab(rank, species, reasons):
    return PipelineLabel(
        id=f"P1-{rank}", peak_id="P1", rank=rank, text=f"{species} [M+H]⁺", species=species, series="", dp=1, counts={},
        variant="", adduct="H", charge=1, mz=100.0, abs_err_da=0.0, intensity=1.0, rel_intensity=1.0, score=1.0, ions=[],
        reasons=reasons, status="flagged" if reasons else "ok",
    )


def test_an_implausible_top_candidate_gives_way_to_the_next_plausible_one():
    peak = UVPeak(id="P1", rt_min=12.6, ms_rt_min=12.7, apex=74, start_min=12.6, end_min=12.7, width_min=0.04, area=1,
                  sn=100, prominence=12, prominence_rel=0.01, label_ids=["P1-1", "P1-2", "P1-3"])
    labels = [
        _lab(1, "6-Glc + 2-Arg", ["no series neighbours: no 5-Glc + 2-Arg or 7-Glc + 2-Arg labelled anywhere in the run"]),
        _lab(2, "4-Glc + 1-Arg", ["EIC apex at 12.65 min, +0.26 min from the UV apex"]),  # doubtful, not implausible
        _lab(3, "1-Arg", []),
    ]
    assert promote_plausible([peak], labels, tried={}) is True
    assert {lab.species: lab.rank for lab in labels} == {"4-Glc + 1-Arg": 1, "6-Glc + 2-Arg": 2, "1-Arg": 3}
    assert peak.label_ids == ["P1-2", "P1-1", "P1-3"]
    assert promote_plausible([peak], labels, tried={}) is False  # the new top label is not implausible
