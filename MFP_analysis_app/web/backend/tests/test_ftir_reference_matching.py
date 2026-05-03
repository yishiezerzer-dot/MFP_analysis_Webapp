import numpy as np

from lab_gui.ftir_reference_library import REFERENCES, match_reference_spectra, synthesize_reference


def test_reference_match_ranks_pet_first_for_pet_like_spectrum():
    grid = np.linspace(650.0, 1800.0, 900)
    pet = next(ref for ref in REFERENCES if ref["name"] == "PET")
    y = synthesize_reference(pet, grid)

    result = match_reference_spectra(grid, y, region=(650.0, 1800.0), derivative_order=1, top_n=5)

    assert result["hits"]
    assert result["hits"][0]["name"] == "PET"
    assert result["hits"][0]["correlation"] > 0.95


def test_reference_match_returns_chart_ready_reference_arrays():
    grid = np.linspace(650.0, 1800.0, 900)
    pe = next(ref for ref in REFERENCES if ref["name"] == "PE")
    y = synthesize_reference(pe, grid)

    result = match_reference_spectra(grid, y, derivative_order=0, top_n=3)
    top = result["hits"][0]

    assert top["reference"]["wn"]
    assert top["reference"]["y"]
    assert len(top["reference"]["wn"]) == len(top["reference"]["y"])
    assert top["ranking_method"] == "pearson"
