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
