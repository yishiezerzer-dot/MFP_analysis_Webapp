"""Example datasets: each opens as normal sessions that behave like real uploads."""
import pytest
from fastapi.testclient import TestClient

from app.db import get_session_record
from app.main import app

client = TestClient(app)
WS = {"X-Workspace-Id": "examples_ws"}


def open_example(example_id):
    resp = client.post(f"/api/examples/{example_id}/open", headers=WS)
    assert resp.status_code == 200, resp.text
    return resp.json()


def test_lists_one_example_per_module():
    examples = client.get("/api/examples").json()
    assert {e["module"] for e in examples} == {"lcms", "ftir", "plate_reader"}
    assert all(e["title"] and e["description"] and e["try_this"] for e in examples)


def test_lcms_example_has_uv_and_the_oligomer_series():
    opened = open_example("lcms-plga")
    assert opened["route"] == "/lcms"
    sid = opened["session_ids"][0]
    s = client.get(f"/api/lcms/sessions/{sid}").json()
    assert s["display_name"].startswith("Example – ")
    assert s["uv"]["available"] is True
    assert get_session_record(sid)["experiment_tag"] == "Example"
    # GA–GA dimer [M+H]+ = 2·76.016044 − 18.010565 + 1.007276 = 135.0288, eluting at 1.2 + 1.35·2 = 3.9 min.
    eic = client.post(f"/api/lcms/sessions/{sid}/eic", json={"mz": 135.0288, "tolerance": 0.01}).json()
    assert eic["best"]["rt_min"] == pytest.approx(3.9, abs=0.06)
    assert eic["best"]["mz"] == pytest.approx(135.0288, abs=0.005)


def test_ftir_example_shows_the_ester_carbonyl():
    sid = open_example("ftir-plga")["session_ids"][0]
    peaks = client.post(f"/api/ftir/sessions/{sid}/peaks", json={"assign": False}).json()["peaks"]
    assert any(abs(p["wn"] - 1755) < 6 for p in peaks)


def test_plate_example_opens_both_plates_laid_out_and_tagged():
    ids = open_example("plate-mic")["session_ids"]
    assert len(ids) == 2
    names = [client.get(f"/api/plate-reader/sessions/{sid}").json()["display_name"] for sid in ids]
    assert all(n.startswith("Example – ") for n in names)
    exp = client.get("/api/plate-reader/experiments/Example").json()
    gent = next(p for p in exp["plates"] if "gentamicin" in p["display_name"])
    pct = [round(p["percent_growth"]) for p in gent["analysis"]["groups"][0]["points"]]
    assert pct == [0, 0, 0, 0, 0, 0, 0, 0, 0, 22, 46]


def test_unknown_example_is_404():
    assert client.post("/api/examples/nope/open", headers=WS).status_code == 404


def test_reopening_an_example_returns_the_open_sessions_instead_of_a_copy():
    ws = {"X-Workspace-Id": "examples_reopen_ws"}
    first = client.post("/api/examples/ftir-plga/open", headers=ws).json()["session_ids"]
    again = client.post("/api/examples/ftir-plga/open", headers=ws).json()["session_ids"]
    assert again == first
    assert len([s for s in client.get("/api/ftir/sessions", headers=ws).json() if s["display_name"].startswith("Example")]) == 1
    # Another workspace gets its own copy.
    other = client.post("/api/examples/ftir-plga/open", headers={"X-Workspace-Id": "examples_other_ws"}).json()["session_ids"]
    assert other != first


def test_reopening_the_plate_example_only_adds_the_plate_that_was_closed():
    ws = {"X-Workspace-Id": "examples_plates_ws"}
    gentamicin, polymers = client.post("/api/examples/plate-mic/open", headers=ws).json()["session_ids"]
    assert client.delete(f"/api/plate-reader/sessions/{polymers}", headers=ws).status_code in (200, 204)
    again = client.post("/api/examples/plate-mic/open", headers=ws).json()["session_ids"]
    assert again[0] == gentamicin
    assert again[1] != polymers
    assert get_session_record(again[1])["experiment_tag"] == "Example"
