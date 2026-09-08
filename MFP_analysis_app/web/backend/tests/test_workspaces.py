import os
import tempfile
import pytest
from pathlib import Path
from fastapi.testclient import TestClient

# Use temporary directory for testing database and files
_TMP_DIR = tempfile.mkdtemp(prefix="mfp_test_data_")
os.environ["MFP_DATA_DIR"] = _TMP_DIR

from app.main import app
from app.db import init_db, list_workspaces, create_workspace, get_workspace

client = TestClient(app)

def test_workspaces_crud():
    # Test listing seeded workspaces
    res = client.get("/api/workspaces")
    assert res.status_code == 200
    workspaces = res.json()
    ws_ids = [w["id"] for w in workspaces]
    assert "general" in ws_ids
    assert "yishi" in ws_ids

    # Test creating a new workspace
    res = client.post("/api/workspaces", json={"name": "Dana Cohen"})
    assert res.status_code == 200
    data = res.json()
    assert data["name"] == "Dana Cohen"
    assert "dana-cohen" in data["id"]
    dana_id = data["id"]

    # Test getting that workspace
    res = client.get(f"/api/workspaces/{dana_id}")
    assert res.status_code == 200
    assert res.json()["name"] == "Dana Cohen"


def test_workspace_state_save_and_restore():
    ws_id = "test-researcher"
    client.post("/api/workspaces", json={"name": "Test Researcher", "id": ws_id})

    # Save state
    sample_state = {"activeTab": "navigate", "polarity": "positive", "selectedRt": 3.45}
    res = client.put(f"/api/workspaces/{ws_id}/state/lcms", json={"state": sample_state})
    assert res.status_code == 200

    # Retrieve state
    res = client.get(f"/api/workspaces/{ws_id}/state/lcms")
    assert res.status_code == 200
    retrieved = res.json()
    assert retrieved["workspace_id"] == ws_id
    assert retrieved["module"] == "lcms"
    assert retrieved["state"]["selectedRt"] == 3.45


def test_workspace_session_isolation():
    # Create two users
    client.post("/api/workspaces", json={"name": "Alice", "id": "alice"})
    client.post("/api/workspaces", json={"name": "Bob", "id": "bob"})

    # Upload a sample CSV as FTIR session under Alice
    sample_csv = "XYDATA\n4000,0.05\n3000,0.12\n2000,0.25\n1500,0.80\n1000,0.40\n"
    files = {"file": ("test_ftir.csv", sample_csv.encode("utf-8"), "text/csv")}
    headers_alice = {"X-Workspace-Id": "alice"}
    headers_bob = {"X-Workspace-Id": "bob"}

    res = client.post("/api/ftir/sessions", files=files, headers=headers_alice)
    assert res.status_code == 200
    alice_session = res.json()
    assert alice_session["workspace_id"] == "alice"
    alice_sid = alice_session["session_id"]

    # Bob lists FTIR sessions -> should NOT see Alice's session
    res = client.get("/api/ftir/sessions", headers=headers_bob)
    assert res.status_code == 200
    bob_sessions = res.json()
    assert not any(s["session_id"] == alice_sid for s in bob_sessions)

    # Alice lists FTIR sessions -> should see her session
    res = client.get("/api/ftir/sessions", headers=headers_alice)
    assert res.status_code == 200
    alice_sessions = res.json()
    assert any(s["session_id"] == alice_sid for s in alice_sessions)


def test_server_restart_persistence():
    from app.services.ftir_service import FTIRRegistry

    # Simulate fresh registry on container restart
    fresh_registry = FTIRRegistry()
    restored = fresh_registry.list(workspace_id="alice")
    assert len(restored) >= 1
    assert any(s.display_name == "test_ftir.csv" for s in restored)

