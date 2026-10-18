"""Accuracy benchmark for the one-click LCMS pipeline.

Each case (cases/*.json) names an mzML + UV CSV, the pipeline settings, and the expected species
in retention order (from a hand-labelled figure). The pipeline's top label per UV peak is scored:

  recall     expected species found (each expected entry used once; within ±rt_tol when it has an RT)
  precision  top labels that match an expected species
  F1         harmonic mean of the two
  order      longest common subsequence of the two RT-ordered species lists / number expected

Cases whose data files are missing are skipped (real runs live in data/, not in git). The
synthetic PLGA case always runs; its truth comes from the example generator.

    python -m benchmarks.lcms_pipeline.run_benchmark [--set background.enabled=true] [case ...]
"""
from __future__ import annotations

import argparse
import json
import math
import os
import shutil
import sys
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence

HERE = Path(__file__).resolve().parent
BACKEND = HERE.parents[1]
EXAMPLES = BACKEND / "app" / "examples" / "data"


@dataclass
class CaseScore:
    name: str
    expected: int
    predicted: int
    matched: int
    lcs: int
    seconds: float

    @property
    def recall(self) -> float:
        return self.matched / self.expected if self.expected else 0.0

    @property
    def precision(self) -> float:
        return self.matched / self.predicted if self.predicted else 0.0

    @property
    def f1(self) -> float:
        p, r = self.precision, self.recall
        return 2 * p * r / (p + r) if p + r else 0.0

    @property
    def order(self) -> float:
        return self.lcs / self.expected if self.expected else 0.0


def species_key(text: str) -> str:
    """'2-Lac + 1-Arg [M+H]⁺' and '1-Arg + 2-Lac' → '1-Arg + 2-Lac' (ion and order ignored)."""
    core = text.split("[")[0].strip()
    form = ""
    if core.endswith(")") and "(" in core:  # e.g. "3-GA (cyclic)"
        core, form = core[: core.rindex("(")].strip(), " " + core[core.rindex("(") :]
    parts = sorted(p.strip() for p in core.split("+") if p.strip())
    return " + ".join(parts) + form


def lcs(a: Sequence[str], b: Sequence[str]) -> int:
    prev = [0] * (len(b) + 1)
    for x in a:
        cur = [0]
        for j, y in enumerate(b, start=1):
            cur.append(prev[j - 1] + 1 if x == y else max(prev[j], cur[j - 1]))
        prev = cur
    return prev[-1]


def score(expected: List[Dict[str, Any]], predicted: List[Dict[str, Any]], rt_tol: float) -> tuple[int, int]:
    """(matched, lcs). Expected entries with an RT match only within rt_tol; others by species."""
    pool = [dict(e, key=species_key(e["species"]), used=False) for e in expected]
    matched = 0
    for pred in sorted(predicted, key=lambda p: p["rt_min"]):
        best = None
        for e in pool:
            if e["used"] or e["key"] != pred["key"]:
                continue
            if e.get("rt_min") is not None and abs(e["rt_min"] - pred["rt_min"]) > rt_tol:
                continue
            gap = abs(e["rt_min"] - pred["rt_min"]) if e.get("rt_min") is not None else math.inf
            if best is None or gap < best[0]:
                best = (gap, e)
        if best:
            best[1]["used"] = True
            matched += 1
    order = lcs([e["key"] for e in pool], [p["key"] for p in sorted(predicted, key=lambda p: p["rt_min"])])
    return matched, order


def synthetic_plga_case() -> Dict[str, Any]:
    """Truth straight from the example generator: oligomers whose UV peak stands clear of the noise."""
    from app.examples.make_examples import UV_LEAD_MIN, oligomers

    expected = []
    for label, _mass, _c, rt, abundance in oligomers():
        if 220 * abundance >= 1.0:  # UV apex ≥ 1 mAU, about 7σ of the generator's noise
            counts = [p.strip() for p in label.split("+")]
            species = " + ".join(p for p in counts if not p.startswith("0-"))
            expected.append({"species": species, "rt_min": rt - UV_LEAD_MIN})
    expected.sort(key=lambda e: e["rt_min"])
    return {
        "name": "plga_synthetic",
        "description": "Synthetic GA/LA oligomers from app/examples (truth known exactly).",
        "mzml": str(EXAMPLES / "example_plga.mzML"),
        "uv": str(EXAMPLES / "example_plga_uv.csv"),
        "settings": {
            "monomers": [{"name": "GA", "mass": 76.016044}, {"name": "LA", "mass": 90.031694}],
            "polarity": "positive",
            "tolerance_da": 0.5,
            "adducts": ["H", "Na"],
            "rules": {"elution_direction": "increasing"},
        },
        "expected": expected,
        "rt_tol": 0.1,
    }


def load_cases(names: Sequence[str]) -> List[Dict[str, Any]]:
    cases = [synthetic_plga_case()]
    for path in sorted((HERE / "cases").glob("*.json")):
        case = json.loads(path.read_text(encoding="utf-8"))
        for key in ("mzml", "uv"):
            case[key] = str((HERE / case[key]).resolve())
        cases.append(case)
    return [c for c in cases if not names or c["name"] in names]


def _apply_overrides(settings: Dict[str, Any], overrides: Sequence[str]) -> Dict[str, Any]:
    out = json.loads(json.dumps(settings))
    for item in overrides:
        path, _, raw = item.partition("=")
        node = out
        keys = path.split(".")
        for key in keys[:-1]:
            node = node.setdefault(key, {})
        node[keys[-1]] = json.loads(raw)
    return out


def run_case(case: Dict[str, Any], overrides: Sequence[str] = ()) -> Optional[CaseScore]:
    if not (Path(case["mzml"]).is_file() and Path(case["uv"]).is_file()):
        return None
    from app.db import get_upload_dir
    from app.services.lcms_pipeline import PipelineSettings, run_pipeline
    from app.services.lcms_service import attach_uv_from_csv, registry

    up = get_upload_dir("lcms")
    mz = up / f"bench_{case['name']}.mzML"
    uv = up / f"bench_{case['name']}_uv.csv"
    shutil.copyfile(case["mzml"], mz)
    shutil.copyfile(case["uv"], uv)
    state = registry.add_from_path(mz, workspace_id="benchmark", display_name=case["name"], rt_unit="minutes")
    attach_uv_from_csv(state, uv, filename=uv.name)
    settings = PipelineSettings.model_validate(_apply_overrides(case["settings"], overrides))
    t0 = time.perf_counter()
    result = run_pipeline(state, settings)
    seconds = time.perf_counter() - t0
    peaks = {p.id: p for p in result.peaks}
    predicted = [
        {"key": species_key(lab.species), "rt_min": peaks[lab.peak_id].rt_min}
        for lab in result.labels
        if lab.rank == 1
    ]
    matched, order = score(case["expected"], predicted, float(case.get("rt_tol", 0.15)))
    registry.remove(state.session_id)
    return CaseScore(case["name"], len(case["expected"]), len(predicted), matched, order, seconds)


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("cases", nargs="*", help="case names (default: all)")
    parser.add_argument("--set", action="append", default=[], help="settings override, e.g. background.enabled=true")
    args = parser.parse_args(argv)
    if "MFP_DATA_DIR" not in os.environ:  # never write benchmark sessions into the lab database
        os.environ["MFP_DATA_DIR"] = tempfile.mkdtemp(prefix="mfp_bench_")
    for path in (BACKEND, BACKEND.parents[1]):  # app.* and the shared lab_gui package
        if str(path) not in sys.path:
            sys.path.insert(0, str(path))
    print(f"{'case':<28}{'expected':>9}{'labels':>8}{'recall':>8}{'precis.':>8}{'F1':>7}{'order':>7}{'time s':>8}")
    for case in load_cases(args.cases):
        s = run_case(case, args.set)
        if s is None:
            print(f"{case['name']:<28}  skipped: add {Path(case['mzml']).name} and {Path(case['uv']).name} to data/")
            continue
        print(f"{s.name:<28}{s.expected:>9}{s.predicted:>8}{s.recall:>8.2f}{s.precision:>8.2f}{s.f1:>7.2f}{s.order:>7.2f}{s.seconds:>8.2f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
