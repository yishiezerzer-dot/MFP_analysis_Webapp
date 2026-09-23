import pytest
from fastapi.testclient import TestClient

from app.db import save_session_record
from app.main import app
from app.services import data_studio_service, ftir_service, lcms_service, plate_reader_service

client = TestClient(app)
WS = "ws_restore_errors"

REGISTRIES = {
    "lcms": lcms_service.registry,
    "ftir": ftir_service.registry,
    "plate_reader": plate_reader_service.registry,
    "data_studio": data_studio_service.registry,
}


@pytest.mark.parametrize("module", list(REGISTRIES))
def test_missing_file_is_reported_not_silently_dropped(module, tmp_path):
    sid = f"missing_{module}"
    save_session_record(sid, WS, module, f"{module}_sample.dat", str(tmp_path / "gone.dat"))

    assert all(s.session_id != sid for s in REGISTRIES[module].list(workspace_id=WS))

    errors = {e["session_id"]: e for e in client.get(f"/api/workspaces/{WS}/restore-errors").json()}
    assert sid in errors
    assert errors[sid]["module"] == module
    assert errors[sid]["display_name"] == f"{module}_sample.dat"
    assert "not found" in errors[sid]["reason"].lower()


def test_unreadable_file_reports_parse_error(tmp_path):
    bad = tmp_path / "broken.mzML"
    bad.write_text("this is not xml", encoding="utf-8")
    save_session_record("broken_lcms", WS, "lcms", "broken.mzML", str(bad))

    assert lcms_service.registry.get("broken_lcms") is None

    errors = {e["session_id"]: e for e in client.get(f"/api/workspaces/{WS}/restore-errors").json()}
    assert "broken_lcms" in errors
    assert "could not load" in errors["broken_lcms"]["reason"].lower()


def test_deleting_a_session_clears_its_error(tmp_path):
    save_session_record("gone_then_deleted", WS, "ftir", "x.csv", str(tmp_path / "x.csv"))
    ftir_service.registry.list(workspace_id=WS)
    ftir_service.registry.remove("gone_then_deleted")
    ids = [e["session_id"] for e in client.get(f"/api/workspaces/{WS}/restore-errors").json()]
    assert "gone_then_deleted" not in ids
