import numpy as np
import pytest
from unittest.mock import MagicMock
from app.services import lcms_service
from lab_gui.lcms_model import SpectrumMeta


def test_extracted_ion_chromatogram_ppm(monkeypatch):
    meta1 = SpectrumMeta(spectrum_id="scan=1", ms_level=1, polarity="positive", rt_min=1.0, tic=530.0)
    mz1 = np.array([100.0, 500.002, 800.0], dtype=float)
    int1 = np.array([10.0, 500.0, 20.0], dtype=float)

    meta2 = SpectrumMeta(spectrum_id="scan=2", ms_level=1, polarity="positive", rt_min=2.0, tic=840.0)
    mz2 = np.array([100.0, 500.015, 800.0], dtype=float)
    int2 = np.array([15.0, 800.0, 25.0], dtype=float)

    def fake_iter_ms1(state, **kwargs):
        yield meta1, mz1, int1
        yield meta2, mz2, int2

    monkeypatch.setattr(lcms_service, "iter_ms1_spectra", fake_iter_ms1)

    state = MagicMock()

    # 1. Test Da tolerance
    res_da = lcms_service.extracted_ion_chromatogram(state, 500.0, tolerance=0.01, tolerance_unit="da")
    assert res_da["target_mz"] == 500.0
    assert res_da["tolerance"] == 0.01
    assert res_da["tolerance_unit"] == "da"
    assert res_da["intensity"] == [500.0, 0.0]
    assert res_da["best"]["rt_min"] == 1.0

    # 2. Test ppm tolerance (tight: 5 ppm of 500.0 is 0.0025 Da)
    res_tight = lcms_service.extracted_ion_chromatogram(state, 500.0, tolerance=5.0, tolerance_unit="ppm")
    assert res_tight["target_mz"] == 500.0
    assert pytest.approx(res_tight["tolerance"], rel=1e-5) == 0.0025
    assert res_tight["tolerance_unit"] == "ppm"
    assert res_tight["intensity"] == [500.0, 0.0]

    # 3. Test ppm tolerance (broad: 40 ppm of 500.0 is 0.020 Da)
    res_broad = lcms_service.extracted_ion_chromatogram(state, 500.0, tolerance=40.0, tolerance_unit="ppm")
    assert pytest.approx(res_broad["tolerance"], rel=1e-5) == 0.020
    assert res_broad["intensity"] == [500.0, 800.0]
    assert res_broad["best"]["rt_min"] == 2.0

    # 4. Test find_mz_across_scans with ppm
    res_find = lcms_service.find_mz_across_scans(state, 500.0, tolerance=5.0, tolerance_unit="ppm")
    assert res_find["target_mz"] == 500.0
    assert pytest.approx(res_find["tolerance"], rel=1e-5) == 0.0025
    assert res_find["tolerance_unit"] == "ppm"
    assert res_find["best"]["intensity"] == 500.0
