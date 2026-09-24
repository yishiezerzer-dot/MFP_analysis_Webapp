import gzip
from pathlib import Path

from fastapi.testclient import TestClient

from app.db import get_session_record, get_upload_dir
from app.main import app
from test_mzml_fast_index import _generate_synthetic_mzml

client = TestClient(app)


def _files_in(module: str) -> set:
    return {p.name for p in get_upload_dir(module).rglob("*") if p.is_file()}


def test_upload_over_size_limit_is_rejected_and_not_kept(monkeypatch):
    monkeypatch.setenv("MFP_MAX_UPLOAD_MB", "0.001")  # ~1 KB
    before = _files_in("ftir")
    big = "\n".join(f"{600 + i},{0.5}" for i in range(2000)).encode()
    resp = client.post("/api/ftir/sessions", files={"file": ("big.csv", big, "text/csv")})
    assert resp.status_code == 413
    assert _files_in("ftir") == before


def test_gzip_expanding_past_limit_is_rejected_and_not_kept(monkeypatch):
    monkeypatch.setenv("MFP_MAX_DECOMPRESSED_MB", "0.01")  # ~10 KB
    before = _files_in("lcms")
    payload = gzip.compress(_generate_synthetic_mzml(num_scans=50))
    resp = client.post("/api/lcms/sessions", files={"file": ("bomb.mzML.gz", payload, "application/gzip")})
    assert resp.status_code == 413
    assert _files_in("lcms") == before


def _upload_ftir(name: str, content: bytes) -> str:
    resp = client.post("/api/ftir/sessions", files={"file": (name, content, "text/csv")})
    assert resp.status_code == 200
    return resp.json()["session_id"]


def test_deleting_a_session_removes_its_file_once_unreferenced():
    content = "\n".join(f"{600 + i},{0.25}" for i in range(30)).encode()
    sid1 = _upload_ftir("same.csv", content)
    sid2 = _upload_ftir("same.csv", content)  # identical content -> same stored file
    path = Path(get_session_record(sid1)["file_path"])
    assert path == Path(get_session_record(sid2)["file_path"]) and path.exists()

    assert client.delete(f"/api/ftir/sessions/{sid1}").status_code == 200
    assert path.exists()  # still used by sid2
    assert client.delete(f"/api/ftir/sessions/{sid2}").status_code == 200
    assert not path.exists()


def test_deleting_lcms_session_removes_mzml_uv_and_index_cache():
    from lab_gui.lcms_io import MzMLTICIndex

    resp = client.post(
        "/api/lcms/sessions",
        files={"file": ("cleanup.mzML", _generate_synthetic_mzml(num_scans=7), "application/octet-stream")},
    )
    sid = resp.json()["session_id"]
    client.post(f"/api/lcms/sessions/{sid}/uv", files={"file": ("cleanup_uv.csv", b"t,y\n0,1\n1,2\n2,3\n", "text/csv")})
    rec = get_session_record(sid)
    mzml_path = Path(rec["file_path"])
    uv_path = Path(rec["extra"]["uv_path"])
    cache_path = MzMLTICIndex(mzml_path, rt_unit="minutes")._cache_path()
    assert mzml_path.exists() and uv_path.exists() and cache_path is not None and cache_path.exists()

    assert client.delete(f"/api/lcms/sessions/{sid}").status_code == 200
    assert not mzml_path.exists()
    assert not uv_path.exists()
    assert not cache_path.exists()


def test_files_outside_the_data_dir_are_never_deleted(tmp_path):
    from app.db import remove_unreferenced_files, save_session_record

    outside = tmp_path / "keep_me.csv"
    outside.write_text("1,2\n", encoding="utf-8")
    save_session_record("outside_ref", "ws", "ftir", "keep_me.csv", str(outside))
    rec = get_session_record("outside_ref")
    from app.db import delete_session_record

    delete_session_record("outside_ref")
    remove_unreferenced_files(rec)
    assert outside.exists()
