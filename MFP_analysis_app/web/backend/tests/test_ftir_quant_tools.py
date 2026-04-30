from pathlib import Path

import numpy as np

from web.backend.app.services.ftir_service import FTIRSession, integrate_region, subtract_sessions


def session(y_shift: float = 0.0, scale: float = 1.0) -> FTIRSession:
    x = np.linspace(900.0, 1900.0, 500)
    y = y_shift + scale * np.exp(-0.5 * ((x - 1715.0) / 25.0) ** 2)
    return FTIRSession(
        session_id=f"s{scale}",
        display_name="synthetic",
        path=Path("synthetic.csv"),
        x=x,
        y=y,
    )


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


def test_integrate_region_reports_area_height_and_peak():
    result = integrate_region(
        session(),
        region=(1680.0, 1760.0),
        baseline_mode="linear",
        preprocess=PREPROCESS,
    )

    assert result["area"] > 30.0
    assert result["height"] > 0.5
    assert 1700.0 < result["peak_wn"] < 1730.0
    assert result["fwhm"] is not None


def test_subtract_sessions_can_auto_fit_scale():
    a = session(scale=2.0)
    b = session(scale=1.0)
    result = subtract_sessions(
        a,
        b,
        k=1.0,
        region_minimize=(1680.0, 1760.0),
        preprocess=PREPROCESS,
        max_points=2000,
    )

    assert 1.9 < result["k"] < 2.1
    assert max(abs(value) for value in result["y"]) < 1e-6
