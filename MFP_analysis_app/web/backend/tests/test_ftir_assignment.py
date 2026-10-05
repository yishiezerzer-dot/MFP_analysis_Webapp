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

    assert top_id(assignments, 1650) in ("alkene_cc", "nitro_no2_asym")
    assert all(candidate["category"] != "amide" for item in assignments for candidate in item["candidates"])


def test_categories_are_derived_from_v3_library():
    meta = library_categories()

    assert "ester" in meta["categories"]
    assert "amide" in meta["categories"]
    assert "amide I" in meta["subcategories_by_category"]["amide"]


def test_aliphatic_polyester_is_not_called_phosphate_aromatic_or_nitro():
    # PLGA film: ester C=O and C-O, CH bends, C-C skeletal and alkyl C-H stretches.
    peaks = [
        peak(1755, width=30), peak(1185, prominence=0.6, width=33), peak(1090, prominence=0.9, width=35),
        peak(1454, prominence=0.15, width=21), peak(1384, prominence=0.15, width=16),
        peak(870, prominence=0.1, width=20), peak(750, prominence=0.1, width=20),
        peak(2950, prominence=0.1, width=26), peak(2995, prominence=0.08, width=18),
    ]
    assignments = assign_ftir_peaks(peaks, FTIR_LIBRARY_V3, top_n=3)
    expected = {
        1755: "ester_co", 1185: "ester_co_asym", 1090: "ester_co_sym", 1454: "ch2_ch3_bend",
        1384: "ch3_sym_bend", 870: "cc_skeletal", 750: "cc_skeletal", 2950: "ch_sp3", 2995: "ch_sp3",
    }
    assert {wn: top_id(assignments, wn) for wn in expected} == expected


def test_polystyrene_still_gets_aromatic_assignments():
    peaks = [
        peak(3060, prominence=0.2, width=10), peak(3026, prominence=0.3, width=10), peak(2920, prominence=0.5, width=20),
        peak(1601, prominence=0.3, width=8), peak(1493, prominence=0.6, width=8), peak(1452, prominence=0.6, width=10),
        peak(756, prominence=0.8, width=10), peak(698, prominence=1.0, width=10),
    ]
    assignments = assign_ftir_peaks(peaks, FTIR_LIBRARY_V3, top_n=3)
    assert top_id(assignments, 1601) == "aromatic_cc"
    assert top_id(assignments, 1493) == "aromatic_cc_1500"
    assert top_id(assignments, 756) == "aromatic_ch_oop"
    assert top_id(assignments, 698) == "aromatic_ch_oop"
    assert top_id(assignments, 3026) == "ch_sp2"


def test_carboxylic_acid_oh_needs_a_broad_band_and_an_acid_carbonyl():
    acid = assign_ftir_peaks([peak(3000, prominence=0.6, width=500), peak(1710, width=25)], FTIR_LIBRARY_V3, top_n=3)
    assert top_id(acid, 3000) == "oh_acid_broad"
    ester = assign_ftir_peaks([peak(2950, prominence=0.2, width=25), peak(1750, width=25)], FTIR_LIBRARY_V3, top_n=3)
    assert top_id(ester, 2950) == "ch_sp3"
