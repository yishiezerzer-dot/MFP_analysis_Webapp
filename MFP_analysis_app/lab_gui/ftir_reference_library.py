"""Small built-in FTIR reference matcher.

The bundled references are compact characteristic-band fingerprints for common
polymers. They are not a replacement for curated measured spectra, but they
provide a deterministic local hit list without network or database setup.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Sequence, Tuple

import math

import numpy as np


REFERENCE_REGION: Tuple[float, float] = (650.0, 1800.0)


REFERENCES: List[Dict[str, Any]] = [
    {
        "name": "PE",
        "label": "Polyethylene",
        "source": "Characteristic PE bands from common polymer FTIR correlation tables.",
        "bands": [(1472, 1.0, 18), (1463, 0.7, 14), (730, 0.9, 14), (720, 0.8, 14)],
    },
    {
        "name": "PP",
        "label": "Polypropylene",
        "source": "Characteristic PP bands from common polymer FTIR correlation tables.",
        "bands": [(1456, 1.0, 18), (1376, 0.9, 16), (1167, 0.65, 18), (998, 0.65, 14), (973, 0.55, 14), (841, 0.5, 16)],
    },
    {
        "name": "PS",
        "label": "Polystyrene",
        "source": "Characteristic PS aromatic bands from common polymer FTIR correlation tables.",
        "bands": [(1601, 0.85, 18), (1493, 1.0, 16), (1452, 0.75, 16), (1028, 0.45, 16), (758, 0.95, 14), (698, 0.9, 14)],
    },
    {
        "name": "PMMA",
        "label": "Poly(methyl methacrylate)",
        "source": "Characteristic PMMA ester bands from common polymer FTIR correlation tables.",
        "bands": [(1728, 1.0, 22), (1435, 0.45, 18), (1387, 0.38, 16), (1270, 0.75, 18), (1190, 0.9, 18), (1148, 0.85, 16)],
    },
    {
        "name": "PET",
        "label": "Polyethylene terephthalate",
        "source": "Characteristic PET ester/aromatic bands from common polymer FTIR correlation tables.",
        "bands": [(1715, 1.0, 22), (1578, 0.45, 18), (1505, 0.5, 16), (1410, 0.4, 18), (1240, 0.9, 18), (1095, 0.75, 18), (872, 0.5, 14), (725, 0.55, 14)],
    },
    {
        "name": "PLA",
        "label": "Polylactic acid",
        "source": "Characteristic PLA ester bands from common polymer FTIR correlation tables.",
        "bands": [(1750, 1.0, 22), (1454, 0.45, 16), (1382, 0.45, 16), (1360, 0.35, 16), (1180, 0.8, 18), (1082, 0.7, 16), (868, 0.45, 14), (755, 0.4, 14)],
    },
    {
        "name": "nylon-6",
        "label": "Nylon-6",
        "source": "Characteristic polyamide bands from common polymer FTIR correlation tables.",
        "bands": [(1635, 1.0, 24), (1540, 0.9, 22), (1465, 0.45, 18), (1418, 0.35, 18), (1265, 0.55, 18), (1200, 0.35, 18), (930, 0.35, 16)],
    },
    {
        "name": "nylon-6,6",
        "label": "Nylon-6,6",
        "source": "Characteristic polyamide bands from common polymer FTIR correlation tables.",
        "bands": [(1632, 1.0, 24), (1534, 0.92, 22), (1463, 0.5, 18), (1372, 0.35, 16), (1200, 0.45, 18), (936, 0.38, 16)],
    },
    {
        "name": "cellulose",
        "label": "Cellulose",
        "source": "Characteristic cellulose fingerprint bands from common biopolymer FTIR tables.",
        "bands": [(1640, 0.35, 30), (1428, 0.55, 18), (1370, 0.45, 16), (1316, 0.35, 16), (1160, 0.65, 18), (1058, 1.0, 22), (1030, 0.8, 18), (897, 0.45, 14)],
    },
    {
        "name": "chitosan",
        "label": "Chitosan",
        "source": "Characteristic chitosan amide/amine and polysaccharide bands from common FTIR tables.",
        "bands": [(1655, 0.65, 24), (1590, 0.75, 22), (1420, 0.35, 18), (1375, 0.35, 16), (1152, 0.6, 18), (1075, 0.9, 20), (1030, 0.85, 18), (895, 0.35, 14)],
    },
    {
        "name": "polyurethane",
        "label": "Polyurethane",
        "source": "Characteristic polyurethane urethane carbonyl/amide bands from common FTIR tables.",
        "bands": [(1725, 0.9, 24), (1700, 0.65, 24), (1530, 0.85, 22), (1450, 0.45, 18), (1220, 0.7, 18), (1100, 0.75, 20), (770, 0.35, 14)],
    },
    {
        "name": "PVA",
        "label": "Polyvinyl alcohol",
        "source": "Characteristic PVA C-O/O-H-related fingerprint bands from common polymer FTIR tables.",
        "bands": [(1730, 0.35, 24), (1420, 0.45, 18), (1375, 0.4, 16), (1328, 0.35, 16), (1240, 0.4, 18), (1090, 1.0, 22), (850, 0.35, 16)],
    },
]


def reference_names() -> List[str]:
    return [str(ref["name"]) for ref in REFERENCES]


def match_reference_spectra(
    wn: Sequence[float],
    y: Sequence[float],
    *,
    region: Optional[Tuple[float, float]] = None,
    derivative_order: int = 1,
    top_n: int = 8,
) -> Dict[str, Any]:
    """Rank built-in references against a spectrum using Pearson correlation."""

    x = np.asarray(wn, dtype=float)
    yy = np.asarray(y, dtype=float)
    mask = np.isfinite(x) & np.isfinite(yy)
    x = x[mask]
    yy = yy[mask]
    if x.size < 5:
        return {"hits": [], "ranking_method": "first-derivative-pearson", "region": list(region or REFERENCE_REGION)}

    lo, hi = sorted(region or REFERENCE_REGION)
    grid = np.linspace(lo, hi, 900)
    sample = np.interp(grid, x, yy)
    sample_vec = _prepare_vector(sample, derivative_order=derivative_order)

    hits: List[Dict[str, Any]] = []
    for ref in REFERENCES:
        ref_y = synthesize_reference(ref, grid)
        ref_vec = _prepare_vector(ref_y, derivative_order=derivative_order)
        corr = _pearson(sample_vec, ref_vec)
        ref_plot = _normalize_for_plot(ref_y)
        hits.append(
            {
                "name": ref["name"],
                "label": ref["label"],
                "correlation": corr,
                "ranking_method": _ranking_method(derivative_order),
                "source": ref["source"],
                "reference": {
                    "wn": [float(v) for v in grid.tolist()],
                    "y": [float(v) for v in ref_plot.tolist()],
                },
            }
        )

    hits.sort(key=lambda hit: float(hit["correlation"]), reverse=True)
    return {
        "hits": hits[: max(1, int(top_n or 8))],
        "ranking_method": _ranking_method(derivative_order),
        "region": [float(lo), float(hi)],
    }


def synthesize_reference(reference: Dict[str, Any], grid: np.ndarray) -> np.ndarray:
    x = np.asarray(grid, dtype=float)
    y = np.zeros_like(x, dtype=float)
    for center, amp, width in reference.get("bands") or []:
        c = float(center)
        a = float(amp)
        w = max(1.0, float(width))
        y += a * np.exp(-0.5 * ((x - c) / w) ** 2)
    return _normalize_for_plot(y)


def _prepare_vector(y: np.ndarray, *, derivative_order: int) -> np.ndarray:
    vec = np.asarray(y, dtype=float)
    for _ in range(max(0, min(2, int(derivative_order or 0)))):
        vec = np.gradient(vec)
    return _standardize(vec)


def _standardize(y: np.ndarray) -> np.ndarray:
    vec = np.asarray(y, dtype=float)
    mean = float(np.nanmean(vec))
    sd = float(np.nanstd(vec))
    if not math.isfinite(sd) or sd <= 1e-12:
        return vec * 0.0
    return (vec - mean) / sd


def _normalize_for_plot(y: np.ndarray) -> np.ndarray:
    vec = np.asarray(y, dtype=float)
    mx = float(np.nanmax(np.abs(vec))) if vec.size else 0.0
    if not math.isfinite(mx) or mx <= 0:
        return vec
    return vec / mx


def _pearson(a: np.ndarray, b: np.ndarray) -> float:
    aa = _standardize(a)
    bb = _standardize(b)
    denom = float(np.sqrt(np.dot(aa, aa) * np.dot(bb, bb)))
    if not math.isfinite(denom) or denom <= 1e-12:
        return 0.0
    return float(np.dot(aa, bb) / denom)


def _ranking_method(derivative_order: int) -> str:
    if int(derivative_order or 0) <= 0:
        return "pearson"
    if int(derivative_order) == 1:
        return "first-derivative-pearson"
    return "second-derivative-pearson"
