"""Tests for experiment tagging, bundle resolution, and multi-session linking."""
from fastapi.testclient import TestClient

from app.main import app
from app.db import (
    save_session_record,
    set_session_experiment_tag,
    list_experiment_tags,
    get_experiment_bundle,
    get_session_record,
)

client = TestClient(app)


def test_experiment_tagging_db():
    # Save sessions across distinct modules
    save_session_record("sid_lcms_1", "general", "lcms", "SampleA_LCMS.mzML", "path/a.mzML")
    save_session_record("sid_ftir_1", "general", "ftir", "SampleA_FTIR.csv", "path/a.csv")
    save_session_record("sid_plate_1", "general", "plate_reader", "SampleA_Plate.xlsx", "path/a.xlsx")

    # Tag them with the same experiment tag
    tag = "Experiment_Test_Alpha"
    assert set_session_experiment_tag("sid_lcms_1", tag) is True
    assert set_session_experiment_tag("sid_ftir_1", tag) is True
    assert set_session_experiment_tag("sid_plate_1", tag) is True

    # Check tags listing
    tags = list_experiment_tags()
    assert tag in tags

    # Check bundle
    bundle = get_experiment_bundle(tag)
    assert bundle["experiment_tag"] == tag
    assert len(bundle["sessions"]) == 3
    assert bundle["counts"]["lcms"] == 1
    assert bundle["counts"]["ftir"] == 1
    assert bundle["counts"]["plate_reader"] == 1
    assert bundle["counts"]["data_studio"] == 0


def test_experiment_router_endpoints():
    # Tag a session via router PUT
    save_session_record("sid_api_1", "general", "lcms", "Api_LCMS.mzML", "path/b.mzML")
    tag = "Experiment_Batch_Beta"

    put_resp = client.put(f"/api/experiments/sessions/sid_api_1/tag", json={"experiment_tag": tag})
    assert put_resp.status_code == 200
    assert put_resp.json()["experiment_tag"] == tag

    # List tags via GET
    get_tags_resp = client.get("/api/experiments/tags")
    assert get_tags_resp.status_code == 200
    assert tag in get_tags_resp.json()

    # Get bundle via GET
    get_bundle_resp = client.get(f"/api/experiments/bundle/{tag}")
    assert get_bundle_resp.status_code == 200
    bundle_data = get_bundle_resp.json()
    assert bundle_data["experiment_tag"] == tag
    assert len(bundle_data["sessions"]) >= 1

    # Batch tag endpoint
    save_session_record("sid_batch_1", "general", "ftir", "Batch1.csv", "p1")
    save_session_record("sid_batch_2", "general", "data_studio", "Batch2.csv", "p2")

    batch_resp = client.post(
        "/api/experiments/batch-tag",
        json={"session_ids": ["sid_batch_1", "sid_batch_2"], "experiment_tag": "Batch_Tag_Gamma"},
    )
    assert batch_resp.status_code == 200
    assert batch_resp.json()["tagged_count"] == 2

    # Get session info endpoint
    session_resp = client.get("/api/experiments/sessions/sid_batch_1")
    assert session_resp.status_code == 200
    sess_data = session_resp.json()
    assert sess_data["session_id"] == "sid_batch_1"
    assert sess_data["experiment_tag"] == "Batch_Tag_Gamma"
    assert len(sess_data["linked"]["sessions"]) == 2
