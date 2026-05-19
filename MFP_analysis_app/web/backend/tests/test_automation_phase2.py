from __future__ import annotations

import threading
import sys
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest
from fastapi.testclient import TestClient

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.automation.registry import (  # noqa: E402
    clear_confirmation_tokens_for_tests,
    clear_log_for_tests,
)
from app.main import app  # noqa: E402
from app.services.lcms_service import LCMSSessionState, registry  # noqa: E402
from app.automation.actions import lcms_eic, lcms_kendrick, lcms_polymer, lcms_spectrum  # noqa: E402


@pytest.fixture(autouse=True)
def clean_lcms_registry():
    with registry._lock:
        registry._sessions.clear()
    clear_log_for_tests()
    clear_confirmation_tokens_for_tests()
    yield
    with registry._lock:
        registry._sessions.clear()
    clear_log_for_tests()
    clear_confirmation_tokens_for_tests()


@pytest.fixture()
def client() -> TestClient:
    return TestClient(app)


@pytest.fixture()
def lcms_session() -> LCMSSessionState:
    metas = [
        SimpleNamespace(spectrum_id="scan=1", rt_min=0.5, tic=100.0, polarity="positive"),
        SimpleNamespace(spectrum_id="scan=2", rt_min=1.0, tic=250.0, polarity="positive"),
        SimpleNamespace(spectrum_id="scan=3", rt_min=1.5, tic=125.0, polarity="negative"),
    ]
    state = LCMSSessionState(
        session_id="session-1",
        display_name="Synthetic LCMS",
        path=Path("synthetic.mzML"),
        index=SimpleNamespace(ms1=metas, stats={"source": "test"}),
        _reader_lock=threading.Lock(),
    )
    with registry._lock:
        registry._sessions[state.session_id] = state
    return state


def test_actions_catalog_shows_initial_lcms_actions(client: TestClient) -> None:
    response = client.get("/api/automation/actions")

    assert response.status_code == 200
    actions = response.json()
    ids = {action["id"] for action in actions}
    expected_ids = {
        "lcms.list_sessions",
        "lcms.get_session_state",
        "lcms.get_tic",
        "lcms.get_spectrum_at_rt",
        "lcms.get_top_spectrum_peaks",
        "lcms.find_mz",
        "lcms.sum_tic_region_spectrum",
        "lcms.create_eic",
        "lcms.integrate_eic_data",
        "lcms.compute_expected_products",
        "lcms.match_polymers_for_spectrum",
        "lcms.compute_kendrick_plot",
        "lcms.build_comparison_matrix",
        "lcms.export_feature_table_csv",
        "lcms.export_comparison_matrix_csv",
    }
    assert ids >= expected_ids
    for action in actions:
        if action["id"] in expected_ids:
            assert action["risk"] == "safe"
            assert action["scope"] == "backend"
            assert "input_schema" in action
            assert "output_schema" in action


def test_list_sessions_execute_returns_sessions(client: TestClient, lcms_session: LCMSSessionState) -> None:
    response = client.post("/api/automation/actions/lcms.list_sessions/execute", json={})

    assert response.status_code == 200
    payload = response.json()
    assert payload["sessions"][0]["session_id"] == lcms_session.session_id
    assert payload["sessions"][0]["display_name"] == "Synthetic LCMS"
    assert payload["sessions"][0]["ms1_count"] == 3


def test_get_session_state_execute_returns_indexed_state(client: TestClient, lcms_session: LCMSSessionState) -> None:
    response = client.post(
        "/api/automation/actions/lcms.get_session_state/execute",
        json={"session_id": lcms_session.session_id},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["session"]["session_id"] == lcms_session.session_id
    assert payload["session"]["polarities"] == ["negative", "positive"]
    assert payload["ms1_meta"][0]["spectrum_id"] == "scan=1"


def test_get_tic_execute_returns_tic_for_session(client: TestClient, lcms_session: LCMSSessionState) -> None:
    response = client.post(
        "/api/automation/actions/lcms.get_tic/execute",
        json={"session_id": lcms_session.session_id, "polarity": "positive"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["session_id"] == lcms_session.session_id
    assert payload["rt_min"] == [0.5, 1.0]
    assert payload["tic"] == [100.0, 250.0]
    assert payload["polarity"] == ["positive", "positive"]


@pytest.mark.parametrize(
    ("action_id", "body"),
    [
        ("lcms.list_sessions", {"unexpected": True}),
        ("lcms.get_session_state", {}),
        ("lcms.get_tic", {"session_id": "session-1", "polarity": "all"}),
    ],
)
def test_malformed_action_input_returns_422(client: TestClient, action_id: str, body: dict) -> None:
    response = client.post(f"/api/automation/actions/{action_id}/execute", json=body)

    assert response.status_code == 422


def test_unknown_action_id_returns_404(client: TestClient) -> None:
    response = client.post("/api/automation/actions/lcms.nope_action/execute", json={})

    assert response.status_code == 404


def test_action_log_records_calls(client: TestClient, lcms_session: LCMSSessionState) -> None:
    client.post("/api/automation/actions/lcms.list_sessions/execute", json={})
    client.post(
        "/api/automation/actions/lcms.get_tic/execute",
        json={"session_id": lcms_session.session_id},
    )

    response = client.get("/api/automation/logs")

    assert response.status_code == 200
    logs = response.json()
    assert [entry["action_id"] for entry in logs[-2:]] == ["lcms.list_sessions", "lcms.get_tic"]
    assert all(entry["status"] == "ok" for entry in logs[-2:])


def spectrum_meta() -> dict:
    return {
        "spectrum_id": "scan=2",
        "rt_min": 1.0,
        "tic": 350.0,
        "polarity": "positive",
        "n_peaks": 4,
    }


def fake_spectrum(*_args, **_kwargs):
    return spectrum_meta(), np.asarray([50.0, 101.007276, 150.1, 201.007276]), np.asarray([10.0, 200.0, 80.0, 100.0])


def polymer_settings() -> dict:
    return {
        "enabled": True,
        "monomers_text": "Test 100.000000",
        "bond_delta": 0.0,
        "extra_delta": 0.0,
        "adduct_mass": 1.007276,
        "cluster_adduct_mass": 1.007276,
        "charges": "1",
        "decarb": False,
        "oxid": False,
        "h2o_loss": False,
        "cluster": True,
        "adduct_na": False,
        "adduct_k": False,
        "adduct_cl": False,
        "adduct_formate": False,
        "adduct_acetate": False,
        "tol_value": 0.02,
        "tol_unit": "Da",
        "min_rel_int": 0.0,
        "max_dp": 1,
    }


def feature_rows() -> list[dict]:
    return [
        {
            "id": "f1",
            "session_id": "session-1",
            "source_file": "synthetic.mzML",
            "mz": 101.007276,
            "tolerance": 0.02,
            "polarity": "positive",
            "rt_start": 0.8,
            "rt_apex": 1.0,
            "rt_end": 1.2,
            "height": 200.0,
            "area": 300.0,
            "baseline": 10.0,
            "n_points": 3,
            "source": "expected",
            "label": "1-Test",
            "expected_product": "1-Test",
            "annotation": "[M+H]+",
            "created_at": "2026-01-01T00:00:00Z",
        },
        {
            "id": "f2",
            "session_id": "session-1",
            "source_file": "synthetic.mzML",
            "mz": 101.008,
            "tolerance": 0.02,
            "polarity": "positive",
            "rt_start": 0.8,
            "rt_apex": 1.1,
            "rt_end": 1.2,
            "height": 100.0,
            "area": 150.0,
            "baseline": 10.0,
            "n_points": 3,
            "source": "manual",
            "label": "1-Test",
            "expected_product": "1-Test",
            "annotation": "[M+H]+",
            "created_at": "2026-01-01T00:00:01Z",
        },
    ]


def test_get_spectrum_at_rt_execute_returns_spectrum(client: TestClient, lcms_session: LCMSSessionState, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(lcms_spectrum.lcms_service, "fetch_spectrum_at_rt", fake_spectrum)

    response = client.post(
        "/api/automation/actions/lcms.get_spectrum_at_rt/execute",
        json={"session_id": lcms_session.session_id, "rt_min": 1.0, "top_n": 2},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["meta"]["spectrum_id"] == "scan=2"
    assert payload["mz"] == [50.0, 101.007276, 150.1, 201.007276]
    assert len(payload["labels"]) == 2


def test_get_top_spectrum_peaks_execute_returns_peaks(client: TestClient, lcms_session: LCMSSessionState, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(lcms_spectrum.lcms_service, "fetch_spectrum_at_rt", fake_spectrum)

    response = client.post(
        "/api/automation/actions/lcms.get_top_spectrum_peaks/execute",
        json={"session_id": lcms_session.session_id, "rt_min": 1.0, "n": 2},
    )

    assert response.status_code == 200
    peaks = response.json()["peaks"]
    assert [peak["mz"] for peak in peaks] == [101.007276, 201.007276]


def test_find_mz_execute_returns_best_match(client: TestClient, lcms_session: LCMSSessionState, monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_find(*_args, **_kwargs):
        return {
            "target_mz": 150.1,
            "tolerance": 0.02,
            "n_scans": 3,
            "best": {"rt_min": 1.0, "intensity": 80.0, "mz": 150.1, "spectrum_id": "scan=2", "polarity": "positive"},
        }

    monkeypatch.setattr(lcms_spectrum.lcms_service, "find_mz_across_scans", fake_find)

    response = client.post(
        "/api/automation/actions/lcms.find_mz/execute",
        json={"session_id": lcms_session.session_id, "mz": 150.1, "tolerance": 0.02},
    )

    assert response.status_code == 200
    assert response.json()["best"]["spectrum_id"] == "scan=2"


def test_sum_tic_region_spectrum_execute_returns_combined_spectrum(client: TestClient, lcms_session: LCMSSessionState, monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_sum(*_args, **_kwargs):
        return {"rt_min": 0.5, "rt_max": 1.5, "bin_width": 0.01, "n_scans": 2, "mz": [100.0, 101.0], "intensity": [10.0, 20.0]}

    monkeypatch.setattr(lcms_spectrum.lcms_service, "summed_spectrum_in_rt_range", fake_sum)

    response = client.post(
        "/api/automation/actions/lcms.sum_tic_region_spectrum/execute",
        json={"session_id": lcms_session.session_id, "rt_min": 0.5, "rt_max": 1.5},
    )

    assert response.status_code == 200
    assert response.json()["n_scans"] == 2


def test_create_eic_execute_returns_eic(client: TestClient, lcms_session: LCMSSessionState, monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_eic(*_args, **_kwargs):
        return {
            "target_mz": 150.1,
            "tolerance": 0.02,
            "rt_min": [0.5, 1.0, 1.5],
            "intensity": [0.0, 50.0, 0.0],
            "polarity": ["positive", "positive", "positive"],
            "best": {"rt_min": 1.0, "intensity": 50.0, "mz": 150.1, "spectrum_id": "scan=2", "polarity": "positive"},
            "n_scans": 3,
        }

    monkeypatch.setattr(lcms_eic.lcms_service, "extracted_ion_chromatogram", fake_eic)

    response = client.post(
        "/api/automation/actions/lcms.create_eic/execute",
        json={"session_id": lcms_session.session_id, "mz": 150.1, "tolerance": 0.02},
    )

    assert response.status_code == 200
    assert response.json()["best"]["intensity"] == 50.0


def test_integrate_eic_data_execute_returns_peak_area(client: TestClient, lcms_session: LCMSSessionState) -> None:
    response = client.post(
        "/api/automation/actions/lcms.integrate_eic_data/execute",
        json={
            "session_id": lcms_session.session_id,
            "eic": {
                "target_mz": 150.1,
                "tolerance": 0.02,
                "rt_min": [0, 1, 2, 3, 4],
                "intensity": [0, 10, 100, 10, 0],
            },
        },
    )

    assert response.status_code == 200
    assert response.json()["rt_apex"] == 2.0
    assert response.json()["area"] > 0


def test_compute_expected_products_execute_returns_hits(client: TestClient, lcms_session: LCMSSessionState, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(lcms_polymer.lcms_service, "fetch_spectrum_at_rt", fake_spectrum)

    response = client.post(
        "/api/automation/actions/lcms.compute_expected_products/execute",
        json={"session_id": lcms_session.session_id, "rt_min": 1.0, "settings": polymer_settings(), "max_dp": 1},
    )

    assert response.status_code == 200
    hits = response.json()["hits"]
    assert any(hit["observed_mz"] == 101.007276 for hit in hits)


def test_match_polymers_for_spectrum_execute_returns_labels(client: TestClient, lcms_session: LCMSSessionState, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(lcms_polymer.lcms_service, "fetch_spectrum_at_rt", fake_spectrum)

    response = client.post(
        "/api/automation/actions/lcms.match_polymers_for_spectrum/execute",
        json={"session_id": lcms_session.session_id, "rt_min": 1.0, "settings": polymer_settings()},
    )

    assert response.status_code == 200
    assert isinstance(response.json()["labels"], list)


def test_compute_kendrick_plot_execute_returns_points(client: TestClient, lcms_session: LCMSSessionState, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(lcms_kendrick.lcms_service, "fetch_spectrum_at_rt", fake_spectrum)

    response = client.post(
        "/api/automation/actions/lcms.compute_kendrick_plot/execute",
        json={"session_id": lcms_session.session_id, "rt_min": 1.0, "repeat_mass": 100.0, "min_series_points": 1},
    )

    assert response.status_code == 200
    assert response.json()["repeat_mass"] == 100.0
    assert len(response.json()["points"]) > 0


def test_build_comparison_matrix_execute_returns_groups(client: TestClient, lcms_session: LCMSSessionState) -> None:
    response = client.post(
        "/api/automation/actions/lcms.build_comparison_matrix/execute",
        json={"session_id": lcms_session.session_id, "rows": feature_rows()},
    )

    assert response.status_code == 200
    payload = response.json()
    cell = payload["groups"][0]["cells"]["session-1"]
    # f1 has area=300, f2 has area=150 → f1 wins by area, f2 surfaces as collision
    assert cell["row"]["id"] == "f1"
    assert [c["id"] for c in cell["collisions"]] == ["f2"]
    # Each group exposes anchor_mz (its seed row's m/z) for transitive-clustering safety
    assert payload["groups"][0]["anchor_mz"] == 101.007276
    # RT range available for downstream UIs
    assert payload["groups"][0]["rt_min"] <= payload["groups"][0]["rt_max"]


def test_build_comparison_matrix_anchor_clustering_no_transitive_drift(
    client: TestClient,
) -> None:
    """m/z grouping must clamp against the group's anchor m/z, not a running mean.
    Three rows at 100.00 / 100.04 / 100.08 with tolerance 0.05 should form TWO
    groups (anchor 100.00 only matches the 100.04 row); 100.08 is outside tol."""
    row_at = lambda rid, mz: {
        "id": rid,
        "session_id": None,
        "source_file": f"{rid}.mzML",
        "mz": mz,
        "tolerance": 0.02,
        "polarity": "positive",
        "rt_start": 0.0,
        "rt_apex": 1.0,
        "rt_end": 2.0,
        "height": 100.0,
        "area": 100.0,
        "baseline": 0.0,
        "n_points": 3,
        "source": "manual",
        "label": None,
        "expected_product": None,
        "annotation": None,
        "created_at": "2026-01-01T00:00:00Z",
    }
    response = client.post(
        "/api/automation/actions/lcms.build_comparison_matrix/execute",
        json={
            "rows": [row_at("a", 100.00), row_at("b", 100.04), row_at("c", 100.08)],
            "group_mode": "mz",
            "mz_tolerance": 0.05,
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert len(payload["groups"]) == 2
    members = sorted(
        sorted(r["id"] for r in group["rows"]) for group in payload["groups"]
    )
    assert members == [["a", "b"], ["c"]]


def test_integrate_eic_data_session_id_is_optional(client: TestClient) -> None:
    response = client.post(
        "/api/automation/actions/lcms.integrate_eic_data/execute",
        json={
            "eic": {
                "target_mz": 150.1,
                "tolerance": 0.02,
                "rt_min": [0, 1, 2, 3, 4],
                "intensity": [0, 10, 100, 10, 0],
            }
        },
    )
    assert response.status_code == 200
    assert response.json()["rt_apex"] == 2.0


def test_integrate_eic_data_empty_payload_returns_422(client: TestClient) -> None:
    response = client.post(
        "/api/automation/actions/lcms.integrate_eic_data/execute",
        json={
            "eic": {
                "target_mz": 150.1,
                "tolerance": 0.02,
                "rt_min": [],
                "intensity": [],
            }
        },
    )
    assert response.status_code == 422


def test_compute_expected_products_suppresses_2m_when_monomer_absent(
    client: TestClient, lcms_session: LCMSSessionState, monkeypatch: pytest.MonkeyPatch
) -> None:
    """[2M+H]+ at 201.007 should be suppressed when [M+H]+ at 101.007 is missing."""
    def only_dimer(*_args, **_kwargs):
        return spectrum_meta(), np.asarray([201.007276]), np.asarray([1000.0])

    monkeypatch.setattr(lcms_polymer.lcms_service, "fetch_spectrum_at_rt", only_dimer)
    response = client.post(
        "/api/automation/actions/lcms.compute_expected_products/execute",
        json={
            "session_id": lcms_session.session_id,
            "rt_min": 1.0,
            "settings": polymer_settings(),
            "max_dp": 1,
        },
    )
    assert response.status_code == 200
    hits = response.json()["hits"]
    assert not any(hit["variant"] == "2M" and hit["observed_mz"] is not None for hit in hits)


def test_export_feature_table_csv_execute_returns_csv(client: TestClient, lcms_session: LCMSSessionState) -> None:
    response = client.post(
        "/api/automation/actions/lcms.export_feature_table_csv/execute",
        json={"session_id": lcms_session.session_id, "rows": feature_rows()},
    )

    assert response.status_code == 200
    assert "FeatureID" in response.json()["csv"]
    assert response.json()["filename"] == "lcms_feature_table.csv"


def test_export_comparison_matrix_csv_execute_returns_csv(client: TestClient, lcms_session: LCMSSessionState) -> None:
    response = client.post(
        "/api/automation/actions/lcms.export_comparison_matrix_csv/execute",
        json={"session_id": lcms_session.session_id, "rows": feature_rows()},
    )

    assert response.status_code == 200
    assert "Feature,Annotation" in response.json()["csv"]


@pytest.mark.parametrize(
    ("action_id", "body"),
    [
        ("lcms.get_spectrum_at_rt", {"session_id": "session-1"}),
        ("lcms.get_top_spectrum_peaks", {"session_id": "session-1", "rt_min": 1.0, "n": 0}),
        ("lcms.find_mz", {"session_id": "session-1", "mz": -1}),
        ("lcms.sum_tic_region_spectrum", {"session_id": "session-1", "rt_min": 0.5}),
        ("lcms.create_eic", {"session_id": "session-1", "mz": 150.1, "tolerance": 0}),
        ("lcms.integrate_eic_data", {"session_id": "session-1", "eic": {"target_mz": 150.1}}),
        ("lcms.compute_expected_products", {"session_id": "session-1", "rt_min": 1.0}),
        ("lcms.match_polymers_for_spectrum", {"session_id": "session-1", "rt_min": 1.0}),
        ("lcms.compute_kendrick_plot", {"session_id": "session-1", "rt_min": 1.0, "repeat_mass": 0}),
        ("lcms.build_comparison_matrix", {"session_id": "session-1", "rows": [{"id": "bad"}]}),
        ("lcms.export_feature_table_csv", {"session_id": "session-1", "rows": [{"id": "bad"}]}),
        ("lcms.export_comparison_matrix_csv", {"session_id": "session-1", "rows": [{"id": "bad"}]}),
    ],
)
def test_remaining_actions_malformed_input_returns_422(client: TestClient, action_id: str, body: dict) -> None:
    response = client.post(f"/api/automation/actions/{action_id}/execute", json=body)

    assert response.status_code == 422


@pytest.mark.parametrize(
    ("action_id", "body"),
    [
        ("lcms.get_spectrum_at_rt", {"session_id": "missing", "rt_min": 1.0}),
        ("lcms.get_top_spectrum_peaks", {"session_id": "missing", "rt_min": 1.0}),
        ("lcms.find_mz", {"session_id": "missing", "mz": 150.1}),
        ("lcms.sum_tic_region_spectrum", {"session_id": "missing", "rt_min": 0.5, "rt_max": 1.5}),
        ("lcms.create_eic", {"session_id": "missing", "mz": 150.1}),
        ("lcms.integrate_eic_data", {"session_id": "missing", "eic": {"target_mz": 150.1, "tolerance": 0.02, "rt_min": [0, 1], "intensity": [0, 1]}}),
        ("lcms.compute_expected_products", {"session_id": "missing", "rt_min": 1.0, "settings": polymer_settings()}),
        ("lcms.match_polymers_for_spectrum", {"session_id": "missing", "rt_min": 1.0, "settings": polymer_settings()}),
        ("lcms.compute_kendrick_plot", {"session_id": "missing", "rt_min": 1.0, "repeat_mass": 100.0}),
        ("lcms.build_comparison_matrix", {"session_id": "missing", "rows": feature_rows()}),
        ("lcms.export_feature_table_csv", {"session_id": "missing", "rows": feature_rows()}),
        ("lcms.export_comparison_matrix_csv", {"session_id": "missing", "rows": feature_rows()}),
    ],
)
def test_remaining_actions_missing_session_returns_404(client: TestClient, action_id: str, body: dict) -> None:
    response = client.post(f"/api/automation/actions/{action_id}/execute", json=body)

    assert response.status_code == 404
