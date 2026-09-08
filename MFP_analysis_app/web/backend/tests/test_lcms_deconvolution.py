import sys
from pathlib import Path
BACKEND_ROOT = Path(__file__).resolve().parents[1]
MFP_ROOT = Path(__file__).resolve().parents[3]
if str(MFP_ROOT) not in sys.path:
    sys.path.insert(0, str(MFP_ROOT))
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

import pytest
from lab_gui.lcms_deconvolution import (
    PROTON_MASS,
    calculate_mass_from_mz,
    calculate_mz_from_mass,
    deconvolute_spectrum,
)


def test_calculate_conversions():
    mass = 2845.35
    mz_pos_z3 = calculate_mz_from_mass(mass, 3, "positive")
    # (2845.35 + 3 * 1.00727647) / 3 = 949.457276
    assert abs(mz_pos_z3 - 949.4573) < 0.001
    recovered_mass = calculate_mass_from_mz(mz_pos_z3, 3, "positive")
    assert abs(recovered_mass - mass) < 1e-6

    mz_neg_z2 = calculate_mz_from_mass(mass, 2, "negative")
    # (2845.35 - 2 * 1.00727647) / 2 = 1421.6677
    assert abs(mz_neg_z2 - 1421.6677) < 0.001
    recovered_neg = calculate_mass_from_mz(mz_neg_z2, 2, "negative")
    assert abs(recovered_neg - mass) < 1e-6


def test_multicharge_envelope_positive_mode():
    true_mass = 5240.60
    # Charges z = 3, 4, 5, 6
    charges = [3, 4, 5, 6]
    intensities = [35000.0, 85000.0, 92000.0, 42000.0]
    mzs = [calculate_mz_from_mass(true_mass, z, "positive") for z in charges]

    result = deconvolute_spectrum(
        mz_array=mzs,
        intensity_array=intensities,
        min_charge=1,
        max_charge=8,
        tolerance=0.02,
        tolerance_unit="da",
        polarity="positive",
    )

    assert result["summary"]["total_components"] >= 1
    top_comp = result["components"][0]
    assert abs(top_comp["mass"] - true_mass) < 0.05
    assert set(top_comp["charges"]).issuperset({3, 4, 5, 6})
    assert top_comp["score"] > 0.8
    assert top_comp["total_intensity"] == sum(intensities)

    # Check zero-charge spectrum
    zero_spec = result["zero_charge_spectrum"]
    assert len(zero_spec["mass"]) >= 1
    assert any(abs(m - true_mass) < 0.05 for m in zero_spec["mass"])


def test_multicharge_envelope_negative_mode():
    true_mass = 3410.25
    charges = [2, 3, 4]
    intensities = [50000.0, 90000.0, 45000.0]
    mzs = [calculate_mz_from_mass(true_mass, z, "negative") for z in charges]

    result = deconvolute_spectrum(
        mz_array=mzs,
        intensity_array=intensities,
        min_charge=1,
        max_charge=6,
        tolerance=0.02,
        polarity="negative",
    )

    assert result["summary"]["total_components"] >= 1
    top_comp = result["components"][0]
    assert abs(top_comp["mass"] - true_mass) < 0.05
    assert set(top_comp["charges"]).issuperset({2, 3, 4})


def test_isotopic_spacing_deconvolution():
    # Known doubly charged species z = 2 at m/z = 650.32
    # Neutral mass M = 2 * (650.32 - 1.007276) = 1298.6254
    m0 = 650.32
    m1 = m0 + 1.003355 / 2.0  # +0.5016775
    m2 = m0 + 2.0 * 1.003355 / 2.0

    mzs = [m0, m1, m2]
    intensities = [100000.0, 60000.0, 18000.0]

    result = deconvolute_spectrum(
        mz_array=mzs,
        intensity_array=intensities,
        min_charge=1,
        max_charge=5,
        tolerance=0.01,
        polarity="positive",
    )

    assert result["summary"]["total_components"] >= 1
    matched = [c for c in result["components"] if abs(c["mass"] - 1298.625) < 0.05]
    assert len(matched) >= 1
    assert 2 in matched[0]["charges"]


def test_empty_and_noise_spectra():
    result = deconvolute_spectrum([], [])
    assert result["components"] == []
    assert result["zero_charge_spectrum"]["mass"] == []

    # Noise only
    result = deconvolute_spectrum([100.0, 200.0, 300.0], [10.0, 10.0, 10.0])
    assert isinstance(result["components"], list)


def test_deconvolute_endpoint(monkeypatch):
    from fastapi.testclient import TestClient
    from app.main import app
    from app.services.lcms_service import LCMSSessionState, registry
    from types import SimpleNamespace
    import threading
    import numpy as np

    client = TestClient(app)

    true_mass = 5240.60
    charges = [3, 4, 5]
    intensities = [35000.0, 85000.0, 92000.0]
    mzs = [calculate_mz_from_mass(true_mass, z, "positive") for z in charges]

    state = LCMSSessionState(
        session_id="test-deconv-sid",
        display_name="Test Deconv",
        path=Path("fake.mzML"),
        index=SimpleNamespace(
            ms1=[SimpleNamespace(spectrum_id="scan=1", rt_min=1.0, tic=1000.0, polarity="positive")],
            stats={"source": "test"},
        ),
        _reader_lock=threading.Lock(),
    )
    with registry._lock:
        registry._sessions[state.session_id] = state

    # Mock fetch_spectrum_at_rt to return our multicharge peaks
    def mock_fetch(st, rt_min=None, polarity=None):
        return (
            SimpleNamespace(spectrum_id="scan=1", rt_min=1.0, ms_level=1, polarity="positive", tic=1000.0),
            np.array(mzs),
            np.array(intensities),
        )

    monkeypatch.setattr("app.routers.lcms.fetch_spectrum_at_rt", mock_fetch)

    resp = client.post(
        f"/api/lcms/sessions/{state.session_id}/deconvolute",
        json={
            "rt_min": 1.0,
            "min_charge": 2,
            "max_charge": 6,
            "tolerance": 0.05,
            "polarity": "positive",
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "components" in data
    assert len(data["components"]) >= 1
    assert abs(data["components"][0]["mass"] - true_mass) < 0.05

