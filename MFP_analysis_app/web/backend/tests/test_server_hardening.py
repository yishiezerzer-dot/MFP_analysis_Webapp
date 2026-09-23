import json

import pytest
from fastapi.testclient import TestClient

from app.main import app
from test_mzml_fast_index import _generate_synthetic_mzml

client = TestClient(app)


@pytest.fixture(scope="module")
def lcms_sid():
    resp = client.post(
        "/api/lcms/sessions",
        files={"file": ("hardening.mzML", _generate_synthetic_mzml(num_scans=5), "application/octet-stream")},
    )
    assert resp.status_code == 200
    return resp.json()["session_id"]


def test_server_path_endpoints_are_gone(lcms_sid, tmp_path):
    secret = tmp_path / "private.csv"
    secret.write_text("t,y\n1,11\n2,22\n3,33\n", encoding="utf-8")
    r1 = client.post("/api/lcms/sessions/from_path", json={"path": str(secret)})
    r2 = client.post(f"/api/lcms/sessions/{lcms_sid}/uv/from_path", json={"path": str(secret)})
    assert r1.status_code in (404, 405)
    assert r2.status_code in (404, 405)


def _no_server_paths(payload, tmp_markers):
    text = json.dumps(payload)
    assert '"path"' not in text
    for marker in tmp_markers:
        assert marker not in text


def test_summaries_do_not_expose_server_paths(lcms_sid, tmp_path):
    from app.db import get_data_dir

    data_dir = str(get_data_dir()).replace("\\", "\\\\")
    uv = client.post(
        f"/api/lcms/sessions/{lcms_sid}/uv",
        files={"file": ("uv.csv", b"time_min,abs\n0,1\n1,2\n2,3\n", "text/csv")},
    )
    assert uv.status_code == 200
    _no_server_paths(uv.json(), [data_dir])
    _no_server_paths(client.get("/api/lcms/sessions").json(), [data_dir])

    ftir = client.post("/api/ftir/sessions", files={"file": ("s.csv", "\n".join(f"{600+i},{0.5}" for i in range(20)).encode(), "text/csv")})
    _no_server_paths(ftir.json(), [data_dir])
    plate = client.post("/api/plate-reader/sessions", files={"file": ("p.csv", b"a,b\n1,2\n3,4\n", "text/csv")})
    _no_server_paths(plate.json(), [data_dir])
    ds = client.post("/api/data-studio/sessions", files={"file": ("d.csv", b"a,b\n1,2\n3,4\n", "text/csv")})
    _no_server_paths(ds.json(), [data_dir])


def test_ollama_base_url_cannot_be_set_by_request():
    from app.routers.ai import ChatRequest

    assert "ollama_base_url" not in ChatRequest.model_fields


@pytest.mark.parametrize("route", ["/api/lcms/sessions", "/api/ftir/sessions", "/api/plate-reader/sessions", "/api/data-studio/sessions"])
def test_uploads_require_a_file_and_never_fetch_urls(route, monkeypatch):
    import httpx

    def no_network(*_a, **_k):
        raise AssertionError("server attempted an outbound HTTP request")

    monkeypatch.setattr(httpx.AsyncClient, "send", no_network)
    resp = client.post(route, data={"blob_url": "http://169.254.169.254/latest/meta-data/"})
    assert resp.status_code == 422


def test_blob_store_module_removed():
    import importlib.util

    assert importlib.util.find_spec("app.blob_store") is None
