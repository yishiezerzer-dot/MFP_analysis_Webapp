"""Tests for the publication router (SI package)."""
from fastapi.testclient import TestClient

from app.main import app
from app.db import save_session_record, set_session_experiment_tag

client = TestClient(app)


def test_figure_pdf_builder_is_gone():
    resp = client.post("/api/publication/render-figure-pdf", json={"panels": []})
    assert resp.status_code in (404, 405)


def test_si_package_requires_a_tag_or_sessions():
    resp = client.post("/api/publication/si-package", json={})
    assert resp.status_code == 400
