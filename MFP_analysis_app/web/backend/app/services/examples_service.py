"""Bundled example datasets for "Try with example data" (files in app/examples/data)."""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional

DATA_DIR = Path(__file__).resolve().parent.parent / "examples" / "data"
EXAMPLE_TAG = "Example"


@dataclass(frozen=True)
class ExamplePlate:
    file: str
    display_name: str
    layout: Dict[str, Any]


@dataclass(frozen=True)
class Example:
    id: str
    module: str  # "lcms" | "ftir" | "plate_reader"
    route: str
    title: str
    description: str
    try_this: List[str]
    file: Optional[str] = None
    display_name: Optional[str] = None
    uv_file: Optional[str] = None
    plates: List[ExamplePlate] = field(default_factory=list)

    def summary(self) -> Dict[str, Any]:
        return {"id": self.id, "module": self.module, "route": self.route, "title": self.title,
                "description": self.description, "try_this": self.try_this}


def _rows(rows: str, cols=range(1, 12)) -> List[str]:
    return [f"{r}{c}" for r in rows for c in cols]


_DILUTION = {"top": 1024, "unit": "µg/mL", "factor": 2, "direction": "columns", "first": 1, "last": 11}

EXAMPLES: List[Example] = [
    Example(
        id="lcms-plga",
        module="lcms",
        route="/lcms",
        title="PLGA oligomers (LCMS, synthetic)",
        description="A made-up ESI+ run of glycolic/lactic acid oligomers (2–8 units) eluting over 14 min, "
                    "as [M+H]⁺ and [M+Na]⁺ with isotopes, a plasticiser background at m/z 391.28 and a UV trace.",
        try_this=[
            "Click a TIC peak to see its spectrum.",
            "Make an EIC for m/z 135.03 (the GA–GA dimer, [M+H]⁺).",
            "Polymer Match: tick glycolic acid and lactic acid, set ESI+, enable matching.",
        ],
        file="example_plga.mzML",
        display_name="Example – PLGA oligomers.mzML",
        uv_file="example_plga_uv.csv",
    ),
    Example(
        id="ftir-plga",
        module="ftir",
        route="/ftir",
        title="PLGA film (FTIR, synthetic)",
        description="A made-up absorbance spectrum of a polyester film: ester C=O near 1755 cm⁻¹, C–O–C "
                    "bands at 1185 and 1090 cm⁻¹, C–H stretches and a weak broad O–H.",
        try_this=[
            "Preprocess: choose the Polymer thin film preset.",
            "Peaks & library → Pick peaks, then read the assignments in the table.",
            "Deconvolution → Carbonyl preset → Deconvolute.",
        ],
        file="example_plga_film.csv",
        display_name="Example – PLGA film.csv",
    ),
    Example(
        id="plate-mic",
        module="plate_reader",
        route="/plate-reader",
        title="MIC plates: two polymers + gentamicin (real Gen5 data)",
        description="Two BioTek Gen5 plates, already laid out: a gentamicin reference plate, and LacGlyDOH 5:1:1 "
                    "(rows A–C) and 1:1:1 (D–F) with blank rows G–H. B12 and F1 are excluded.",
        try_this=[
            "Results: read gentamicin's MIC (no growth down to 4 µg/mL).",
            "Open How is this calculated? on the % growth chart.",
            "Experiment: both plates side by side in the MIC reading grid.",
        ],
        plates=[
            ExamplePlate(
                file="example_mic_gentamicin.xlsx",
                display_name="Example – gentamicin.xlsx",
                layout={
                    "dilution": _DILUTION,
                    "groups": [{"id": "g-gentamicin", "name": "Gentamicin", "kind": "reference", "colour": "#b45309", "wells": _rows("ABC")}],
                    "growth_control": ["A12", "B12", "C12"],
                    "blank": _rows("DEFGH", range(1, 13)),
                    "excluded": ["B12"],
                },
            ),
            ExamplePlate(
                file="example_mic_polymers.xlsx",
                display_name="Example – LacGlyDOH 511 and 111.xlsx",
                layout={
                    "dilution": _DILUTION,
                    "groups": [
                        {"id": "g-polymer-511", "name": "LacGlyDOH 5:1:1", "kind": "sample", "colour": "#405a9c", "wells": _rows("ABC")},
                        {"id": "g-polymer-111", "name": "LacGlyDOH 1:1:1", "kind": "sample", "colour": "#047857", "wells": _rows("DEF")},
                    ],
                    "growth_control": [f"{r}12" for r in "ABCDEF"],
                    "blank": _rows("GH", range(1, 13)),
                    "excluded": ["F1"],
                },
            ),
        ],
    ),
]

_BY_ID = {e.id: e for e in EXAMPLES}


def get_example(example_id: str) -> Optional[Example]:
    return _BY_ID.get(example_id)
