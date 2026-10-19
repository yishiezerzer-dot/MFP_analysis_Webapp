"""One-click LCMS pipeline: align UV to MS, pick UV peaks, label each peak from its summed spectrum.

For an Agilent single-quad run (mzML + UV CSV): every UV peak's spectrum is summed over the peak
(after the UV→MS offset), matched against this run's monomers with polymer_match_labels, the
candidates ranked and checked by the sanity rules (lcms_sanity), and the kept labels laid out
(lcms_label_layout). Nothing is dropped: weak or doubtful labels are flagged for review.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Callable, Dict, List, Literal, Optional, Tuple

import numpy as np
from pydantic import BaseModel, Field, field_validator
from scipy.ndimage import minimum_filter1d, uniform_filter1d
from scipy.signal import find_peaks, peak_prominences, peak_widths

from .lcms_label_layout import LayoutInput, LayoutItem, LayoutOptions, layout_labels, text_size, trace_top
from .lcms_sanity import IMPLAUSIBLE, LabelFacts, LabelStatus, PeakFacts, SanityRules, apply_rules, check_peak
from .lcms_service import LCMSSessionState, extracted_ion_chromatogram, polymer_match_labels, summed_spectrum_in_rt_range

ProgressCallback = Callable[[float, str], None]

PROTON = 1.007276
NH4 = 18.033823
ADDUCTS = ("H", "Na", "K", "NH4", "Cl", "HCOO", "Ac")
_POSITIVE_ONLY = {"Na", "K", "NH4"}
_NEGATIVE_ONLY = {"Cl", "HCOO", "Ac"}


# ------------------------------------------------------------------ settings and result models


MonomerKind = Literal["hydroxy_acid", "amino_acid", "other"]
_AMINO_ACIDS = {
    "ala", "arg", "asn", "asp", "cys", "gln", "glu", "gly", "his", "ile", "leu", "lys", "met", "phe", "pro", "ser",
    "thr", "trp", "tyr", "val", "orn", "dab", "dap", "cit", "alanine", "arginine", "asparagine", "aspartic acid",
    "cysteine", "glutamine", "glutamic acid", "glycine", "histidine", "isoleucine", "leucine", "lysine", "methionine",
    "phenylalanine", "proline", "serine", "threonine", "tryptophan", "tyrosine", "valine", "ornithine",
}
_HYDROXY_ACIDS = {
    "ga", "glc", "gly acid", "glycolic", "glycolic acid", "la", "lac", "lactic", "lactic acid", "pla", "phenyllactic acid",
    "ma", "mandelic acid", "hba", "hydroxybutyric acid",
}


def monomer_kind(name: str) -> MonomerKind:
    """Hydroxy acid or amino acid from a monomer's name (three-letter code, abbreviation or full name)."""
    key = name.strip().lower()
    if key in _AMINO_ACIDS:
        return "amino_acid"
    if key in _HYDROXY_ACIDS:
        return "hydroxy_acid"
    return "other"


class Monomer(BaseModel):
    name: str = Field(min_length=1)
    mass: float = Field(gt=0)
    kind: Optional[MonomerKind] = Field(None, description="Hydroxy acid or amino acid; from the name when not given.")

    def resolved_kind(self) -> MonomerKind:
        return self.kind or monomer_kind(self.name)

    @field_validator("name")
    @classmethod
    def _clean(cls, value: str) -> str:
        value = value.strip()
        if not value or value[0].isdigit():
            raise ValueError("Monomer names must start with a letter (e.g. GA, Ser).")
        return value


class UVPeakSettings(BaseModel):
    detect_sn: float = Field(3.0, description="Detection threshold: prominence of at least this many noise σ.")
    min_distance_min: float = Field(0.05, description="Closest two UV apexes may be.")
    max_peaks: int = Field(35, ge=1, le=200)


class AlignSettings(BaseModel):
    enabled: bool = True
    max_lag_min: float = Field(1.0, gt=0)
    manual_offset_min: Optional[float] = Field(None, description="Use this UV→MS offset instead of aligning.")


class BackgroundSettings(BaseModel):
    """Subtract what is in the MS just before and after a UV peak from the peak's summed spectrum."""

    # On by default: on the benchmark it never lost a label, and without it constant ions (a plasticiser
    # at m/z 391) won 2 of 3 peaks once cyclic forms were searched.
    enabled: bool = True
    # "eic": label from the raw spectrum, as a chemist reads it, and reject ions whose EIC stays high all
    # through the run. "flanks": subtract the spectra just before and after the peak; inside an isomer
    # cluster the flanks are the neighbouring isomers, which removes the real ion (G1, 12.64 min).
    method: Literal["eic", "flanks"] = "eic"
    gap_min: float = Field(0.05, ge=0, description="Space between the peak window and each background window.")
    width_min: float = Field(0.3, gt=0, description="Width of each background window, before and after the peak.")
    bin_da: float = Field(0.25, gt=0, le=2, description="Grid the subtraction works on (about half the tolerance).")
    scale: float = Field(1.0, ge=0, le=3, description="How much of the per-scan background to remove.")


class EndGroup(BaseModel):
    name: str = Field(min_length=1, max_length=24)
    mass: float = Field(description="Added to the linear chain's neutral mass (Da), e.g. +14.016 for a methyl ester.")


class FormSettings(BaseModel):
    """Which chain forms to look for. Linear: Σmonomers + (n−1)·bond; cyclic loses one more bond (water)."""

    linear: bool = True
    cyclic: bool = False
    end_groups: List[EndGroup] = Field(default_factory=list, max_length=4)

    def forms(self, bond_delta: float) -> List[Tuple[str, float]]:
        """(name, mass added to the linear chain); the linear form is named "linear"."""
        out: List[Tuple[str, float]] = [("linear", 0.0)] if self.linear else []
        if self.cyclic:
            out.append(("cyclic", bond_delta))
        out += [(g.name.strip(), g.mass) for g in self.end_groups]
        return out


class PipelineSettings(BaseModel):
    monomers: List[Monomer] = Field(min_length=1)
    polarity: Literal["positive", "negative"] = "positive"
    tolerance_da: float = Field(0.5, gt=0, le=5)
    adducts: List[str] = Field(default_factory=lambda: ["H", "Na", "Cl"])
    charges: List[int] = Field(default_factory=lambda: [1])
    max_dp: int = Field(12, ge=1, le=60)
    bond_delta: float = -18.010565
    forms: FormSettings = Field(default_factory=FormSettings)
    background: BackgroundSettings = Field(default_factory=BackgroundSettings)
    uv: UVPeakSettings = Field(default_factory=UVPeakSettings)
    align: AlignSettings = Field(default_factory=AlignSettings)
    rules: SanityRules = Field(default_factory=SanityRules)
    max_candidates_per_peak: int = Field(8, ge=1, le=30)
    adduct_fallback: bool = Field(
        True, description="Other adducts (Na, K, Cl, …) only for a peak with no [M+H]⁺/[M−H]⁻ match at all."
    )
    layout: LayoutOptions = Field(default_factory=LayoutOptions)

    @field_validator("charges")
    @classmethod
    def _charges(cls, value: List[int]) -> List[int]:
        clean = sorted({int(z) for z in value if 1 <= int(z) <= 4})
        if not clean:
            raise ValueError("Give at least one charge state between 1 and 4.")
        return clean

    @field_validator("forms")
    @classmethod
    def _some_form(cls, value: FormSettings) -> FormSettings:
        if not value.forms(-18.0):
            raise ValueError("Choose at least one chain form (linear, cyclic or an end group).")
        return value

    @field_validator("adducts")
    @classmethod
    def _known_adducts(cls, value: List[str]) -> List[str]:
        unknown = [a for a in value if a not in ADDUCTS]
        if unknown:
            raise ValueError(f"Unknown adduct(s) {unknown}; choose from {list(ADDUCTS)}.")
        return list(dict.fromkeys(["H", *value]))

    def enabled_adducts(self) -> set[str]:
        """Adducts that apply in this polarity (Na/K/NH4 positive only, Cl/HCOO/Ac negative only)."""
        skip = _NEGATIVE_ONLY if self.polarity == "positive" else _POSITIVE_ONLY
        return {a for a in self.adducts if a not in skip}


class Alignment(BaseModel):
    offset_min: float  # UV time + offset = MS time
    method: Literal["xcorr", "manual", "none"]
    score: Optional[float] = None
    step_min: Optional[float] = None


class UVPeak(BaseModel):
    id: str
    rt_min: float  # UV apex
    ms_rt_min: float  # apex + offset
    apex: float
    start_min: float  # half-height edges (the summing window, before the offset)
    end_min: float
    width_min: float
    area: float
    sn: float
    prominence: float
    prominence_rel: float
    rise_frac: float = 1.0  # prominence / height above the run's baseline: how distinct the peak is
    sharpness_rel: float = 1.0  # (prominence / FWHM) / the run's median: broad bumps are ≪ 1
    n_scans: int = 0
    base_peak_intensity: float = 0.0
    reasons: List[str] = Field(default_factory=list)
    label_ids: List[str] = Field(default_factory=list)


class Ion(BaseModel):
    text: str
    mz: float
    intensity: float
    rel_intensity: float
    abs_err_da: float
    adduct: str
    charge: int


Review = Literal["approved", "rejected", "pending"]


class PipelineLabel(BaseModel):
    id: str
    peak_id: str
    rank: int
    text: str  # what goes on the chart: species + representative ion
    species: str
    series: str
    dp: int
    counts: Dict[str, int]
    variant: str = ""
    form: str = "linear"
    adduct: str
    charge: int
    mz: float
    abs_err_da: float
    intensity: float
    rel_intensity: float
    score: float
    ions: List[Ion]
    eic_apex_rt_min: Optional[float] = None
    constant_ratio: Optional[float] = None  # run-wide median EIC / EIC height at the peak (artifact check)
    half_step_ratio: Optional[float] = None  # peak 0.5/z above the ion / the ion (2+ check)
    full_step_ratio: Optional[float] = None  # peak 1/z above the ion / the ion (first isotope)
    series_support: float = 0.0
    support_members: List[int] = Field(default_factory=list)
    status: LabelStatus = "ok"
    reasons: List[str] = Field(default_factory=list)
    review: Review = "pending"
    layout: Optional[LayoutItem] = None


class PipelineResult(BaseModel):
    session_id: str
    display_name: str
    uv_filename: Optional[str] = None
    polarity: str
    alignment: Alignment
    uv_noise: float
    uv_rt: List[float]
    uv_signal: List[float]
    peaks: List[UVPeak]
    labels: List[PipelineLabel]
    settings: PipelineSettings
    messages: List[str] = Field(default_factory=list)
    created_at: str


# ------------------------------------------------------------------ alignment and UV peaks


def _baseline_corrected(y: np.ndarray, window_pts: int) -> np.ndarray:
    """Subtract a smoothed moving minimum, so a drifting UV baseline doesn't dominate the correlation."""
    window_pts = max(3, int(window_pts) | 1)
    base = uniform_filter1d(minimum_filter1d(y, size=window_pts, mode="nearest"), size=window_pts, mode="nearest")
    return np.clip(y - base, 0.0, None)


def align_uv_to_ms(
    ms_rt: np.ndarray,
    ms_tic: np.ndarray,
    uv_rt: np.ndarray,
    uv_signal: np.ndarray,
    *,
    max_lag_min: float = 1.0,
) -> Alignment:
    """Offset that moves the UV trace onto MS time (UV time + offset = MS time).

    Port of the LCMS view's autoAlignNow: both traces resampled onto one uniform grid,
    baseline-subtracted and normalised, then cross-correlated over ±max_lag_min; the best lag is
    refined to sub-step precision with a parabola through the peak of the correlation.
    """
    ms_rt, ms_tic = np.asarray(ms_rt, float), np.asarray(ms_tic, float)
    uv_rt, uv_signal = np.asarray(uv_rt, float), np.asarray(uv_signal, float)
    if ms_rt.size < 10 or uv_rt.size < 10:
        return Alignment(offset_min=0.0, method="none")
    lo, hi = max(ms_rt.min(), uv_rt.min()), min(ms_rt.max(), uv_rt.max())
    if hi - lo < 4 * max_lag_min / 10:
        return Alignment(offset_min=0.0, method="none")
    step = max(0.002, float(min(np.median(np.diff(ms_rt)), np.median(np.diff(uv_rt)))))
    grid = np.arange(lo, hi, step)
    window = int(round(1.0 / step))  # ~1 min moving-minimum baseline
    ms = _baseline_corrected(np.interp(grid, ms_rt, ms_tic), window)
    uv = _baseline_corrected(np.interp(grid, uv_rt, uv_signal), window)
    ms = (ms - ms.mean()) / (ms.std() or 1.0)
    uv = (uv - uv.mean()) / (uv.std() or 1.0)
    corr = np.correlate(ms, uv, mode="full") / grid.size  # corr[k + n - 1] = Σ ms[j] · uv[j − k]
    lags = np.arange(-(grid.size - 1), grid.size)
    max_lag = max(1, int(round(max_lag_min / step)))
    keep = np.abs(lags) <= max_lag
    corr, lags = corr[keep], lags[keep]
    i = int(np.argmax(corr))
    shift = float(lags[i])
    if 0 < i < corr.size - 1:
        y0, y1, y2 = corr[i - 1], corr[i], corr[i + 1]
        denom = y0 - 2 * y1 + y2
        if denom < 0:
            shift += 0.5 * (y0 - y2) / denom
    return Alignment(offset_min=round(shift * step, 4), method="xcorr", score=round(float(corr[i]), 4), step_min=step)


def robust_noise(signal: np.ndarray) -> float:
    """σ of the noise from the median absolute first difference (insensitive to the peaks)."""
    d = np.diff(np.asarray(signal, float))
    d = d[np.isfinite(d)]
    if d.size == 0:
        return 0.0
    return float(1.4826 * np.median(np.abs(d - np.median(d))) / np.sqrt(2.0))


def pick_uv_peaks(
    rt_min: np.ndarray,
    signal: np.ndarray,
    *,
    detect_sn: float = 3.0,
    min_distance_min: float = 0.05,
    max_peaks: int = 35,
    offset_min: float = 0.0,
) -> Tuple[List[UVPeak], float]:
    """UV peaks with apex, half-height start/end, area and S/N (scipy find_peaks + peak_widths).

    Detection is deliberately permissive (prominence ≥ detect_sn · noise); the sanity rules then
    flag weak, narrow, broad or minor peaks instead of dropping them. Returns (peaks, noise σ).
    """
    rt = np.asarray(rt_min, float)
    y = np.asarray(signal, float)
    ok = np.isfinite(rt) & np.isfinite(y)
    rt, y = rt[ok], y[ok]
    if rt.size < 5:
        return [], 0.0
    order = np.argsort(rt)
    rt, y = rt[order], y[order]
    step = float(np.median(np.diff(rt))) or 1e-3
    noise = robust_noise(y) or 1e-12
    floor = float(np.percentile(y, 5))  # the run's baseline level
    idx, props = find_peaks(
        y,
        prominence=max(detect_sn * noise, 1e-12),
        width=1,
        distance=max(1, int(round(min_distance_min / step))),
    )
    if idx.size == 0:
        return [], noise
    proms = props["prominences"]
    if idx.size > max_peaks:
        keep = np.sort(np.argsort(proms)[::-1][:max_peaks])
        idx, proms = idx[keep], proms[keep]
    half = peak_widths(y, idx, rel_height=0.5, prominence_data=peak_prominences(y, idx))
    _, _, lb, rb = peak_widths(y, idx, rel_height=0.98)
    max_prom = float(proms.max()) if proms.size else 1.0
    t_at = lambda p: float(np.interp(p, np.arange(rt.size), rt))  # noqa: E731 - fractional index → minutes
    peaks: List[UVPeak] = []
    for n, (i, prom, l_h, r_h, l_b, r_b) in enumerate(zip(idx, proms, half[2], half[3], lb, rb), start=1):
        start, end = t_at(l_h), t_at(r_h)
        width = end - start
        # Area between the peak's bases (at most 3 half-widths out), above a straight baseline.
        a0 = max(t_at(l_b), start - 3 * width)
        a1 = min(t_at(r_b), end + 3 * width)
        sel = (rt >= a0) & (rt <= a1)
        area = 0.0
        if sel.sum() >= 2:
            xs, ys = rt[sel], y[sel]
            base = np.interp(xs, [xs[0], xs[-1]], [ys[0], ys[-1]])
            area = float(np.trapezoid(np.clip(ys - base, 0, None), xs))
        peaks.append(
            UVPeak(
                id=f"P{n}",
                rt_min=float(rt[i]),
                ms_rt_min=float(rt[i]) + offset_min,
                apex=float(y[i]),
                start_min=start,
                end_min=end,
                width_min=width,
                area=area,
                sn=float(prom / noise),
                prominence=float(prom),
                prominence_rel=float(prom / max_prom) if max_prom > 0 else 0.0,
                rise_frac=float(min(1.0, prom / max(float(y[i]) - floor, 1e-12))),
            )
        )
    sharp = np.array([p.prominence / max(p.width_min, step) for p in peaks])
    typical = float(np.median(sharp)) if sharp.size else 1.0
    for p, s in zip(peaks, sharp):
        p.sharpness_rel = float(s / typical) if typical > 0 else 1.0
    return peaks, noise


# ------------------------------------------------------------------ candidates from matches

_SUPERSCRIPTS = str.maketrans("⁰¹²³⁴⁵⁶⁷⁸⁹", "0123456789")
_LABEL_RE = re.compile(
    r"^(?P<comp>.+?)(?:\s+(?P<variant>[+\-−][^\s\[]+))?\s+\[(?P<core>2?M)(?P<adduct>[^\]]*)\](?P<charge>[⁰¹²³⁴⁵⁶⁷⁸⁹]*)[⁺⁻]$"
)


def parse_label(text: str) -> Optional[Dict[str, object]]:
    """Split a polymer_match label, e.g. "2-GA + 1-LA -H2O [M+Na]⁺", into its parts."""
    m = _LABEL_RE.match(text.strip())
    if not m:
        return None
    counts: Dict[str, int] = {}
    for part in m["comp"].split(" + "):
        num, _, name = part.strip().partition("-")
        if not num.isdigit() or not name:
            return None
        counts[name] = counts.get(name, 0) + int(num)
    adduct_txt = m["adduct"].replace("−", "-")
    adduct = re.sub(r"^[+\-]\d*", "", adduct_txt) or "H"
    if re.fullmatch(r"\d*\.\d+", adduct):
        adduct = "custom"
    core = m["core"]
    species = m["comp"].strip() + (f" {m['variant']}" if m["variant"] else "") + (" (2M)" if core == "2M" else "")
    return {
        "counts": counts,
        "dp": sum(counts.values()),
        "series": "+".join(sorted(counts)),
        "variant": m["variant"] or "",
        "species": species,
        "adduct": adduct,
        "charge": int((m["charge"] or "1").translate(_SUPERSCRIPTS)),
    }


def tag_form(parsed: Dict[str, object], text: str, form: str) -> Tuple[Dict[str, object], str]:
    """Name a non-linear form in the species, series and label: "3-GA (cyclic) [M+H]⁺"."""
    if form == "linear":
        return parsed, text
    tagged = dict(parsed, species=f"{parsed['species']} ({form})", series=f"{parsed['series']} ({form})", form=form)
    return tagged, f"{tagged['species']} {text[text.index('['):]}"


def polymer_settings(settings: PipelineSettings, min_rel_int: float, extra_delta: float = 0.0) -> Dict[str, object]:
    """The LCMS view's polymer settings dict for this pipeline's monomers, tolerance and adducts."""
    enabled = settings.enabled_adducts()
    custom = [{"name": "NH4", "mass": NH4, "charge": 1}] if "NH4" in enabled else []
    return {
        "enabled": True,
        "monomers_text": "\n".join(f"{m.name} {m.mass}" for m in settings.monomers),
        "charges": ",".join(str(z) for z in settings.charges),
        "max_dp": settings.max_dp,
        "bond_delta": settings.bond_delta,
        "extra_delta": extra_delta,
        "adduct_mass": PROTON,
        "cluster": False,
        "tol_value": settings.tolerance_da,
        "tol_unit": "Da",
        "min_rel_int": min_rel_int,
        "adduct_na": "Na" in enabled,
        "adduct_k": "K" in enabled,
        "adduct_cl": "Cl" in enabled,
        "adduct_formate": "HCOO" in enabled,
        "adduct_acetate": "Ac" in enabled,
        "custom_adducts": custom,
    }


def rank_candidates(
    matches: List[Dict[str, object]], base_peak: float, tolerance_da: float, adduct_fallback: bool = False
) -> List[Dict[str, object]]:
    """Group matched ions by species and rank: summed relative intensity, less a mass-error penalty.

    With adduct_fallback, species seen only as other adducts are dropped when any species has a
    protonated (deprotonated) ion in this window.
    """
    groups: Dict[str, Dict[str, object]] = {}
    for match in matches:
        parsed = parse_label(str(match["text"]))
        if parsed is None:
            continue
        parsed, ion_text = tag_form(parsed, str(match["text"]), str(match.get("form") or "linear"))
        rel = float(match["intensity"]) / base_peak if base_peak > 0 else 0.0
        ion = Ion(
            text=ion_text,
            mz=float(match["mz"]),
            intensity=float(match["intensity"]),
            rel_intensity=rel,
            abs_err_da=float(match["abs_err"]),
            adduct=str(parsed["adduct"]),
            charge=int(parsed["charge"]),
        )
        group = groups.setdefault(str(parsed["species"]), {**parsed, "ions": []})
        group["ions"].append(ion)  # type: ignore[union-attr]
    ranked = []
    for group in groups.values():
        ions: List[Ion] = sorted(group["ions"], key=lambda i: -i.intensity)  # type: ignore[arg-type]
        rel_sum = sum(i.rel_intensity for i in ions)
        err = sum(i.abs_err_da * i.intensity for i in ions) / max(1e-12, sum(i.intensity for i in ions))
        score = rel_sum * (1.0 - 0.5 * min(1.0, err / tolerance_da))
        protonated = [i for i in ions if i.adduct == "H"]
        ranked.append({**group, "ions": ions, "score": score, "rep": (protonated or ions)[0]})
    if adduct_fallback and any(g["rep"].adduct == "H" for g in ranked):  # type: ignore[union-attr]
        ranked = [g for g in ranked if g["rep"].adduct == "H"]  # type: ignore[union-attr]
    ranked.sort(key=lambda g: (-float(g["score"]), str(g["species"])))
    return ranked


class WindowSpectrum(BaseModel):
    """The summed MS spectrum behind one UV peak, as matched (after background subtraction if on)."""

    rt_start: float
    rt_end: float
    n_scans: int
    mz: List[float]
    intensity: List[float]
    background_scans: int = 0
    background_removed: float = 0.0  # fraction of the window's total intensity taken out


def _per_scan(spec: Dict[str, object]) -> Tuple[np.ndarray, np.ndarray, int]:
    return np.asarray(spec["mz"], float), np.asarray(spec["intensity"], float), int(spec["n_scans"])  # type: ignore[arg-type]


def peak_window_spectrum(state: LCMSSessionState, peak: UVPeak, settings: PipelineSettings, offset: float, scan_step: float) -> WindowSpectrum:
    """Sum the MS scans under a UV peak (half-height edges + offset, at least one scan).

    With background subtraction on, the average spectrum of the scans just before and after the
    peak is scaled to the peak's scan count and removed on a coarse m/z grid; each stick keeps its
    own m/z, scaled down by what its grid cell lost, so ions present all through the run (solvent
    clusters, plasticisers, the single-quad noise floor) stop matching compositions.
    """
    lo, hi = peak.start_min + offset, peak.end_min + offset
    if hi - lo < scan_step:
        mid = (lo + hi) / 2
        lo, hi = mid - scan_step / 2, mid + scan_step / 2
    pol = settings.polarity
    mz, inten, n = _per_scan(summed_spectrum_in_rt_range(state, rt_min=lo, rt_max=hi, polarity=pol, bin_width=0.01))
    out = WindowSpectrum(rt_start=lo, rt_end=hi, n_scans=n, mz=mz.tolist(), intensity=inten.tolist())
    bg = settings.background
    if not bg.enabled or bg.method != "flanks" or mz.size == 0 or n == 0:
        return out
    sides = [
        (lo - bg.gap_min - bg.width_min, lo - bg.gap_min),
        (hi + bg.gap_min, hi + bg.gap_min + bg.width_min),
    ]
    bg_mz: List[np.ndarray] = []
    bg_int: List[np.ndarray] = []
    bg_scans = 0
    for a, b in sides:
        smz, sint, sn = _per_scan(summed_spectrum_in_rt_range(state, rt_min=a, rt_max=b, polarity=pol, bin_width=0.01))
        if sn:
            bg_mz.append(smz)
            bg_int.append(sint)
            bg_scans += sn
    if bg_scans == 0:
        return out
    cell = np.rint(mz / bg.bin_da).astype(np.int64)
    bg_cell = np.rint(np.concatenate(bg_mz) / bg.bin_da).astype(np.int64)
    keys, inverse = np.unique(cell, return_inverse=True)
    peak_sum = np.bincount(inverse, weights=inten)
    pos = np.searchsorted(keys, bg_cell)
    hit = (pos < keys.size) & (keys[np.minimum(pos, keys.size - 1)] == bg_cell)
    bg_sum = np.bincount(pos[hit], weights=np.concatenate(bg_int)[hit], minlength=keys.size)
    expected_bg = bg.scale * bg_sum / bg_scans * n  # background in the peak window
    keep = np.clip(1.0 - expected_bg / np.where(peak_sum > 0, peak_sum, 1.0), 0.0, 1.0)
    new_int = inten * keep[inverse]
    out.intensity = new_int.tolist()
    out.background_scans = bg_scans
    total = float(inten.sum())
    out.background_removed = float(1.0 - new_int.sum() / total) if total > 0 else 0.0
    return out


def match_window(spec: WindowSpectrum, settings: PipelineSettings) -> Tuple[List[Dict[str, object]], float]:
    """Polymer matches in a window spectrum for every chosen chain form; returns (ranked, base peak)."""
    mz, inten = np.asarray(spec.mz, float), np.asarray(spec.intensity, float)
    base = float(inten.max()) if inten.size else 0.0
    detect_rel = settings.rules.min_rel_intensity / 2  # ions below the rule still show up, flagged
    matches: List[Dict[str, object]] = []
    for form, extra in settings.forms.forms(settings.bond_delta):
        poly = polymer_settings(settings, detect_rel, extra)
        for m in polymer_match_labels(mz, inten, polarity=settings.polarity, settings=poly):
            matches.append({**m, "form": form})
    ranked = rank_candidates(matches, base, settings.tolerance_da, settings.adduct_fallback)
    return ranked[: settings.max_candidates_per_peak], base


ISOTOPE_STEP = 1.003355  # 13C − 12C


def isotope_ratios(mz: List[float], intensity: List[float], ion_mz: float, charge: int, tol: float = 0.15) -> Tuple[float, float]:
    """(tallest peak half an isotope step above the ion, tallest a whole step above), each relative to the ion."""
    m, i = np.asarray(mz, float), np.asarray(intensity, float)

    def near(x: float) -> float:
        sel = np.abs(m - x) <= tol
        return float(i[sel].max()) if sel.any() else 0.0

    ion = near(ion_mz)
    if ion <= 0:
        return 0.0, 0.0
    step = ISOTOPE_STEP / max(1, charge)
    return round(near(ion_mz + step / 2) / ion, 4), round(near(ion_mz + step) / ion, 4)


def eic_apex_near(rt: np.ndarray, inten: np.ndarray, center: float, half_window: float) -> Optional[float]:
    """The EIC maximum nearest `center` within ±half_window: the nearest local maximum (3-point smoothed,
    prominence ≥ 5% of the window's height), not the tallest point, so each isomer peak sharing the m/z
    finds its own."""
    sel = np.abs(rt - center) <= half_window
    if not sel.any():
        return None
    t, y = rt[sel], uniform_filter1d(np.asarray(inten, float)[sel], size=3, mode="nearest")
    top = float(y.max())
    if top <= 0:
        return None
    idx, _ = find_peaks(y, prominence=0.05 * top)
    if idx.size == 0:
        return float(t[int(np.argmax(y))])
    return float(t[idx[int(np.argmin(np.abs(t[idx] - center)))]])


def _eic_facts(
    state: LCMSSessionState, mz: float, tol: float, polarity: str, center: float, half_window: float
) -> Tuple[Optional[float], Optional[float]]:
    """(EIC apex near the peak, run-wide median EIC / EIC height near the peak)."""
    eic = extracted_ion_chromatogram(state, mz, tolerance=tol, tolerance_unit="da", polarity=polarity)
    rt = np.asarray(eic["rt_min"], float)
    inten = np.asarray(eic["intensity"], float)
    sel = np.abs(rt - center) <= half_window
    if not sel.any() or float(inten[sel].max()) <= 0:
        return None, None
    height = float(inten[sel].max())
    return eic_apex_near(rt, inten, center, half_window), float(np.median(inten)) / height


# ------------------------------------------------------------------ pipeline


def _ms_trace(state: LCMSSessionState, polarity: str) -> Tuple[np.ndarray, np.ndarray]:
    metas = [m for m in state.index.ms1 if m.polarity == polarity] or list(state.index.ms1)
    return np.array([m.rt_min for m in metas], float), np.array([m.tic for m in metas], float)


def run_pipeline(
    state: LCMSSessionState,
    settings: PipelineSettings,
    progress: Optional[ProgressCallback] = None,
) -> PipelineResult:
    """Align, pick UV peaks, label each from its summed spectrum, check, rank and lay out."""
    say = progress or (lambda _f, _s: None)
    messages: List[str] = []
    if state.uv is None:
        raise ValueError("This run has no UV chromatogram attached.")
    if not any(m.polarity == settings.polarity for m in state.index.ms1):
        raise ValueError(f"This run has no {settings.polarity}-polarity MS1 scans.")
    skipped = sorted(set(settings.adducts) - settings.enabled_adducts())
    if skipped:
        messages.append(f"Adduct(s) {', '.join(skipped)} don't apply in {settings.polarity} mode and were left out.")
    uv_rt, uv_y = np.asarray(state.uv.rt_min, float), np.asarray(state.uv.signal, float)
    ms_rt, ms_tic = _ms_trace(state, settings.polarity)

    say(0.05, "Aligning UV to MS")
    if settings.align.manual_offset_min is not None:
        alignment = Alignment(offset_min=settings.align.manual_offset_min, method="manual")
    elif settings.align.enabled:
        alignment = align_uv_to_ms(ms_rt, ms_tic, uv_rt, uv_y, max_lag_min=settings.align.max_lag_min)
    else:
        alignment = Alignment(offset_min=0.0, method="none")
    offset = alignment.offset_min
    messages.append(f"UV→MS offset {offset:+.3f} min ({alignment.method}).")

    say(0.12, "Finding UV peaks")
    peaks, noise = pick_uv_peaks(
        uv_rt, uv_y,
        detect_sn=settings.uv.detect_sn,
        min_distance_min=settings.uv.min_distance_min,
        max_peaks=settings.uv.max_peaks,
        offset_min=offset,
    )
    messages.append(f"{len(peaks)} UV peak(s) found.")
    scan_step = float(np.median(np.diff(ms_rt))) if ms_rt.size > 1 else 0.05
    tol = settings.tolerance_da
    removed: List[float] = []

    labels: List[PipelineLabel] = []
    for n, peak in enumerate(peaks, start=1):
        say(0.15 + 0.65 * (n - 1) / max(1, len(peaks)), f"Labelling UV peak {n} of {len(peaks)}")
        spec = peak_window_spectrum(state, peak, settings, offset, scan_step)
        peak.n_scans = spec.n_scans
        if spec.background_scans:
            removed.append(spec.background_removed)
        ranked, peak.base_peak_intensity = match_window(spec, settings)
        for rank, cand in enumerate(ranked, start=1):
            rep: Ion = cand["rep"]  # type: ignore[assignment]
            apex_rt, constant = _eic_facts(
                state, rep.mz, tol, settings.polarity, peak.ms_rt_min, max(0.5, 3 * peak.width_min)
            )
            half, full = isotope_ratios(spec.mz, spec.intensity, rep.mz, rep.charge)
            label = PipelineLabel(
                id=f"{peak.id}-{rank}",
                peak_id=peak.id,
                rank=rank,
                text=rep.text,
                species=str(cand["species"]),
                series=str(cand["series"]),
                dp=int(cand["dp"]),  # type: ignore[arg-type]
                counts=dict(cand["counts"]),  # type: ignore[arg-type]
                variant=str(cand["variant"]),
                form=str(cand.get("form") or "linear"),
                adduct=rep.adduct,
                charge=rep.charge,
                mz=rep.mz,
                abs_err_da=rep.abs_err_da,
                intensity=rep.intensity,
                rel_intensity=rep.rel_intensity,
                score=float(cand["score"]),  # type: ignore[arg-type]
                ions=list(cand["ions"]),  # type: ignore[arg-type]
                eic_apex_rt_min=apex_rt,
                half_step_ratio=half,
                full_step_ratio=full,
                constant_ratio=constant if settings.background.enabled and settings.background.method == "eic" else None,
            )
            labels.append(label)
            peak.label_ids.append(label.id)

    if removed:
        messages.append(f"Background subtraction removed {100 * float(np.median(removed)):.0f}% of the signal in a typical peak window.")
    say(0.85, "Checking labels")
    check_labels(peaks, labels, settings)
    tried: Dict[str, set] = {}
    for _ in range(4):  # a promoted candidate can itself turn out implausible once it is the top label
        if not promote_plausible(peaks, labels, tried):
            break
        check_labels(peaks, labels, settings)
    for label in labels:
        label.review = "approved" if label.rank == 1 and label.status == "ok" else "pending"

    say(0.92, "Laying out labels")
    result = PipelineResult(
        session_id=state.session_id,
        display_name=state.display_name,
        uv_filename=state.uv.filename,
        polarity=settings.polarity,
        alignment=alignment,
        uv_noise=noise,
        uv_rt=[float(v) for v in uv_rt],
        uv_signal=[float(v) for v in uv_y],
        peaks=peaks,
        labels=labels,
        settings=settings,
        messages=messages,
        created_at=datetime.now(timezone.utc).isoformat(),
    )
    apply_layout(result)
    say(1.0, "Done")
    return result


def peak_spectrum(state: LCMSSessionState, result: PipelineResult, peak_id: str) -> Dict[str, object]:
    """The spectrum a UV peak was labelled from (same window, offset and background), shaped like the
    LCMS view's SpectrumData, with the ions of its kept and approved candidates as labels."""
    peak = next((p for p in result.peaks if p.id == peak_id), None)
    if peak is None:
        raise KeyError(peak_id)
    ms_rt, _ = _ms_trace(state, result.settings.polarity)
    scan_step = float(np.median(np.diff(ms_rt))) if ms_rt.size > 1 else 0.05
    spec = peak_window_spectrum(state, peak, result.settings, result.alignment.offset_min, scan_step)
    top_k = result.settings.rules.top_k
    labels = [
        {
            "mz": ion.mz,
            "intensity": ion.intensity,
            "text": ion.text,
            "kind": lab.status,
            "abs_err": ion.abs_err_da,
            "source": "polymer",
        }
        for lab in result.labels
        if lab.peak_id == peak_id and (lab.rank <= top_k or lab.review == "approved")
        for ion in lab.ions
    ]
    return {
        "meta": {
            "spectrum_id": f"pipeline:{peak_id}",
            "rt_min": peak.ms_rt_min,
            "rt_start": spec.rt_start,
            "rt_end": spec.rt_end,
            "rt_max": spec.rt_end,
            "tic": float(sum(spec.intensity)),
            "polarity": result.settings.polarity,
            "n_peaks": len(spec.mz),
            "n_scans": spec.n_scans,
            "bin_width": 0.01,
            "merge_mode": "pipeline (background removed)" if spec.background_scans else "pipeline",
        },
        "mz": spec.mz,
        "intensity": spec.intensity,
        "labels": labels,
        "polymer_labels": labels,
        "background_removed": spec.background_removed,
    }


def promote_plausible(peaks: List[UVPeak], labels: List[PipelineLabel], tried: Dict[str, set]) -> bool:
    """Where a peak's top candidate is implausible (artifact, unlikely chemistry, no series neighbours),
    make its best plausible candidate the top one, as a chemist does by hand. Returns whether any changed.
    `tried` remembers the labels already found implausible as top, so nothing is promoted twice."""
    by_peak: Dict[str, List[PipelineLabel]] = {}
    for lab in labels:
        by_peak.setdefault(lab.peak_id, []).append(lab)
    implausible = lambda lab: any(r.startswith(IMPLAUSIBLE) for r in lab.reasons)  # noqa: E731
    changed = False
    for peak in peaks:
        cands = sorted(by_peak.get(peak.id, []), key=lambda lab: lab.rank)
        if not cands or not implausible(cands[0]):
            continue
        done = tried.setdefault(peak.id, set())
        done.add(cands[0].id)
        best = next((lab for lab in cands[1:] if lab.id not in done and not implausible(lab)), None)
        if best is None:
            continue
        order = [best] + [lab for lab in cands if lab is not best]
        for rank, lab in enumerate(order, start=1):
            lab.rank = rank
        peak.label_ids = [lab.id for lab in order]
        changed = True
    return changed


def check_labels(peaks: List[UVPeak], labels: List[PipelineLabel], settings: PipelineSettings) -> None:
    """Run the sanity rules and store each label's status, reasons and series support."""
    peak_by_id = {p.id: p for p in peaks}
    protonated_species = {
        (lab.peak_id, lab.species) for lab in labels for ion in lab.ions if ion.adduct == "H"
    }
    kinds = {m.name: m.resolved_kind() for m in settings.monomers}
    hydroxy_names = [name for name, kind in kinds.items() if kind == "hydroxy_acid"]
    facts = [
        LabelFacts(
            id=lab.id,
            peak_id=lab.peak_id,
            rank=lab.rank,
            species=lab.species,
            series=lab.series,
            dp=lab.dp,
            monomers=list(lab.counts),
            adduct=lab.adduct,
            has_protonated_form=(lab.peak_id, lab.species) in protonated_species,
            rel_intensity=lab.rel_intensity,
            abs_err_da=lab.abs_err_da,
            ms_rt_min=peak_by_id[lab.peak_id].ms_rt_min,
            eic_apex_rt_min=lab.eic_apex_rt_min,
            uv_apex=peak_by_id[lab.peak_id].apex,
            counts=dict(lab.counts),
            hydroxy_names=hydroxy_names,
            amino_acids=sum(n for m, n in lab.counts.items() if kinds.get(m) == "amino_acid"),
            hydroxy_acids=sum(n for m, n in lab.counts.items() if kinds.get(m) == "hydroxy_acid"),
            constant_ratio=lab.constant_ratio,
            charge=lab.charge,
            half_step_ratio=lab.half_step_ratio,
            full_step_ratio=lab.full_step_ratio,
        )
        for lab in labels
    ]
    peak_facts = [
        PeakFacts(id=p.id, rt_min=p.rt_min, sn=p.sn, width_min=p.width_min, prominence_rel=p.prominence_rel, rise_frac=p.rise_frac,
                  sharpness_rel=p.sharpness_rel)
        for p in peaks
    ]
    for p, pf in zip(peaks, peak_facts):
        p.reasons = check_peak(pf, settings.rules)
    verdicts = apply_rules(
        peak_facts,
        facts,
        settings.rules,
        run_monomers=[m.name for m in settings.monomers],
        enabled_adducts=settings.enabled_adducts(),
    )
    for lab in labels:
        v = verdicts[lab.id]
        lab.status, lab.reasons = v.status, v.reasons
        lab.series_support, lab.support_members = v.series_support, v.support_members


# ------------------------------------------------------------------ layout shared by chart and figure


class PlotFrame(BaseModel):
    """Data → pixel mapping of the UV plot area that the layout, the figure and the app share."""

    x_min: float
    x_max: float
    y_min: float
    y_max: float
    width_px: float
    height_px: float

    def x_px(self, x: float) -> float:
        return (x - self.x_min) / (self.x_max - self.x_min) * self.width_px

    def y_px(self, y: float) -> float:
        return (self.y_max - y) / (self.y_max - self.y_min) * self.height_px

    def x_data(self, px: float) -> float:
        return self.x_min + px / self.width_px * (self.x_max - self.x_min)

    def y_data(self, px: float) -> float:
        return self.y_max - px / self.height_px * (self.y_max - self.y_min)


def _x_range(result: PipelineResult, rt: np.ndarray) -> tuple[float, float]:
    """From the start of the run to just after the last labelled peak (or, with none approved, any peak)."""
    peak_by_id = {p.id: p for p in result.peaks}
    focus = [peak_by_id[lab.peak_id] for lab in displayed_labels(result)] or result.peaks
    if not focus:
        return float(rt.min()), float(rt.max())
    end = max(p.end_min for p in focus)
    pad = max(0.5, 0.05 * (end - float(rt.min())))
    return float(rt.min()), min(float(rt.max()), end + pad)


def plot_frame(result: PipelineResult) -> PlotFrame:
    """Data → pixel frame, ending after the last labelled peak; room above the trace for the labels."""
    rt = np.asarray(result.uv_rt, float)
    x_min, x_max = _x_range(result, rt)
    inside = (rt >= x_min) & (rt <= x_max)
    y = np.asarray(result.uv_signal, float)[inside if inside.any() else slice(None)]
    lo, hi = float(np.nanmin(y)), float(np.nanmax(y))
    span = hi - lo or 1.0
    opts = result.settings.layout
    if opts.orientation == "vertical":
        shown = displayed_labels(result)
        band = max((text_size(lab.text, opts.font_px, vertical=True)[1] for lab in shown), default=0.0) + 3 * opts.gap_px
        frac = min(0.6, band / opts.plot_height_px)  # share of the plot height the labels use
        headroom = frac / (1.0 - frac)
    else:
        headroom = 0.45  # room for the label stairs
    return PlotFrame(
        x_min=x_min, x_max=x_max,
        y_min=lo - 0.03 * span, y_max=hi + headroom * span,
        width_px=opts.plot_width_px, height_px=opts.plot_height_px,
    )


def displayed_labels(result: PipelineResult) -> List[PipelineLabel]:
    """Labels drawn on the chart and figure: the approved ones."""
    return [lab for lab in result.labels if lab.review == "approved"]


def apply_layout(result: PipelineResult) -> None:
    """(Re)compute layout offsets for the displayed labels; others carry none."""
    frame = plot_frame(result)
    peak_by_id = {p.id: p for p in result.peaks}
    shown = displayed_labels(result)
    xs = [frame.x_px(v) for v in result.uv_rt]
    ys = [frame.y_px(v) for v in result.uv_signal]
    items = [
        LayoutInput(id=lab.id, x_px=frame.x_px(peak_by_id[lab.peak_id].rt_min), y_px=frame.y_px(peak_by_id[lab.peak_id].apex), text=lab.text)
        for lab in shown
    ]
    placed = {item.id: item for item in layout_labels(items, result.settings.layout, trace_top(xs, ys))}
    for item in placed.values():
        item.x_data = round(frame.x_data((item.box.x0 + item.box.x1) / 2), 4)
        item.y_data = frame.y_data((item.box.y0 + item.box.y1) / 2)
    for lab in result.labels:
        lab.layout = placed.get(lab.id)

