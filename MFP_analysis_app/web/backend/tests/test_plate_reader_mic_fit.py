import math

import numpy as np
import pandas as pd
import pytest

from lab_gui.plate_reader_model import build_mic_wizard_config_and_result

TRUE_CONC = [64 / 2**i for i in range(11)] + [0.0]
COLS = [str(i) for i in range(1, 13)]


def _od(c: float) -> float:
    return 1.0 if c == 0 else 0.05 + 0.95 / (1 + (c / 2.0) ** 2)


def _plate(noise: float = 0.01) -> pd.DataFrame:
    rng = np.random.default_rng(0)
    return pd.DataFrame([[_od(c) + rng.normal(0, noise) for c in TRUE_CONC] for _ in range(3)], columns=COLS)


def _run(df, **kw):
    args = dict(
        use_first_row_as_header=True,
        sample_rows=[0, 1, 2],
        control_rows=[],
        concentration_columns=COLS,
        tick_text="",
        auto_tick_labels_power2=True,
        title="MIC",
        x_label="Concentration (µg/mL)",
        y_label="OD",
        plot_type="bar",
        control_style="bars",
    )
    args.update(kw)
    return build_mic_wizard_config_and_result(df, **args)


def test_no_fit_when_concentrations_are_placeholders():
    _cfg, res, _ = _run(_plate())
    assert res.x_tick_labels[0] == "1024"
    assert res.four_pl is None
    assert "concentration" in res.four_pl_skipped_reason.lower()


def test_no_fit_from_column_headers():
    _cfg, res, _ = _run(_plate(), auto_tick_labels_power2=False)
    assert res.four_pl is None


def test_fit_with_real_concentrations_recovers_ic50():
    _cfg, res, _ = _run(_plate(), tick_text=",".join(str(c) for c in TRUE_CONC))
    fit = res.four_pl
    assert fit["ic50"] == pytest.approx(2.0, rel=0.02)
    assert fit["ic50_se"] is not None and fit["ic50_se"] > 0
    assert fit["ic50_in_range"] is True


def test_bars_and_curve_share_log2_axis():
    _cfg, res, _ = _run(_plate(), tick_text=",".join(str(c) for c in TRUE_CONC))
    assert res.x_positions[:11] == pytest.approx([math.log2(c) for c in TRUE_CONC[:11]])
    # zero-concentration growth control sits one dilution step below the lowest concentration
    assert res.x_positions[11] == pytest.approx(math.log2(TRUE_CONC[10]) - 1)
    curve = res.four_pl
    assert min(curve["curve_x"]) == pytest.approx(TRUE_CONC[10])
    assert max(curve["curve_x"]) == pytest.approx(64.0)
    assert curve["curve_x_positions"] == pytest.approx([math.log2(x) for x in curve["curve_x"]])


def test_without_concentrations_positions_are_indices():
    _cfg, res, _ = _run(_plate())
    assert res.x_positions == [float(i) for i in range(12)]


def test_ic50_outside_tested_range_is_flagged():
    conc = [0.5, 0.25, 0.125, 0.0625]
    cols = ["a", "b", "c", "d"]
    df = pd.DataFrame([[_od(c) + 0.001 * i for c in conc] for i in range(3)], columns=cols)
    _cfg, res, _ = _run(df, concentration_columns=cols, tick_text=",".join(map(str, conc)))
    if res.four_pl is not None:
        assert res.four_pl["ic50_in_range"] is False


def test_sample_n_counts_numeric_replicates():
    df = _plate()
    df.iloc[0, 0] = "overflow"
    _cfg, res, nan_ratio = _run(df)
    assert res.sample_n[0] == 2
    assert res.sample_n[1] == 3
    assert nan_ratio > 0


def test_blank_error_uses_standard_error_of_blank_mean():
    df = pd.DataFrame({"1": [1.0, 1.2, 0.10, 0.14], "2": [0.8, 0.9, 0.10, 0.14]})
    kw = dict(sample_rows=[0, 1], blank_rows=[2, 3], concentration_columns=["1", "2"], tick_text="2,1")
    _cfg, raw, _ = _run(df, subtract_blank=False, **kw)
    _cfg, sub, _ = _run(df, subtract_blank=True, **kw)
    blank_sd = np.std([0.10, 0.14], ddof=1)
    expected = math.sqrt(raw.sample_std[0] ** 2 + (blank_sd / math.sqrt(2)) ** 2)
    assert sub.sample_std[0] == pytest.approx(expected)


def test_missing_columns_or_rows_raise():
    with pytest.raises(ValueError, match="column"):
        _run(_plate(), concentration_columns=COLS + ["13"])
    with pytest.raises(ValueError, match="row"):
        _run(_plate(), sample_rows=[0, 1, 7])
