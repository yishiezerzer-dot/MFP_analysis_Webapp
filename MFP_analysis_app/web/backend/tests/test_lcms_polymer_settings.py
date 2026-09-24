import numpy as np

from app.services.lcms_service import polymer_match_labels

PROTON = 1.007276
STYRENE = 104.0626


def _labels(mz, intensity, **settings):
    base = {"enabled": True, "monomers_text": "Sty, 104.0626", "charges": "1", "max_dp": 12, "tol_value": 0.005, "tol_unit": "Da"}
    base.update(settings)
    return polymer_match_labels(np.asarray(mz, float), np.asarray(intensity, float), polarity="positive", settings=base)


def test_bond_delta_zero_is_respected_for_addition_polymers():
    correct = 10 * STYRENE + PROTON
    wrong = correct - 9 * 18.010565
    labels = _labels([correct, wrong], [100.0, 100.0], bond_delta=0.0)
    assert [(round(l["mz"], 4), l["text"]) for l in labels] == [(round(correct, 4), "10-Sty [M+H]⁺")]


def test_adduct_mass_zero_is_respected():
    labels = _labels([10 * STYRENE], [100.0], bond_delta=0.0, adduct_mass=0.0)
    assert len(labels) == 1


def test_min_rel_int_zero_keeps_small_peaks():
    big = 10 * STYRENE + PROTON
    small = 5 * STYRENE + PROTON
    labels = _labels([big, small], [1000.0, 1.0], bond_delta=0.0, min_rel_int=0.0)
    assert {round(l["mz"], 4) for l in labels} == {round(big, 4), round(small, 4)}


def test_missing_values_still_use_defaults():
    lactic = 10 * 90.031694 + 9 * -18.010565 + PROTON
    labels = polymer_match_labels(
        np.array([lactic]), np.array([100.0]), polarity="positive",
        settings={"enabled": True, "monomers_text": "LA, 90.031694"},
    )
    assert labels and labels[0]["text"] == "10-LA [M+H]⁺"
