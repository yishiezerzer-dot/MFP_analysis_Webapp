"""The pipeline accuracy benchmark: its scoring, the synthetic case as a regression floor, real cases when present."""
import pytest

from benchmarks.lcms_pipeline.run_benchmark import lcs, load_cases, run_case, score, species_key


def test_species_key_ignores_ion_and_order():
    assert species_key("2-Lac + 1-Arg [M+H]⁺") == species_key("1-Arg + 2-Lac") == "1-Arg + 2-Lac"
    assert species_key("3-GA (cyclic) [M+Na]⁺") == "3-GA (cyclic)"


def test_scoring_counts_each_expected_once_and_respects_rt():
    expected = [{"species": "1-Arg", "rt_min": 2.3}, {"species": "2-Lac + 1-Arg"}, {"species": "2-Lac + 1-Arg"}]
    predicted = [
        {"key": "1-Arg", "rt_min": 5.0},  # right species, wrong time
        {"key": "1-Arg + 2-Lac", "rt_min": 6.0},
        {"key": "1-Arg + 2-Lac", "rt_min": 6.5},
        {"key": "1-Arg + 2-Lac", "rt_min": 7.0},  # one more than expected
    ]
    matched, order = score(expected, predicted, rt_tol=0.15)
    assert matched == 2
    assert order == 3  # the sequence still lines up
    assert lcs(["a", "b", "c"], ["a", "c", "b"]) == 2


def test_synthetic_case_stays_at_or_above_baseline():
    case = next(c for c in load_cases([]) if c["name"] == "plga_synthetic")
    s = run_case(case)
    # Baseline 2026-10-18: recall 0.86, precision 1.00, order 0.86.
    assert s.precision >= 0.95
    assert s.recall >= 0.85
    assert s.order >= 0.85


@pytest.mark.parametrize("case", [c for c in load_cases([]) if c["name"] != "plga_synthetic"], ids=lambda c: c["name"])
def test_real_cases_when_their_files_are_present(case):
    s = run_case(case)
    if s is None:
        pytest.skip(f"{case['name']}: data files not in benchmarks/lcms_pipeline/data")
    assert s.expected > 0 and s.predicted > 0
