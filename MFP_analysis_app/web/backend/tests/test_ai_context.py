from fastapi.testclient import TestClient

from app.db import save_session_record
from app.main import app
from app.services import data_studio_service, ftir_service, lcms_service, plate_reader_service

client = TestClient(app)


def test_ai_context_lists_sessions_without_parsing_files(monkeypatch, tmp_path):
    def must_not_parse(*_a, **_k):
        raise AssertionError("AI context must not load session files")

    for module in (lcms_service, ftir_service, plate_reader_service, data_studio_service):
        monkeypatch.setattr(module.registry, "restore_from_path", must_not_parse)

    save_session_record("ctx_lcms", "ctx_ws", "lcms", "ctx_run.mzML", str(tmp_path / "ctx_run.mzML"))
    ctx = client.get("/api/ai/context").json()
    names = [s["display_name"] for s in ctx["LCMS"]["sessions"]]
    assert "ctx_run.mzML" in names
