from pathlib import Path

import numpy as np

from web.backend.app.services.ftir_service import FTIRSession, fit_peak_region


PREPROCESS = {
    "mode": "absorbance",
    "smoothing_window": 0,
    "poly_order": 2,
    "baseline": "none",
    "normalize": "none",
    "baseline_lambda": 100000.0,
    "baseline_p": 0.01,
    "atr_correction": False,
    "atr_n_crystal": 1.5,
}


def test_fit_peak_region_recovers_two_gaussian_centers():
    x = np.linspace(1500.0, 1800.0, 700)
    y = (
        0.85 * np.exp(-0.5 * ((x - 1638.0) / 11.0) ** 2)
        + 0.55 * np.exp(-0.5 * ((x - 1692.0) / 15.0) ** 2)
    )
    session = FTIRSession(
        session_id="fit",
        display_name="fit",
        path=Path("fit.csv"),
        x=x,
        y=y,
    )

    result = fit_peak_region(
        session,
        region=(1600.0, 1730.0),
        n_components=2,
        profile="gauss",
        preprocess=PREPROCESS,
    )
    centers = sorted(component["center"] for component in result["components"])

    assert abs(centers[0] - 1638.0) < 6.0
    assert abs(centers[1] - 1692.0) < 8.0
    assert result["r2"] is not None and result["r2"] > 0.9
