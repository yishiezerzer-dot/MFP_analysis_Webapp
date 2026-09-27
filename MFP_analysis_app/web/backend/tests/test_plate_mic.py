import statistics as st
from pathlib import Path

import pytest

from lab_gui.plate_gen5 import read_plate
from lab_gui.plate_mic import Dilution, PlateLayout, analyse_plate, layout_from_suggestions, well_concentration

FIX = Path(__file__).parent / "fixtures" / "plate_reader"
POLY = read_plate(FIX / "gen5_lacglydoh_511_111.xlsx")
GENT = read_plate(FIX / "gen5_gentamicin.xlsx")
ROWS = "ABCDEFGH"


def rows_wells(rows, cols=range(1, 12)):
    return [f"{r}{c}" for r in rows for c in cols]


def poly_layout(**kw):
    return layout_from_suggestions(
        [{"name": "LacGlyDOH 5:1:1", "rows": list("ABC")}, {"name": "LacGlyDOH 1:1:1", "rows": list("DEF")}],
        blank_rows=list("GH"),
        **kw,
    )


def group(result, name):
    return next(g for g in result["groups"] if g["name"] == name)


def check(result, check_id):
    return [c for c in result["checks"] if c["id"] == check_id]


def test_concentrations_follow_the_dilution_series():
    d = Dilution(top=1024, factor=2, first=1, last=11)
    assert well_concentration("A1", d) == 1024
    assert well_concentration("C11", d) == 1
    assert well_concentration("A12", d) is None
    assert well_concentration("D4", Dilution(top=64, factor=2, direction="rows", first=1, last=8)) == 8


def test_layout_from_notes_uses_columns_1_to_11_and_column_12_growth_control():
    layout = poly_layout()
    g1 = layout.groups[0]
    assert g1.name == "LacGlyDOH 5:1:1" and g1.wells == rows_wells("ABC")
    assert layout.growth_control == [f"{r}12" for r in "ABCDEF"]
    assert layout.blank == rows_wells("GH", range(1, 13))
    assert PlateLayout.from_dict(layout.to_dict()) == layout


def test_blank_growth_control_and_percent_growth_on_the_polymer_plate():
    res = analyse_plate(POLY.values, poly_layout(excluded=["F1"]))
    assert res["blank"]["mean"] == pytest.approx(st.mean(POLY.values[w] for w in rows_wells("GH", range(1, 13))))
    assert res["blank"]["mean"] == pytest.approx(0.0473, abs=1e-4)
    g1 = group(res, "LacGlyDOH 5:1:1")
    assert g1["growth_control"]["wells"] == ["A12", "B12", "C12"]
    assert g1["growth_control"]["mean"] == pytest.approx(1.141, abs=1e-3)
    top = g1["points"][0]
    assert top["concentration"] == 1024 and top["n"] == 3
    expected = st.mean(POLY.values[w] - res["blank"]["mean"] for w in ("A1", "B1", "C1"))
    assert top["mean"] == pytest.approx(expected)
    assert top["sd"] == pytest.approx(st.stdev(POLY.values[w] - res["blank"]["mean"] for w in ("A1", "B1", "C1")))
    assert top["percent_growth"] == pytest.approx(100 * expected / g1["growth_control"]["mean"])
    # F1 is excluded: n drops to 2 for the other polymer at the top concentration
    g2 = group(res, "LacGlyDOH 1:1:1")
    assert g2["points"][0]["n"] == 2
    assert [round(p["percent_growth"]) for p in g2["points"]] == [72, 77, 73, 74, 80, 79, 79, 76, 77, 81, 86]


def test_blank_subtraction_can_be_turned_off():
    res = analyse_plate(POLY.values, poly_layout(), subtract_blank=False)
    assert res["blank"]["used"] is False
    assert group(res, "LacGlyDOH 5:1:1")["points"][0]["mean"] == pytest.approx(st.mean([1.099, 1.15, 1.095]))


def test_gentamicin_percent_growth_and_inhibited_growth_control_warning():
    layout = layout_from_suggestions([{"name": "Gentamicin", "rows": list("ABC")}], blank_rows=list("DEFGH"))
    res = analyse_plate(GENT.values, layout)
    warns = check(res, "growth_control_inhibited")
    assert warns and "B12" in warns[0]["message"]

    layout.excluded.append("B12")
    res = analyse_plate(GENT.values, layout)
    pct = [round(p["percent_growth"]) for p in group(res, "Gentamicin")["points"]]
    assert pct == [0, 0, 0, 0, 0, 0, 0, 0, 0, 22, 46]
    assert not check(res, "growth_control_inhibited")
    assert check(res, "mic_in_range")[0]["level"] == "info"


def test_replicate_disagreement_names_the_deviating_row():
    res = analyse_plate(POLY.values, poly_layout(excluded=["F1"]))
    warn = [c for c in check(res, "replicate_agreement") if c.get("group") == "LacGlyDOH 5:1:1"]
    assert warn and warn[0]["level"] == "warn"
    assert "row A" in warn[0]["message"]
    assert "256" in warn[0]["message"] and "128" in warn[0]["message"]


def test_no_mic_within_range_is_reported():
    res = analyse_plate(POLY.values, poly_layout(excluded=["F1"]))
    msg = [c for c in check(res, "mic_in_range") if c.get("group") == "LacGlyDOH 5:1:1"][0]["message"]
    assert "not reached" in msg


def test_reader_range_and_growth_checks():
    values = dict(POLY.values)
    values["A1"] = 3.1
    res = analyse_plate(values, poly_layout())
    assert check(res, "reader_range")[0]["level"] == "warn"
    flat = {w: 0.05 for w in values}
    res = analyse_plate(flat, poly_layout())
    assert any(c["level"] == "warn" for c in check(res, "growth_control_grew"))


def test_optional_4pl_fit_is_off_by_default():
    layout = layout_from_suggestions([{"name": "Gentamicin", "rows": list("ABC")}], blank_rows=list("DEFGH"), excluded=["B12"])
    assert group(analyse_plate(GENT.values, layout), "Gentamicin")["fit"] is None
    fit = group(analyse_plate(GENT.values, layout, fit_4pl=True), "Gentamicin")["fit"]
    assert fit is None or fit["ic50"] > 0
