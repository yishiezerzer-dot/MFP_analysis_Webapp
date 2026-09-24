from pathlib import Path

from fastapi.testclient import TestClient

from app.db import get_session_record
from app.main import app
from app.services import lcms_service
from test_mzml_fast_index import _generate_synthetic_mzml

client = TestClient(app)


def _upload(name: str, scans: int = 6) -> str:
    resp = client.post("/api/lcms/sessions", files={"file": (name, _generate_synthetic_mzml(num_scans=scans), "application/octet-stream")})
    assert resp.status_code == 200, resp.text
    return resp.json()["session_id"]


def test_reader_is_opened_once_per_session(monkeypatch):
    from types import SimpleNamespace

    opened = []
    real = lcms_service.mzml

    def counting(*args, **kwargs):
        opened.append(args[0])
        return real.PreIndexedMzML(*args, **kwargs)

    # Patch the service's reference only; pyteomics' classes use their own module globals.
    monkeypatch.setattr(lcms_service, "mzml", SimpleNamespace(PreIndexedMzML=counting, MzML=real.MzML))
    sid = _upload("reader_once.mzML")
    for rt in (0.0, 0.1, 0.2):
        assert client.get(f"/api/lcms/sessions/{sid}/spectrum?rt_min={rt}").status_code == 200
    assert client.post(f"/api/lcms/sessions/{sid}/eic", json={"mz": 500.0, "tolerance": 1}).status_code == 200
    assert len(opened) == 1


def test_file_without_index_still_readable():
    # The synthetic fixture has no <indexList>; the reader must fall back to scanning it.
    sid = _upload("no_index.mzML")
    spec = client.get(f"/api/lcms/sessions/{sid}/spectrum?rt_min=0.1").json()
    assert spec["meta"]["n_peaks"] == 50


def test_delete_closes_reader_so_file_can_be_removed():
    sid = _upload("delete_open.mzML", scans=8)
    client.get(f"/api/lcms/sessions/{sid}/spectrum?rt_min=0.1")
    path = Path(get_session_record(sid)["file_path"])
    assert client.delete(f"/api/lcms/sessions/{sid}").status_code == 200
    assert not path.exists()


def test_summary_identifies_upload_time_and_file_content():
    import re

    sid = _upload("ident.mzML")
    summary = client.get(f"/api/lcms/sessions/{sid}").json()
    assert summary["uploaded_at"]
    assert re.fullmatch(r"[0-9a-f]{12}", summary["file_id"])
