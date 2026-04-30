import numpy as np

from lab_gui.ftir_analysis import mask_atmospheric_regions, preprocess_spectrum


def synthetic_spectrum():
    x = np.linspace(700.0, 3800.0, 600)
    baseline = 0.0002 * (x - x.mean()) + 0.15
    peak = np.exp(-0.5 * ((x - 1715.0) / 22.0) ** 2)
    shoulder = 0.4 * np.exp(-0.5 * ((x - 1240.0) / 35.0) ** 2)
    return x, baseline + peak + shoulder


def test_rubberband_baseline_preserves_shape_and_size():
    x, y = synthetic_spectrum()
    x_out, y_out = preprocess_spectrum(x, y, baseline="rubberband")

    assert x_out.shape == x.shape
    assert y_out.shape == y.shape
    assert np.isfinite(y_out).all()
    assert y_out.max() > 0.5


def test_asls_baseline_and_snv_normalization_are_finite():
    x, y = synthetic_spectrum()
    _x_out, y_out = preprocess_spectrum(
        x,
        y,
        baseline="asls",
        normalize="snv",
        baseline_lambda=10000,
        baseline_p=0.01,
    )

    assert np.isfinite(y_out).all()
    assert abs(float(np.mean(y_out))) < 1e-6
    assert 0.9 < float(np.std(y_out)) < 1.1


def test_vector_and_minmax_normalization():
    x, y = synthetic_spectrum()
    _x_vec, y_vec = preprocess_spectrum(x, y, normalize="vector")
    _x_mm, y_mm = preprocess_spectrum(x, y, normalize="min-max")

    assert np.isclose(float(np.sqrt(np.sum(y_vec * y_vec))), 1.0)
    assert np.isclose(float(y_mm.min()), 0.0)
    assert np.isclose(float(y_mm.max()), 1.0)


def test_atmospheric_mask_removes_expected_regions():
    x = np.array([1200.0, 1500.0, 2350.0, 2500.0, 3600.0])
    y = np.arange(x.size, dtype=float)
    x_masked, y_masked = mask_atmospheric_regions(x, y)

    assert x_masked.tolist() == [1200.0, 2500.0]
    assert y_masked.tolist() == [0.0, 3.0]


def test_atr_correction_changes_intensity_scale():
    x, y = synthetic_spectrum()
    _x_out, corrected = preprocess_spectrum(x, y, atr_correction=True, atr_n_crystal=1.5)

    assert corrected.shape == y.shape
    assert np.isfinite(corrected).all()
    assert not np.allclose(corrected, y)
