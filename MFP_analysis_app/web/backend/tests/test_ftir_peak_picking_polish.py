import numpy as np
import pytest

from lab_gui.ftir_analysis import pick_peaks, pick_peaks_second_derivative


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


def test_peak_width_is_the_full_width_at_half_maximum():
    wn = np.linspace(400, 4000, 3601)
    # Gaussian of FWHM 30 cm^-1 on a sloping baseline, next to a much wider band.
    sigma = 30 / 2.3548
    y = np.exp(-0.5 * ((wn - 1750) / sigma) ** 2) + 0.4 * np.exp(-0.5 * ((wn - 3400) / 120) ** 2) + wn * 1e-4
    peaks = pick_peaks(wn, y, min_prominence=0.1)
    carbonyl = next(p for p in peaks if abs(p.wn - 1750) < 2)
    assert carbonyl.width_cm1 == pytest.approx(30, abs=2)
