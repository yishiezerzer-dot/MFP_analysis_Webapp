import pytest
from fastapi.testclient import TestClient

from app.main import app
from test_mzml_fast_index import _generate_synthetic_mzml

client = TestClient(app)


@pytest.fixture(scope="module")
def positive_only_sid():
    resp = client.post(
        "/api/lcms/sessions",
        files={"file": ("positive_only.mzML", _generate_synthetic_mzml(num_scans=5), "application/octet-stream")},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["session_id"]


@pytest.mark.parametrize(
    "method,path,body",
    [
        ("get", "/spectrum?rt_min=0.1&polarity=negative", None),
        ("post", "/eic", {"mz": 500.0, "tolerance": 0.5, "polarity": "negative"}),
        ("post", "/region-spectrum", {"rt_min": 0.0, "rt_max": 0.2, "polarity": "negative"}),
        ("post", "/deconvolute", {"rt_min": 0.1, "polarity": "negative"}),
        ("get", "/exports/labels.csv?polarity=negative", None),
    ],
)
def test_missing_polarity_is_an_error_not_a_fallback(positive_only_sid, method, path, body):
    url = f"/api/lcms/sessions/{positive_only_sid}{path}"
    resp = client.get(url) if method == "get" else client.post(url, json=body)
    assert resp.status_code == 400
    assert "negative" in resp.json()["detail"]


def test_matching_polarity_still_works(positive_only_sid):
    resp = client.get(f"/api/lcms/sessions/{positive_only_sid}/spectrum?rt_min=0.1&polarity=positive")
    assert resp.status_code == 200
    assert resp.json()["meta"]["polarity"] == "positive"


def test_no_polarity_filter_uses_all_scans(positive_only_sid):
    resp = client.post(f"/api/lcms/sessions/{positive_only_sid}/eic", json={"mz": 500.0, "tolerance": 0.5})
    assert resp.status_code == 200
    assert resp.json()["n_scans"] == 5


@pytest.mark.parametrize("body", [{"rt_min": 0.1, "polarity": "positive"}, {"polarity": "positive"}])
def test_deconvolute_single_scan_and_tic_apex_paths(positive_only_sid, body):
    resp = client.post(f"/api/lcms/sessions/{positive_only_sid}/deconvolute", json=body)
    assert resp.status_code == 200, resp.text
