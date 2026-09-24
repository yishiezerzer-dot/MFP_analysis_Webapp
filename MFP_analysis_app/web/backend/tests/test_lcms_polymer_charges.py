import numpy as np
import pytest

from lab_gui.lcms_polymer_match import (
    PROTON_MASS,
    NA_MASS,
    compute_polymer_best_by_peak_sorted,
    explain_best_match_for_peak_sorted,
)

LACTIC_ACID = 90.031694
WATER_LOSS = -18.010565


def _neutral(dp: int) -> float:
    return dp * LACTIC_ACID + (dp - 1) * WATER_LOSS


def _run(mz, intensity, *, polarity="positive", charges=(1, 2, 3), enable_na=False, custom_adducts=None):
    order = np.argsort(mz)
    mz_s = np.asarray(mz, dtype=float)[order]
    int_s = np.asarray(intensity, dtype=float)[order]
    adduct = PROTON_MASS if polarity == "positive" else -PROTON_MASS
    best = compute_polymer_best_by_peak_sorted(
        mz_s,
        int_s,
        monomer_names=["LA"],
        monomer_masses=[LACTIC_ACID],
        charges=list(charges),
        max_dp=12,
        bond_delta=WATER_LOSS,
        extra_delta=0.0,
        polarity=polarity,
        base_adduct_mass=adduct,
        enable_decarb=False,
        enable_oxid=False,
        enable_cluster=False,
        cluster_adduct_mass=adduct,
        enable_na=enable_na,
        enable_k=False,
        enable_cl=False,
        enable_formate=False,
        custom_adducts=custom_adducts,
        tol_value=0.005,
        tol_unit="Da",
        min_rel_int=0.0,
    )
    return mz_s, {round(float(mz_s[i]), 4): kinds["poly"][1] for i, kinds in best.items() if "poly" in kinds}


@pytest.mark.parametrize("z", [2, 3])
def test_multiply_protonated_ion_uses_z_protons(z):
    target = (_neutral(10) + z * PROTON_MASS) / z
    _, labels = _run([target], [1000.0])
    assert labels.get(round(target, 4), "").startswith("10-LA [M+")
    assert f"+{z}H]" in labels[round(target, 4)]


def test_single_proton_formula_is_not_matched_at_z2():
    wrong = (_neutral(10) + PROTON_MASS) / 2  # the old, incorrect prediction
    _, labels = _run([wrong], [1000.0])
    assert round(wrong, 4) not in labels


def test_negative_mode_doubly_deprotonated():
    target = (_neutral(10) - 2 * PROTON_MASS) / 2
    _, labels = _run([target], [1000.0], polarity="negative")
    assert "−2H]" in labels[round(target, 4)]


def test_singly_charged_label_unchanged():
    target = _neutral(10) + PROTON_MASS
    _, labels = _run([target], [1000.0])
    assert labels[round(target, 4)] == "10-LA [M+H]⁺"


def test_sodium_adduct_only_matched_at_z1():
    na_z1 = _neutral(10) + NA_MASS
    na_z2_naive = (_neutral(10) + NA_MASS) / 2
    _, labels = _run([na_z1, na_z2_naive], [1000.0, 1000.0], enable_na=True)
    assert labels[round(na_z1, 4)] == "10-LA [M+Na]⁺"
    assert round(na_z2_naive, 4) not in labels


def test_custom_adduct_with_explicit_charge_keeps_total_mass_semantics():
    target = (_neutral(3) + 40.0) / 2
    _, labels = _run([target], [1000.0], charges=(1,), custom_adducts=[{"name": "+Ca", "mass": 40.0, "charge": 2}])
    assert labels[round(target, 4)] == "3-LA [M+Ca]²⁺"


def test_explain_reports_z2_candidate():
    target = (_neutral(10) + 2 * PROTON_MASS) / 2
    mz_s = np.array([target])
    out = explain_best_match_for_peak_sorted(
        mz_s,
        np.array([1000.0]),
        peak_i=0,
        target_kind="poly",
        monomer_names=["LA"],
        monomer_masses=[LACTIC_ACID],
        charges=[1, 2],
        max_dp=12,
        bond_delta=WATER_LOSS,
        extra_delta=0.0,
        polarity="positive",
        base_adduct_mass=PROTON_MASS,
        enable_decarb=False,
        enable_oxid=False,
        enable_cluster=False,
        cluster_adduct_mass=PROTON_MASS,
        enable_na=False,
        enable_k=False,
        enable_cl=False,
        enable_formate=False,
        tol_value=0.005,
        tol_unit="Da",
        min_rel_int=0.0,
    )
    assert out is not None
    assert out["z"] == 2
    assert out["abs_err"] < 1e-6
