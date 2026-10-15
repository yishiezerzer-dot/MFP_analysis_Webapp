"""LCMS pipeline core: alignment, UV peak picking, label parsing, and a run on the example data."""
import shutil
from pathlib import Path

import numpy as np
import pytest

from app.db import get_upload_dir
from app.services.lcms_pipeline import PipelineSettings, align_uv_to_ms, parse_label, pick_uv_peaks, run_pipeline
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
    assert all(l.status == "alternative" for l in result.labels if l.rank > 2)
