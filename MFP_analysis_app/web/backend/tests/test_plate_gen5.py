from pathlib import Path

import pytest

from lab_gui.plate_gen5 import PlateReadError, parse_layout_notes, read_plate

FIX = Path(__file__).parent / "fixtures" / "plate_reader"


def test_reads_gen5_metadata_grid_and_notes():
    read = read_plate(FIX / "gen5_lacglydoh_511_111.xlsx")
    assert read.metadata["plate_number"] == "Plate 1"
    assert read.metadata["reader_type"] == "Synergy H1"
    assert read.metadata["read_type"] == "Absorbance Endpoint"
    assert read.metadata["wavelength"] == "600"
    assert read.metadata["date"].startswith("2026-09-02")
    assert read.metadata["time"] == "15:37:09"
    assert read.metadata["temperature"] == pytest.approx(21.3)
    assert len(read.values) == 96
    assert read.values["A1"] == pytest.approx(1.099)
    assert read.values["F1"] == pytest.approx(0.485)
    assert read.values["H12"] == pytest.approx(0.047)
    assert read.label == "600"
    assert read.notes == ["A-C - LacGlyDOH 5:1:1", "D-F - LacGlyDOH 1:1:1"]


def test_reads_second_export_without_notes():
    read = read_plate(FIX / "gen5_gentamicin.xlsx")
    assert read.metadata["plate_number"] == "Plate 3"
    assert read.values["A11"] == pytest.approx(0.966)
    assert read.values["C12"] == pytest.approx(1.398)
    assert read.values["B12"] == pytest.approx(0.041)
    assert read.notes == []


def test_notes_become_compound_suggestions():
    groups = parse_layout_notes(["A-C - LacGlyDOH 5:1:1", "D–F: LacGlyDOH 1:1:1", "rows G-H blank wells", "incubated 18 h"])
    assert groups == [
        {"name": "LacGlyDOH 5:1:1", "rows": ["A", "B", "C"]},
        {"name": "LacGlyDOH 1:1:1", "rows": ["D", "E", "F"]},
        {"name": "blank wells", "rows": ["G", "H"]},
    ]


def test_plain_8x12_csv_without_gen5_header(tmp_path):
    lines = [",1,2,3,4,5,6,7,8,9,10,11,12"]
    for i, row in enumerate("ABCDEFGH"):
        lines.append(row + "," + ",".join(f"{0.1 * (i + 1) + c / 100:.3f}" for c in range(12)))
    path = tmp_path / "plain.csv"
    path.write_text("\n".join(lines), encoding="utf-8")
    read = read_plate(path)
    assert read.metadata == {}
    assert read.values["A1"] == pytest.approx(0.1)
    assert read.values["H12"] == pytest.approx(0.91)


def test_missing_block_is_a_clear_error(tmp_path):
    path = tmp_path / "junk.csv"
    path.write_text("a,b\n1,2\n", encoding="utf-8")
    with pytest.raises(PlateReadError, match="No 8×12 plate block"):
        read_plate(path)
