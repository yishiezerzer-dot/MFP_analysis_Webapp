from lab_gui.ftir_assignment import assign_ftir_peaks
from lab_gui.ftir_library import FTIR_LIBRARY_V3, library_categories


def peak(wn: float, *, height: float = 1.0, prominence: float = 1.0, width: float = 12.0):
    return {"wn": wn, "height": height, "prominence": prominence, "width": width}


def top_id(assignments, wn: float) -> str:
    match = next(item for item in assignments if abs(item["wn"] - wn) < 0.01)
    return match["candidates"][0]["id"]


def test_ester_carbonyl_uses_co_context():
    assignments = assign_ftir_peaks(
        [
            peak(1740, height=1.0, prominence=1.0),
            peak(1245, height=0.9, prominence=0.9),
            peak(1050, height=0.7, prominence=0.7),
        ],
        FTIR_LIBRARY_V3,
        top_n=4,
    )

    assert top_id(assignments, 1740) == "ester_co"


def test_amide_i_uses_amide_ii_and_nh_context():
    assignments = assign_ftir_peaks(
        [
            peak(1650, height=1.0, prominence=1.0, width=24),
            peak(1545, height=0.85, prominence=0.85, width=24),
            peak(3300, height=0.5, prominence=0.5, width=28),
        ],
        FTIR_LIBRARY_V3,
        top_n=4,
    )

    assert top_id(assignments, 1650) == "amide_I"


def test_aromatic_ring_uses_multi_peak_context():
    assignments = assign_ftir_peaks(
        [
            peak(1600, height=1.0, prominence=1.0, width=24),
            peak(1500, height=0.7, prominence=0.7, width=22),
            peak(750, height=0.6, prominence=0.6, width=16),
        ],
        FTIR_LIBRARY_V3,
        top_n=4,
    )

    assert top_id(assignments, 1600) == "aromatic_cc"


def test_excluded_category_rules_out_amide():
    assignments = assign_ftir_peaks(
        [
            peak(1650, height=1.0, prominence=1.0, width=24),
            peak(1545, height=0.85, prominence=0.85, width=24),
            peak(3300, height=0.5, prominence=0.5, width=28),
        ],
        FTIR_LIBRARY_V3,
        top_n=4,
        excluded_categories=["amide"],
    )

    assert top_id(assignments, 1650) == "alkene_cc"
    assert all(candidate["category"] != "amide" for item in assignments for candidate in item["candidates"])


def test_categories_are_derived_from_v3_library():
    meta = library_categories()

    assert "ester" in meta["categories"]
    assert "amide" in meta["categories"]
    assert "amide I" in meta["subcategories_by_category"]["amide"]
