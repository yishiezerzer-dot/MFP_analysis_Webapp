import numpy as np
import pandas as pd
import pytest

from lab_gui.plate_reader_model import (
    fit_4pl_curve,
    build_mic_wizard_config_and_result,
)


def test_fit_4pl_curve_recovers_parameters():
    # Generate synthetic sigmoidal dose-response data:
    # Top = 1.0, Bottom = 0.05, IC50 = 8.0, Hill = -1.5
    concs = np.array([64.0, 32.0, 16.0, 8.0, 4.0, 2.0, 1.0, 0.5])
    true_top, true_bottom, true_ic50, true_hill = 1.0, 0.05, 8.0, -1.5
    y = true_bottom + (true_top - true_bottom) / (1.0 + (concs / true_ic50) ** true_hill)

    res = fit_4pl_curve(concs, y)
    assert res is not None
    assert abs(res["ic50"] - true_ic50) < 0.5
    assert res["r_squared"] > 0.99
    assert len(res["curve_x"]) == 80
    assert len(res["curve_y"]) == 80


def test_fit_4pl_curve_handles_insufficient_points():
    res = fit_4pl_curve([1.0, 2.0], [0.5, 0.2])
    assert res is None


def test_blank_variance_propagation():
    # Create DataFrame with 2 sample rows, 2 blank rows
    data = {
        "1": [1.0, 1.2, 0.1, 0.12],
        "2": [0.8, 0.85, 0.1, 0.11],
        "3": [0.5, 0.55, 0.1, 0.09],
        "4": [0.2, 0.25, 0.1, 0.10],
    }
    df = pd.DataFrame(data)

    # Run without blank subtraction
    cfg_raw, res_raw, _ = build_mic_wizard_config_and_result(
        df,
        use_first_row_as_header=False,
        sample_rows=[0, 1],
        control_rows=[],
        blank_rows=[2, 3],
        subtract_blank=False,
        concentration_columns=["1", "2", "3", "4"],
        tick_text="64,32,16,8",
        auto_tick_labels_power2=False,
        title="Test",
        x_label="Conc",
        y_label="OD",
        plot_type="scatter",
        control_style="bars",
    )

    # Run with blank subtraction
    cfg_sub, res_sub, _ = build_mic_wizard_config_and_result(
        df,
        use_first_row_as_header=False,
        sample_rows=[0, 1],
        control_rows=[],
        blank_rows=[2, 3],
        subtract_blank=True,
        concentration_columns=["1", "2", "3", "4"],
        tick_text="64,32,16,8",
        auto_tick_labels_power2=False,
        title="Test",
        x_label="Conc",
        y_label="OD",
        plot_type="scatter",
        control_style="bars",
    )

    # When blank is subtracted, sample_std must properly compound blank variance:
    # sqrt(sample_std^2 + blank_std^2) >= sample_std
    for std_raw, std_sub in zip(res_raw.sample_std, res_sub.sample_std):
        assert std_sub >= std_raw
    assert res_sub.four_pl is not None
