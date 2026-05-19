"""Cross-language fixture tests.

These read the same JSON cases as the TypeScript Vitest suite under
``web/frontend/src/lcms/__tests__/cross_language_fixtures.test.ts``.
Any algorithmic drift between Python and TypeScript implementations of the
three duplicated LCMS algorithms (EIC integration, Kendrick clustering,
comparison-matrix grouping) will fail one suite or the other.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pytest

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.automation.actions.lcms_eic import integrate_eic_peak  # noqa: E402
from app.automation.actions.lcms_features import group_feature_rows_for_matrix  # noqa: E402
from app.automation.actions.lcms_kendrick import build_kendrick_points  # noqa: E402
from app.automation.models import LCMSFeatureRow  # noqa: E402

FIXTURES_DIR = BACKEND_ROOT.parent / "shared_fixtures" / "lcms"


def _load(name: str) -> list[dict]:
    with (FIXTURES_DIR / name).open(encoding="utf-8") as fh:
        return json.load(fh)["cases"]


def _feature_row_from_fixture(raw: dict) -> LCMSFeatureRow:
    return LCMSFeatureRow(
        id=str(raw["id"]),
        session_id=raw.get("session_id"),
        source_file=raw.get("source_file", ""),
        mz=float(raw["mz"]),
        tolerance=float(raw.get("tolerance", 0.02)),
        polarity=raw.get("polarity"),
        rt_start=float(raw.get("rt_start", raw.get("rt_apex", 0))),
        rt_apex=float(raw.get("rt_apex", 0)),
        rt_end=float(raw.get("rt_end", raw.get("rt_apex", 0))),
        height=float(raw.get("height", 0)),
        area=float(raw.get("area", 0)),
        baseline=float(raw.get("baseline", 0)),
        n_points=int(raw.get("n_points", 0)),
        source=str(raw.get("source", "manual")),
        label=raw.get("label"),
        expected_product=raw.get("expected_product"),
        annotation=raw.get("annotation"),
        created_at=raw.get("created_at", "2026-01-01T00:00:00Z"),
    )


@pytest.mark.parametrize("case", _load("integrate_eic_peak.json"), ids=lambda c: c["name"])
def test_integrate_eic_peak_cross_language(case: dict) -> None:
    result = integrate_eic_peak(
        case["input"]["rt_min"],
        case["input"]["intensity"],
        case["input"].get("reference_rt"),
    )
    for key, expected in case["expected"].items():
        assert result[key] == pytest.approx(expected, abs=1e-6), f"{case['name']}: {key}"


@pytest.mark.parametrize("case", _load("kendrick.json"), ids=lambda c: c["name"])
def test_kendrick_cross_language(case: dict) -> None:
    result = build_kendrick_points(
        np.asarray(case["input"]["mz"], dtype=float),
        np.asarray(case["input"]["intensity"], dtype=float),
        repeat_mass=float(case["input"]["repeat_mass"]),
        min_rel_intensity=float(case["input"]["min_rel_intensity"]),
        tolerance_value=float(case["input"]["tolerance_value"]),
        tolerance_unit=str(case["input"]["tolerance_unit"]),
        min_series_points=int(case["input"]["min_series_points"]),
    )
    expected = case["expected"]
    if "series_count" in expected:
        assert len(result["series"]) == expected["series_count"], case["name"]
    if "series_0_count" in expected:
        assert result["series"][0].count == expected["series_0_count"], case["name"]


@pytest.mark.parametrize("case", _load("comparison_matrix.json"), ids=lambda c: c["name"])
def test_comparison_matrix_cross_language(case: dict) -> None:
    rows = [_feature_row_from_fixture(r) for r in case["input"]["rows"]]
    matrix = group_feature_rows_for_matrix(
        rows,
        metric=case["input"]["metric"],
        group_mode=case["input"]["group_mode"],
        mz_tolerance=float(case["input"]["mz_tolerance"]),
    )
    expected = case["expected"]
    if "group_count" in expected:
        assert len(matrix.groups) == expected["group_count"], case["name"]
    if "members" in expected:
        actual = sorted(sorted(r.id for r in group.rows) for group in matrix.groups)
        wanted = sorted(sorted(group) for group in expected["members"])
        assert actual == wanted, case["name"]
    if "headline_row_id" in expected:
        cell = next(iter(matrix.groups[0].cells.values()))
        assert cell.row.id == expected["headline_row_id"], case["name"]
    if "collision_ids" in expected:
        cell = next(iter(matrix.groups[0].cells.values()))
        assert sorted(r.id for r in cell.collisions) == sorted(expected["collision_ids"]), case["name"]
