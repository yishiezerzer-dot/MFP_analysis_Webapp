import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.lcms_service import registry
from test_mzml_fast_index import _generate_synthetic_mzml

client = TestClient(app)


@pytest.fixture()
def sid():
    resp = client.post(
        "/api/lcms/sessions",
        files={"file": ("uv_host.mzML", _generate_synthetic_mzml(num_scans=5), "application/octet-stream")},
    )
    return resp.json()["session_id"]


def _attach(sid, text, **form):
    return client.post(f"/api/lcms/sessions/{sid}/uv", files={"file": ("uv.csv", text.encode(), "text/csv")}, data=form)


def _long_run_headerless() -> str:
    # 70-minute run in minutes, no header row
    return "\n".join(f"{t:.1f},{0.1 + 0.001 * t:.4f}" for t in [i * 0.5 for i in range(141)])


def test_headerless_long_run_stays_in_minutes_and_keeps_first_row(sid):
    resp = _attach(sid, _long_run_headerless())
    assert resp.status_code == 200, resp.text
    uv = resp.json()["uv"]
    assert uv["rt_min"] == pytest.approx(0.0)
    assert uv["rt_max"] == pytest.approx(70.0)
    assert uv["n_points"] == 141


def test_explicit_seconds_converts(sid):
    text = "\n".join(f"{t},{0.1}" for t in range(0, 1201, 10))
    uv = _attach(sid, text, rt_unit="seconds").json()["uv"]
    assert uv["rt_max"] == pytest.approx(20.0)
    assert uv["unit_guess"] == "seconds"


def test_header_with_seconds_is_detected(sid):
    text = "Time (sec),Absorbance (mAU)\n" + "\n".join(f"{t},{0.1}" for t in range(0, 1201, 10))
    uv = _attach(sid, text).json()["uv"]
    assert uv["rt_max"] == pytest.approx(20.0)


def test_uv_survives_restart(sid):
    _attach(sid, _long_run_headerless(), rt_unit="minutes")
    with registry._lock:
        registry._sessions.pop(sid)
    summary = client.get(f"/api/lcms/sessions/{sid}").json()
    assert summary["uv"]["available"] is True
    assert summary["uv"]["rt_max"] == pytest.approx(70.0)
