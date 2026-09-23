"""Tests for publication router: Vector PDF rendering and SI package packaging."""
import base64
from fastapi.testclient import TestClient

from app.main import app
from app.db import save_session_record, set_session_experiment_tag

client = TestClient(app)


def test_render_figure_pdf_empty_panels():
    payload = {
        "title": "ACS Double Column Test",
        "journal_preset": "acs_double",
        "panels": [
            {"panel_label": "a", "title": "TIC Overview"},
            {"panel_label": "b", "title": "MS1 Scan Spectrum"},
        ],
    }
    resp = client.post("/api/publication/render-figure-pdf", json=payload)
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/pdf"
    assert resp.content.startswith(b"%PDF")


def test_render_figure_pdf_with_image():
    # 1x1 transparent PNG data URI
    dummy_png_b64 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
    payload = {
        "title": "Nature Single Test",
        "journal_preset": "nature_single",
        "panels": [
            {"panel_label": "a", "title": "FTIR Band", "image_data": dummy_png_b64},
        ],
    }
    resp = client.post("/api/publication/render-figure-pdf", json=payload)
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/pdf"
    assert resp.content.startswith(b"%PDF")


def test_si_package_is_disabled_until_rebuilt_on_real_results():
    tag = "SI_Test_Experiment_101"
    save_session_record("sid_pub_ftir", "general", "ftir", "Pub_FTIR.csv", "p/ftir.csv")
    set_session_experiment_tag("sid_pub_ftir", tag)

    resp = client.post("/api/publication/si-package", json={"experiment_tag": tag})

    assert resp.status_code == 410
    assert "disabled" in resp.json()["detail"]
