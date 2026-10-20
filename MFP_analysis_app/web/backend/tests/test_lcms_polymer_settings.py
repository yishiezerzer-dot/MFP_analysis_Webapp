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


# --- Polymer Studio options that mirror the one-click pipeline (all off by default) ---
GLC, ARG, BOND = 76.016044, 174.111676, -18.010565


def _chain(glc, arg, extra=0.0):
    return glc * GLC + arg * ARG + (glc + arg - 1) * BOND + extra


def _depsi(mz, intensity, **settings):
    base = {"enabled": True, "monomers_text": f"Glc, {GLC}\nArg, {ARG}", "charges": "1", "max_dp": 12,
            "tol_value": 0.02, "tol_unit": "Da", "min_rel_int": 0.05}
    base.update(settings)
    return polymer_match_labels(np.asarray(mz, float), np.asarray(intensity, float), polarity="positive", settings=base)


def _texts(labels):
    return {lab["text"] for lab in labels}


def test_mixed_dimers_of_two_different_chains():
    a, b = _chain(1, 1), _chain(2, 1)
    mz = [a + PROTON, b + PROTON, a + b + PROTON]
    on = _depsi(mz, [1000.0, 800.0, 300.0], mixed_dimers=True)
    assert "1-Glc + 1-Arg · 2-Glc + 1-Arg [A+B+H]⁺" in _texts(on)
    assert next(lab for lab in on if "[A+B+H]" in lab["text"])["kind"] == "dimer"
    assert not any("[A+B+H]" in t for t in _texts(_depsi(mz, [1000.0, 800.0, 300.0])))


def test_named_end_groups_are_matched_and_named():
    labels = _depsi([_chain(1, 1, 14.01565) + PROTON], [1000.0], end_groups=[{"name": "Me ester", "mass": 14.01565}])
    assert any("1-Glc + 1-Arg" in t and "(Me ester)" in t for t in _texts(labels))


def test_other_adducts_only_without_a_protonated_match():
    a = _chain(1, 1)
    mz, inten = [a + PROTON, a + 22.989218], [1000.0, 600.0]
    both = _texts(_depsi(mz, inten, adduct_na=True))
    assert any("[M+Na]" in t for t in both) and any("[M+H]" in t for t in both)
    only_h = _texts(_depsi(mz, inten, adduct_na=True, adduct_fallback=True))
    assert not any("[M+Na]" in t for t in only_h) and any("[M+H]" in t for t in only_h)
    assert any("[M+Na]" in t for t in _texts(_depsi([a + 22.989218], [600.0], adduct_na=True, adduct_fallback=True)))


def test_amino_acid_limit_per_chain():
    mz, inten = [_chain(1, 1) + PROTON, _chain(0, 4) + PROTON], [1000.0, 900.0]
    kept = _texts(_depsi(mz, inten, max_amino_acids=3, amino_names=["Arg"]))
    assert any("1-Glc + 1-Arg" in t for t in kept) and not any(t.startswith("4-Arg") for t in kept)
    assert any(t.startswith("4-Arg") for t in _texts(_depsi(mz, inten)))


def test_isotopes_half_a_dalton_apart_hide_a_1plus_label():
    ion = _chain(1, 1) + PROTON
    mz, inten = [ion, ion + 0.5017], [1000.0, 500.0]
    assert any("1-Glc + 1-Arg" in t for t in _texts(_depsi(mz, inten)))
    assert not any("1-Glc + 1-Arg [M+H]⁺" == t for t in _texts(_depsi(mz, inten, isotope_check=True)))
