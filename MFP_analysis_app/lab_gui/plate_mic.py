"""MIC plate analysis from a plate map (wells -> compound, concentration, controls).

Pure functions shared by the web app and the desktop app. The MIC itself is read by eye; this
module provides the numbers behind the charts (blank-subtracted OD, mean/SD per concentration,
% growth relative to the compound's own growth-control wells) and quality checks.
"""
from __future__ import annotations

import math
import statistics as st
from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Literal, Optional, Sequence

ROWS = "ABCDEFGH"

# Check thresholds (reported in the explanation panels).
MIN_GROWTH_OD = 0.2          # growth control must exceed the blank by at least this
MAX_CV_PERCENT = 20.0        # replicate / growth-control / blank spread
MAX_BLANK_OD = 0.1
MAX_READER_OD = 2.5          # above this absorbance readers are no longer linear
INHIBITED_GC_FRACTION = 0.5  # a growth-control well below half of its partners looks inhibited
NO_GROWTH_PERCENT = 10.0     # "no growth" for the MIC-in-range note
MIN_NOISE_OD = 0.05          # without a growth control, means below this count as no growth


def _split(well: str) -> tuple:
    return well[0].upper(), int(well[1:])


@dataclass
class Dilution:
    top: float = 1024.0
    unit: str = "µg/mL"
    factor: float = 2.0
    direction: Literal["columns", "rows"] = "columns"
    first: int = 1
    last: int = 11


@dataclass
class Group:
    id: str
    name: str
    kind: Literal["sample", "reference"] = "sample"
    wells: List[str] = field(default_factory=list)
    colour: Optional[str] = None


@dataclass
class PlateLayout:
    dilution: Dilution = field(default_factory=Dilution)
    groups: List[Group] = field(default_factory=list)
    growth_control: List[str] = field(default_factory=list)
    blank: List[str] = field(default_factory=list)
    excluded: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "PlateLayout":
        return cls(
            dilution=Dilution(**(data.get("dilution") or {})),
            groups=[Group(**g) for g in data.get("groups") or []],
            growth_control=list(data.get("growth_control") or []),
            blank=list(data.get("blank") or []),
            excluded=list(data.get("excluded") or []),
        )


def _position(well: str, direction: str) -> int:
    row, col = _split(well)
    return col if direction == "columns" else ROWS.index(row) + 1


def well_concentration(well: str, dilution: Dilution) -> Optional[float]:
    pos = _position(well, dilution.direction)
    if not dilution.first <= pos <= dilution.last:
        return None
    return dilution.top / dilution.factor ** (pos - dilution.first)


def layout_from_suggestions(
    suggestions: Sequence[Dict[str, Any]],
    *,
    dilution: Optional[Dilution] = None,
    growth_control_column: int = 12,
    blank_rows: Sequence[str] = (),
    excluded: Sequence[str] = (),
) -> PlateLayout:
    """Build a column-direction layout from {name, rows} suggestions (e.g. parsed Gen5 notes)."""
    d = dilution or Dilution()
    cols = range(d.first, d.last + 1)
    groups = []
    gc: List[str] = []
    for i, s in enumerate(suggestions):
        rows = [r.upper() for r in s["rows"]]
        groups.append(Group(id=f"g{i + 1}", name=s["name"], kind=s.get("kind", "sample"),
                            wells=[f"{r}{c}" for r in rows for c in cols]))
        gc += [f"{r}{growth_control_column}" for r in rows]
    blank = [f"{r}{c}" for r in blank_rows for c in range(1, 13)]
    return PlateLayout(dilution=d, groups=groups, growth_control=gc, blank=blank, excluded=list(excluded))


def _mean_sd(values: List[float]) -> tuple:
    if not values:
        return None, None
    return st.mean(values), (st.stdev(values) if len(values) > 1 else None)


def _cv(mean: Optional[float], sd: Optional[float]) -> Optional[float]:
    if mean is None or sd is None or mean == 0:
        return None
    return abs(100 * sd / mean)


def _fmt(c: float) -> str:
    return f"{c:g}"


def analyse_plate(
    values: Dict[str, Optional[float]],
    layout: PlateLayout,
    *,
    subtract_blank: bool = True,
    fit_4pl: bool = False,
) -> Dict[str, Any]:
    excluded = set(layout.excluded)
    ok = lambda w: w not in excluded and values.get(w) is not None and math.isfinite(values[w])  # noqa: E731

    blank_wells = [w for w in layout.blank if ok(w)]
    blank_raw = [values[w] for w in blank_wells]
    blank_mean, blank_sd = _mean_sd(blank_raw)
    use_blank = bool(subtract_blank and blank_wells)
    offset = blank_mean if use_blank else 0.0
    v = lambda w: values[w] - offset  # noqa: E731

    checks: List[Dict[str, Any]] = []
    if blank_wells:
        blank_cv = _cv(blank_mean, blank_sd)
        bad = blank_mean > MAX_BLANK_OD or (blank_cv is not None and blank_cv > MAX_CV_PERCENT)
        checks.append({
            "id": "blank",
            "level": "warn" if bad else "ok",
            "message": (f"Blank {blank_mean:.3f} ± {blank_sd or 0:.3f} over {len(blank_wells)} wells"
                        + (f" (limit mean ≤ {MAX_BLANK_OD}, CV ≤ {MAX_CV_PERCENT:g}%)" if bad else " is low and even")),
        })

    high = [w for w, x in values.items() if x is not None and x > MAX_READER_OD]
    checks.append({
        "id": "reader_range",
        "level": "warn" if high else "ok",
        "message": (f"OD above {MAX_READER_OD} (reader no longer linear): {', '.join(sorted(high))}" if high
                    else f"No OD above the reader's reliable range ({MAX_READER_OD})"),
    })

    groups_out = []
    for g in layout.groups:
        rows = {_split(w)[0] for w in g.wells}
        cols = {_split(w)[1] for w in g.wells}
        own = [w for w in layout.growth_control
               if (_split(w)[0] in rows if layout.dilution.direction == "columns" else _split(w)[1] in cols)]
        gc_source = "own" if own else "plate"
        gc_all = own or list(layout.growth_control)
        gc_wells = [w for w in gc_all if ok(w)]
        gc_mean, gc_sd = _mean_sd([v(w) for w in gc_wells])

        # Growth-control wells far below their partners (e.g. contaminated with the drug).
        for w in gc_wells:
            others = [v(o) for o in gc_wells if o != w]
            if others and st.mean(others) > 0 and v(w) < INHIBITED_GC_FRACTION * st.mean(others):
                checks.append({
                    "id": "growth_control_inhibited", "level": "warn", "group": g.name, "well": w,
                    "message": (f"{g.name}: growth-control well {w} reads {values[w]:.3f}, less than half of "
                                f"{', '.join(o for o in gc_wells if o != w)} — likely inhibited or contaminated; "
                                f"consider excluding it"),
                })

        by_conc: Dict[float, List[str]] = {}
        for w in g.wells:
            c = well_concentration(w, layout.dilution)
            if c is not None:
                by_conc.setdefault(c, []).append(w)
        points = []
        for c in sorted(by_conc, reverse=True):
            wells = by_conc[c]
            used = [w for w in wells if ok(w)]
            mean, sd = _mean_sd([v(w) for w in used])
            pct = 100 * mean / gc_mean if (mean is not None and gc_mean) else None
            points.append({
                "concentration": c,
                "n": len(used),
                "mean": mean,
                "sd": sd,
                "cv": _cv(mean, sd),
                "percent_growth": pct,
                "wells": [{
                    "well": w,
                    "raw": values.get(w),
                    "value": v(w) if values.get(w) is not None else None,
                    "percent_growth": (100 * v(w) / gc_mean) if (gc_mean and values.get(w) is not None) else None,
                    "excluded": w in excluded,
                } for w in wells],
            })

        # Checks for this group
        grew = gc_mean is not None and gc_mean >= MIN_GROWTH_OD
        checks.append({
            "id": "growth_control_grew", "level": "ok" if grew else "warn", "group": g.name,
            "message": (f"{g.name}: growth control {gc_mean:.3f} above blank" if grew else
                        f"{g.name}: growth control only {0 if gc_mean is None else gc_mean:.3f} above blank "
                        f"(needs ≥ {MIN_GROWTH_OD}) — % growth is unreliable"),
        })
        gc_cv = _cv(gc_mean, gc_sd)
        if gc_cv is not None:
            checks.append({
                "id": "growth_control_agreement", "level": "warn" if gc_cv > MAX_CV_PERCENT else "ok", "group": g.name,
                "message": f"{g.name}: growth-control wells CV {gc_cv:.0f}%" + (f" (limit {MAX_CV_PERCENT:g}%)" if gc_cv > MAX_CV_PERCENT else ""),
            })
        # Where nothing grew the mean is ~0 OD, so CV explodes on tiny differences: skip those points.
        def grows(p: Dict[str, Any]) -> bool:
            if p["mean"] is None:
                return False
            return p["mean"] >= (NO_GROWTH_PERCENT / 100 * gc_mean if gc_mean else MIN_NOISE_OD)

        growing = [p for p in points if grows(p)]
        noisy = [p for p in growing if p["cv"] is not None and p["cv"] > MAX_CV_PERCENT and p["n"] > 1]
        if noisy:
            # At each disagreeing concentration, the replicate row farthest from the median.
            by_row = layout.dilution.direction == "columns"
            rep = "row" if by_row else "column"
            outliers = []
            for p in noisy:
                vals = {_split(x["well"])[0 if by_row else 1]: x["value"] for x in p["wells"] if not x["excluded"] and x["value"] is not None}
                med = st.median(vals.values())
                out_key, out_val = max(vals.items(), key=lambda kv: abs(kv[1] - med))
                outliers.append((p["concentration"], out_key, out_val - med))
            scale = (lambda d: f"{abs(d) / gc_mean * 100:.0f} % growth points") if gc_mean else (lambda d: f"{abs(d):.3f} OD")
            rows_out = {r for _, r, _ in outliers}
            if len(rows_out) == 1:
                diffs = [d for _, _, d in outliers]
                avg = st.mean(diffs)
                detail = (f": {rep} {outliers[0][1]} reads {'higher' if avg > 0 else 'lower'} than the other {rep}s "
                          f"(by {scale(avg)} on average)")
            else:
                detail = ": " + "; ".join(
                    f"at {_fmt(c)} {layout.dilution.unit} {rep} {r} is {'higher' if d > 0 else 'lower'}" for c, r, d in outliers
                )
            cvs = [p["cv"] for p in noisy]
            checks.append({
                "id": "replicate_agreement", "level": "warn", "group": g.name,
                "message": (f"{g.name}: replicates disagree at {' and '.join(_fmt(p['concentration']) for p in noisy)} "
                            f"{layout.dilution.unit} (CV {min(cvs):.0f}–{max(cvs):.0f}%, limit {MAX_CV_PERCENT:g}%){detail}"),
            })
        else:
            checks.append({"id": "replicate_agreement", "level": "ok", "group": g.name,
                           "message": f"{g.name}: replicates agree (CV ≤ {MAX_CV_PERCENT:g}% where there is growth)"})
        pcts = [p["percent_growth"] for p in points if p["percent_growth"] is not None]
        if pcts:
            no_growth = [p["concentration"] for p in points if p["percent_growth"] is not None and p["percent_growth"] < NO_GROWTH_PERCENT]
            conc = [p["concentration"] for p in points]
            msg = (f"{g.name}: growth below {NO_GROWTH_PERCENT:g}% down to {_fmt(min(no_growth))} {layout.dilution.unit}"
                   if no_growth else
                   f"{g.name}: lowest growth {min(pcts):.0f}% of the growth control — no inhibition below "
                   f"{NO_GROWTH_PERCENT:g}% (MIC not reached within {_fmt(min(conc))}–{_fmt(max(conc))} {layout.dilution.unit})")
            checks.append({"id": "mic_in_range", "level": "info", "group": g.name, "message": msg})

        fit = None
        if fit_4pl:
            from lab_gui.plate_reader_model import fit_4pl_curve

            xy = [(p["concentration"], p["mean"]) for p in points if p["mean"] is not None]
            fit = fit_4pl_curve([x for x, _ in xy], [y for _, y in xy])

        groups_out.append({
            "id": g.id, "name": g.name, "kind": g.kind, "colour": g.colour,
            "growth_control": {"wells": gc_wells, "all_wells": gc_all, "source": gc_source, "mean": gc_mean, "sd": gc_sd, "cv": gc_cv},
            "points": points,
            "fit": fit,
        })

    if excluded:
        checks.append({"id": "excluded", "level": "info", "message": f"Excluded wells: {', '.join(sorted(excluded))}"})

    return {
        "blank": {"used": use_blank, "mean": blank_mean, "sd": blank_sd, "n": len(blank_wells), "wells": blank_wells},
        "unit": layout.dilution.unit,
        "groups": groups_out,
        "checks": checks,
        "excluded": sorted(excluded),
    }
