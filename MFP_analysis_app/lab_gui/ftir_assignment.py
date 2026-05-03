"""FTIR peak assignment (library-based suggestions).

Pure functions only:
- no Tkinter
- no file I/O
- deterministic scoring

The matcher scores each peak against a correlation-library band while using
the whole peak set as context. The output keeps the original candidate shape
(`id`, `label`, `score`, `reasons`) and adds richer metadata for the web UI.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Sequence, Tuple

import math


def assign_ftir_peaks(
    peaks: Sequence[Dict[str, Any]],
    library: Sequence[Dict[str, Any]],
    spectrum_context: Optional[Dict[str, Any]] = None,
    *,
    top_n: int = 3,
    min_score: float = 35.0,
    excluded_categories: Optional[Sequence[str]] = None,
    excluded_subcategories: Optional[Sequence[str]] = None,
    ambiguity_ratio: float = 1.3,
) -> List[Dict[str, Any]]:
    """Assign FTIR peak candidates from a correlation library.

    Args:
        peaks: peak dicts with at least {"wn": float}. Optional keys are
            height, width, prominence, and sharpness.
        library: v2 or v3 FTIR correlation entries.
        spectrum_context: reserved for future callers.
        top_n: number of candidates to return per peak.
        min_score: minimum score to include; if no candidate reaches it, the
            best low-confidence candidate is still returned.
        excluded_categories: primary categories to rule out, e.g. "amide".
        excluded_subcategories: finer labels to rule out, e.g. "primary amide".
        ambiguity_ratio: top score must be at least this multiple of the
            runner-up score to be marked "auto"; otherwise it is "ambiguous".

    Returns:
        List of assignments, one per input peak. Existing fields remain
        backward compatible; richer fields include category, status, and
        auto_band_id.
    """

    _ = spectrum_context
    peaks_norm = [_normalize_peak(p) for p in (peaks or [])]
    blocked_categories = _normalize_blocklist(excluded_categories)
    blocked_subcategories = _normalize_blocklist(excluded_subcategories)
    library_norm = [
        entry
        for entry in (_normalize_entry(e) for e in (library or []))
        if entry["id"]
        and _norm_key(entry.get("category")) not in blocked_categories
        and _norm_key(entry.get("subcategory")) not in blocked_subcategories
    ]

    heights = [p["height"] for p in peaks_norm if _finite(p["height"]) is True]
    proms = [p["prominence"] for p in peaks_norm if _finite(p["prominence"]) is True]
    max_height = max(heights) if heights else None
    max_prom = max(proms) if proms else None
    wn_all = [p["wn"] for p in peaks_norm]

    out: List[Dict[str, Any]] = []
    for i, p in enumerate(peaks_norm):
        wn = float(p["wn"])
        peak_shape = _infer_peak_shape(width=p.get("width"), sharpness=p.get("sharpness"))
        peak_intensity = _infer_peak_intensity(p, max_height=max_height, max_prom=max_prom)

        scored: List[Dict[str, Any]] = []
        for entry in library_norm:
            score, reasons = _score_entry(
                wn=wn,
                entry=entry,
                peak_shape=peak_shape,
                peak_intensity=peak_intensity,
                other_wns=wn_all,
                self_index=i,
            )
            if score <= 0:
                continue
            scored.append(
                {
                    "id": entry["id"],
                    "band_id": entry["id"],
                    "label": entry["label"],
                    "score": float(score),
                    "reasons": reasons,
                    "group": entry.get("group") or "",
                    "category": entry.get("category") or "",
                    "subcategory": entry.get("subcategory") or "",
                }
            )

        scored_sorted = sorted(scored, key=lambda c: float(c.get("score", 0.0)), reverse=True)
        keep = [c for c in scored_sorted if float(c.get("score", 0.0)) >= float(min_score)]
        keep = keep[: max(1, int(top_n or 0) or 1)]

        if not keep and scored_sorted:
            keep = scored_sorted[:1]
            keep[0]["reasons"] = list(keep[0].get("reasons") or []) + ["low confidence"]

        for c in keep:
            c["score"] = float(_clamp(float(c.get("score", 0.0)), 0.0, 100.0))

        top = keep[0] if keep else None
        runner_up = keep[1] if len(keep) > 1 else None
        ratio = _candidate_ratio(top, runner_up)
        status = "none"
        auto_band_id: Optional[str] = None
        if top:
            status = "auto" if ratio >= max(1.0, float(ambiguity_ratio or 1.0)) else "ambiguous"
            auto_band_id = str(top.get("band_id") or top.get("id") or "")
            if status == "ambiguous":
                top["reasons"] = list(top.get("reasons") or []) + ["close alternate candidate"]

        out.append(
            {
                "wn": wn,
                "peak_metrics": {
                    "wn": wn,
                    "height": p.get("height"),
                    "width": p.get("width"),
                    "prominence": p.get("prominence"),
                    "sharpness": p.get("sharpness"),
                    "shape": peak_shape,
                    "intensity": peak_intensity,
                },
                "status": status,
                "auto_band_id": auto_band_id,
                "ambiguity_ratio": ratio,
                "candidates": keep,
            }
        )

    return out


# ------------------------- normalization helpers -------------------------


def _normalize_peak(p: Dict[str, Any]) -> Dict[str, Any]:
    d = dict(p or {})
    wn_raw = _to_float(d.get("wn"), default=float("nan"))
    wn = float(wn_raw) if wn_raw is not None else float("nan")
    if not _finite(wn):
        raise ValueError("Each peak must have a finite 'wn' (cm^-1)")

    height = _to_float(d.get("height"), default=None)
    width = _to_float(d.get("width"), default=None)
    prominence = _to_float(d.get("prominence"), default=None)
    sharpness = _to_float(d.get("sharpness"), default=None)
    if width is not None and float(width) <= 0:
        width = None

    return {
        "wn": float(wn),
        "height": (None if height is None else float(height)),
        "width": (None if width is None else float(width)),
        "prominence": (None if prominence is None else float(prominence)),
        "sharpness": (None if sharpness is None else float(sharpness)),
    }


def _normalize_entry(e: Dict[str, Any]) -> Dict[str, Any]:
    d = dict(e or {})
    primary = dict(d.get("primary") or {})
    range_cm1 = d.get("range_cm1") or primary.get("range_cm1") or (None, None)
    lo_v, hi_v = _normalize_range(range_cm1, entry_id=d.get("id"))

    label = str(primary.get("label") or d.get("label") or "").strip()
    shapes_raw = primary.get("shape") or d.get("typical_shape") or []
    intensities_raw = primary.get("intensity") or d.get("typical_intensity") or []
    shapes = _listify(shapes_raw, lowercase=True)
    intensities = _listify(intensities_raw, lowercase=True)

    ctx = dict(d.get("context_hints") or {})
    confirm = list(d.get("confirm_if_present") or ctx.get("positive") or [])
    exclude = list(d.get("exclude_if_present") or ctx.get("negative") or [])

    return {
        "id": str(d.get("id") or "").strip(),
        "range_cm1": (lo_v, hi_v),
        "label": label,
        "group": str(primary.get("group") or d.get("group") or "").strip(),
        "category": str(primary.get("category") or d.get("category") or "").strip(),
        "subcategory": str(primary.get("subcategory") or d.get("subcategory") or "").strip(),
        "typical_shape": shapes,
        "typical_intensity": intensities,
        "notes": str(d.get("notes") or "").strip(),
        "confirm_if_present": confirm,
        "exclude_if_present": exclude,
    }


def _normalize_range(value: Any, *, entry_id: Any) -> Tuple[float, float]:
    lo, hi = (None, None)
    if isinstance(value, (list, tuple)) and len(value) >= 2:
        lo, hi = value[0], value[1]
    lo_raw = _to_float(lo, default=float("nan"))
    hi_raw = _to_float(hi, default=float("nan"))
    lo_f = float(lo_raw) if lo_raw is not None else float("nan")
    hi_f = float(hi_raw) if hi_raw is not None else float("nan")
    if not (_finite(lo_f) and _finite(hi_f)):
        raise ValueError(f"Invalid range_cm1 in entry {entry_id}")
    if lo_f > hi_f:
        lo_f, hi_f = hi_f, lo_f
    return float(lo_f), float(hi_f)


def _listify(value: Any, *, lowercase: bool = False) -> List[str]:
    if value is None:
        values: List[Any] = []
    elif isinstance(value, str):
        values = [value]
    elif isinstance(value, Sequence):
        values = list(value)
    else:
        values = [value]
    out = [str(item).strip() for item in values if str(item).strip()]
    return [item.lower() for item in out] if lowercase else out


def _normalize_blocklist(values: Optional[Sequence[str]]) -> set[str]:
    return {_norm_key(v) for v in (values or []) if _norm_key(v)}


def _norm_key(value: Any) -> str:
    return " ".join(str(value or "").strip().lower().replace("_", " ").split())


# ------------------------------ scoring ---------------------------------


def _score_entry(
    *,
    wn: float,
    entry: Dict[str, Any],
    peak_shape: str,
    peak_intensity: str,
    other_wns: Sequence[float],
    self_index: int,
) -> Tuple[float, List[str]]:
    lo, hi = entry["range_cm1"]
    center = (float(lo) + float(hi)) / 2.0
    half = max(1e-9, (float(hi) - float(lo)) / 2.0)
    reasons: List[str] = []

    if float(lo) <= float(wn) <= float(hi):
        closeness = 1.0 - min(1.0, abs(float(wn) - center) / half)
        score = 55.0 + (20.0 * closeness)
        reasons.append(f"within {lo:.0f}-{hi:.0f} cm^-1")
    else:
        distance = min(abs(float(wn) - float(lo)), abs(float(wn) - float(hi)))
        if distance > max(18.0, half * 0.25):
            return 0.0, []
        score = max(10.0, 30.0 - distance)
        reasons.append(f"near {lo:.0f}-{hi:.0f} cm^-1")

    shapes = set(entry.get("typical_shape") or [])
    if peak_shape and shapes:
        if peak_shape in shapes:
            score += 8.0
            reasons.append(f"shape matches ({peak_shape})")
        elif "medium" in shapes and peak_shape in {"sharp", "broad"}:
            score -= 2.0
        else:
            score -= 6.0
            reasons.append(f"shape mismatch ({peak_shape})")

    intensities = set(entry.get("typical_intensity") or [])
    if peak_intensity and intensities:
        if peak_intensity in intensities:
            score += 7.0
            reasons.append(f"intensity matches ({peak_intensity})")
        elif "variable" in intensities:
            score += 1.0
        else:
            score -= 5.0

    other = [float(w) for j, w in enumerate(other_wns) if j != int(self_index)]
    for pat in entry.get("confirm_if_present") or []:
        matched, text = _pattern_present(pat, other)
        if matched:
            score += _to_float(dict(pat).get("boost"), default=12.0) or 12.0
            reasons.append(text)

    for pat in entry.get("exclude_if_present") or []:
        matched, text = _pattern_present(pat, other)
        if matched:
            score -= _to_float(dict(pat).get("penalty"), default=18.0) or 18.0
            reasons.append(text)

    return float(_clamp(score, 0.0, 120.0)), reasons


def _pattern_present(pattern: Any, other_wns: Sequence[float]) -> Tuple[bool, str]:
    pat = dict(pattern or {}) if isinstance(pattern, dict) else {}
    rng = pat.get("range_cm1") or (None, None)
    if not isinstance(rng, (list, tuple)) or len(rng) < 2:
        return False, ""
    lo, hi = _normalize_range(rng, entry_id=pat.get("text") or "context")
    matched = any(lo <= float(w) <= hi for w in other_wns)
    text = str(pat.get("text") or f"context peak in {lo:.0f}-{hi:.0f}").strip()
    return matched, text


def _candidate_ratio(top: Optional[Dict[str, Any]], runner_up: Optional[Dict[str, Any]]) -> float:
    if not top:
        return 0.0
    top_score = max(0.0, float(top.get("score") or 0.0))
    if not runner_up:
        return float("inf")
    runner_score = max(1.0, float(runner_up.get("score") or 0.0))
    return float(top_score / runner_score)


# ------------------------- peak feature inference ------------------------


def _infer_peak_shape(*, width: Optional[float], sharpness: Optional[float]) -> str:
    """Infer one of: sharp/medium/broad."""

    w = width if _finite(width) else None
    s = sharpness if _finite(sharpness) else None
    if w is not None:
        if w <= 15.0:
            return "sharp"
        if w <= 40.0:
            return "medium"
        return "broad"
    if s is not None:
        if s >= 0.08:
            return "sharp"
        if s >= 0.03:
            return "medium"
        return "broad"
    return "medium"


def _infer_peak_intensity(p: Dict[str, Any], *, max_height: Optional[float], max_prom: Optional[float]) -> str:
    """Infer weak/medium/strong/variable from relative height/prominence."""

    prom = _to_float(p.get("prominence"), default=None)
    height = _to_float(p.get("height"), default=None)
    if prom is not None and max_prom is not None and float(max_prom) > 0:
        rel = float(prom) / float(max_prom)
    elif height is not None and max_height is not None and float(max_height) > 0:
        rel = float(height) / float(max_height)
    else:
        return "variable"
    if rel >= 0.66:
        return "strong"
    if rel >= 0.33:
        return "medium"
    return "weak"


# ------------------------------ utilities --------------------------------


def _to_float(x: Any, *, default: Optional[float]) -> Optional[float]:
    if x is None:
        return default
    try:
        v = float(x)
        if not math.isfinite(v):
            return default
        return float(v)
    except Exception:
        return default


def _finite(x: Optional[float]) -> bool:
    try:
        return x is not None and math.isfinite(float(x))
    except Exception:
        return False


def _clamp(x: float, lo: float, hi: float) -> float:
    return max(float(lo), min(float(hi), float(x)))
