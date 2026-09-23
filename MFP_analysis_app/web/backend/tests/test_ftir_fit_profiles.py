import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.ftir_service import FTIRSession, fit_peak_region

# Wide window (±20 FWHM) so the fit's linear end-point baseline barely clips Lorentzian tails.
X = np.linspace(1300, 2100, 3201)
PRE = {"mode": "absorbance", "smoothing_window": 0, "poly_order": 2, "baseline": "none", "normalize": "none"}


def _session(y: np.ndarray) -> FTIRSession:
    return FTIRSession(session_id="t", display_name="t", path=None, x=X, y=y)  # type: ignore[arg-type]


@pytest.mark.parametrize(
    "profile,shape",
    [
        ("gauss", lambda x, f: np.exp(-0.5 * ((x - 1700) / (f / 2.35482)) ** 2)),
        ("lorentz", lambda x, f: 1 / (1 + ((x - 1700) / (f / 2)) ** 2)),
        (
            "voigt",
            lambda x, f: 0.5 * np.exp(-0.5 * ((x - 1700) / (f / 2.35482)) ** 2) + 0.5 / (1 + ((x - 1700) / (f / 2)) ** 2),
        ),
    ],
)
def test_fitted_fwhm_matches_true_fwhm(profile, shape):
    fwhm = 20.0
    out = fit_peak_region(_session(shape(X, fwhm)), region=(1300, 2100), n_components=1, profile=profile, preprocess=PRE)
    comp = out["components"][0]
    assert comp["center"] == pytest.approx(1700.0, abs=0.1)
    assert comp["fwhm"] == pytest.approx(fwhm, rel=0.01)


def test_msc_normalisation_is_rejected():
    client = TestClient(app)
    resp = client.post("/api/ftir/sessions/nonexistent/spectrum", json={"normalize": "msc"})
    assert resp.status_code == 422


def test_failed_fit_is_reported_not_returned_as_result(monkeypatch):
    import scipy.optimize

    def boom(*_args, **_kwargs):
        raise RuntimeError("Optimal parameters not found")

    monkeypatch.setattr(scipy.optimize, "curve_fit", boom)
    y = np.exp(-0.5 * ((X - 1700) / 8.0) ** 2)
    out = fit_peak_region(_session(y), region=(1300, 2100), n_components=2, profile="gauss", preprocess=PRE)
    assert out["converged"] is False
    assert "Optimal parameters not found" in out["fit_error"]


def test_successful_fit_reports_converged():
    y = np.exp(-0.5 * ((X - 1700) / 8.0) ** 2)
    out = fit_peak_region(_session(y), region=(1300, 2100), n_components=1, profile="gauss", preprocess=PRE)
    assert out["converged"] is True and out["fit_error"] is None


def test_more_components_than_detected_peaks_does_not_crash():
    y = np.exp(-0.5 * ((X - 1700) / 8.0) ** 2)
    out = fit_peak_region(_session(y), region=(1300, 2100), n_components=3, profile="gauss", preprocess=PRE)
    assert len(out["components"]) == 3
