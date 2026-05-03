import numpy as np

from lab_gui.ftir_analysis import pick_peaks_second_derivative


def test_second_derivative_picker_finds_shoulder_peaks():
    x = np.linspace(1500.0, 1800.0, 900)
    y = (
        np.exp(-0.5 * ((x - 1650.0) / 16.0) ** 2)
        + 0.55 * np.exp(-0.5 * ((x - 1690.0) / 18.0) ** 2)
    )

    peaks = pick_peaks_second_derivative(
        x,
        y,
        mode="absorbance",
        min_distance_cm1=20.0,
        top_n=4,
        smoothing_window=11,
        poly_order=3,
    )

    assert any(abs(peak.wn - 1650.0) < 8.0 for peak in peaks)
    assert any(abs(peak.wn - 1690.0) < 8.0 for peak in peaks)
