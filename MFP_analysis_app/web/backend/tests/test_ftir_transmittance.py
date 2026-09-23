import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.main import app
from lab_gui.ftir_analysis import detect_y_mode, preprocess_spectrum

X = np.linspace(600, 4000, 3401)


def _absorbance() -> np.ndarray:
    def band(c, w, a):
        return a * np.exp(-0.5 * ((X - c) / w) ** 2)

    return band(1735, 10, 0.8) + band(2950, 15, 0.3) + band(1180, 12, 0.5) + 0.05 + 2e-5 * (X - 600)


def _height_at(y: np.ndarray, wn: float) -> float:
    return float(y[int(np.argmin(np.abs(X - wn)))])


@pytest.mark.parametrize("baseline", ["rubberband", "asls", "airpls", "polyfit"])
@pytest.mark.parametrize("scale", [100.0, 1.0], ids=["percent_T", "fraction_T"])
def test_transmittance_is_processed_as_absorbance(baseline, scale):
    a = _absorbance()
    t = scale * 10 ** (-a)
    _, from_a = preprocess_spectrum(X, a, mode="absorbance", baseline=baseline)
    _, from_t = preprocess_spectrum(X, t, mode="transmittance", baseline=baseline)
    for wn in (1735, 2950, 1180):
        assert _height_at(from_t, wn) == pytest.approx(_height_at(from_a, wn), rel=0.02, abs=0.005)


def test_transmittance_without_baseline_is_converted():
    a = _absorbance()
    _, y = preprocess_spectrum(X, 100 * 10 ** (-a), mode="transmittance")
    assert np.allclose(y, a, atol=1e-9)


@pytest.mark.parametrize(
    "meta,y,expected",
    [
        ({"YUNITS": "%T"}, _absorbance(), "transmittance"),
        ({"YUNITS": "TRANSMITTANCE"}, _absorbance(), "transmittance"),
        ({"YUNITS": "ABSORBANCE"}, 100 * 10 ** (-_absorbance()), "absorbance"),
        ({}, 100 * 10 ** (-_absorbance()), "transmittance"),
        ({}, 10 ** (-_absorbance()), "transmittance"),
        ({}, _absorbance(), "absorbance"),
    ],
)
def test_detect_y_mode(meta, y, expected):
    assert detect_y_mode(meta, y)[0] == expected


def test_upload_detects_mode_and_peaks_are_positive_absorbance(tmp_path):
    client = TestClient(app)
    t = 100 * 10 ** (-_absorbance())
    csv = "\n".join(f"{x:.2f},{v:.6f}" for x, v in zip(X, t)).encode()
    resp = client.post("/api/ftir/sessions", files={"file": ("sample_T.csv", csv, "text/csv")})
    assert resp.status_code == 200, resp.text
    summary = resp.json()
    assert summary["y_mode"] == "transmittance"

    peaks = client.post(
        f"/api/ftir/sessions/{summary['session_id']}/peaks",
        json={"mode": "transmittance", "baseline": "airpls", "min_prominence": 0.05},
    ).json()["peaks"]
    by_wn = {round(p["wn"]): p["y"] for p in peaks}
    assert 1735 in by_wn and by_wn[1735] == pytest.approx(0.8, rel=0.05)


@pytest.mark.parametrize(
    "content",
    [
        "\n".join(f"{600 + i},{0.5 + 0.001 * i}" for i in range(20)),
        "wavenumber,absorbance\n" + "\n".join(f"{600 + i},{0.5 + 0.001 * i}" for i in range(20)),
        "\n".join(f"{600 + i};{0.5 + 0.001 * i}" for i in range(20)),
        "\n".join(f"{600 + i}\t{0.5 + 0.001 * i}" for i in range(20)),
    ],
    ids=["comma", "comma_with_header", "semicolon", "tab"],
)
def test_parser_reads_common_delimited_exports(tmp_path, content):
    from lab_gui.ftir_io import _parse_ftir_xy_numpy

    path = tmp_path / "spectrum.csv"
    path.write_text(content, encoding="utf-8")
    x, y, _meta = _parse_ftir_xy_numpy(str(path))
    assert x.size == 20
    assert x[0] == pytest.approx(600.0) and y[0] == pytest.approx(0.5)


def test_metadata_scan_does_not_store_data_rows(tmp_path):
    from lab_gui.ftir_io import _parse_ftir_xy_numpy

    path = tmp_path / "plain.csv"
    path.write_text("\n".join(f"{600 + i},{0.5}" for i in range(3000)), encoding="utf-8")
    _x, _y, meta = _parse_ftir_xy_numpy(str(path))
    assert len(meta) == 0


def test_metadata_header_before_xydata_is_kept(tmp_path):
    from lab_gui.ftir_io import _parse_ftir_xy_numpy

    rows = "\n".join(f"{600 + i},{0.5}" for i in range(50))
    path = tmp_path / "with_meta.csv"
    path.write_text(f"TITLE,Sample A\nYUNITS,%T\nXYDATA\n{rows}\n", encoding="utf-8")
    x, _y, meta = _parse_ftir_xy_numpy(str(path))
    assert meta == {"TITLE": "Sample A", "YUNITS": "%T"}
    assert x.size == 50
