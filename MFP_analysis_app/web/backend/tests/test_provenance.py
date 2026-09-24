import hashlib

import numpy as np
from fastapi.testclient import TestClient

from app.db import list_results
from app.main import app
from app.provenance import app_version

client = TestClient(app)


def _ftir_bytes() -> bytes:
    x = np.linspace(600, 4000, 800)
    a = 0.8 * np.exp(-0.5 * ((x - 1735) / 10) ** 2) + 0.05
    return "\n".join(f"{u:.2f},{v:.6f}" for u, v in zip(x, a)).encode()


def test_app_version_has_semver_and_build(monkeypatch):
    monkeypatch.setenv("MFP_GIT_SHA", "abcdef1234567890")
    assert app_version() == "0.1.0+abcdef1"


def test_running_an_analysis_records_params_input_hash_and_version():
    data = _ftir_bytes()
    sid = client.post("/api/ftir/sessions", files={"file": ("prov.csv", data, "text/csv")}).json()["session_id"]
    body = {"mode": "absorbance", "baseline": "airpls", "baseline_lambda": 12345.0, "min_prominence": 0.05}
    peaks = client.post(f"/api/ftir/sessions/{sid}/peaks", json=body).json()["peaks"]

    results = list_results(session_ids=[sid])
    assert len(results) == 1
    rec = results[0]
    assert (rec["module"], rec["kind"]) == ("ftir", "peaks")
    assert rec["params"]["baseline_lambda"] == 12345.0
    assert rec["result"]["peaks"] == peaks
    assert rec["input_sha256"] == hashlib.sha256(data).hexdigest()
    assert rec["input_name"] == "prov.csv"
    assert rec["app_version"] == app_version()


def test_identical_rerun_replaces_instead_of_duplicating():
    sid = client.post("/api/ftir/sessions", files={"file": ("rerun.csv", _ftir_bytes(), "text/csv")}).json()["session_id"]
    for _ in range(3):
        client.post(f"/api/ftir/sessions/{sid}/peaks", json={"mode": "absorbance", "min_prominence": 0.05})
    client.post(f"/api/ftir/sessions/{sid}/peaks", json={"mode": "absorbance", "min_prominence": 0.2})
    assert len(list_results(session_ids=[sid])) == 2


def test_results_are_deleted_with_their_session():
    sid = client.post("/api/ftir/sessions", files={"file": ("gone.csv", _ftir_bytes(), "text/csv")}).json()["session_id"]
    client.post(f"/api/ftir/sessions/{sid}/peaks", json={"mode": "absorbance"})
    client.delete(f"/api/ftir/sessions/{sid}")
    assert list_results(session_ids=[sid]) == []


def test_results_endpoint_lists_by_session():
    sid = client.post("/api/ftir/sessions", files={"file": ("api.csv", _ftir_bytes(), "text/csv")}).json()["session_id"]
    client.post(f"/api/ftir/sessions/{sid}/peaks", json={"mode": "absorbance"})
    out = client.get(f"/api/experiments/results?session_id={sid}").json()
    assert [r["kind"] for r in out] == ["peaks"]
