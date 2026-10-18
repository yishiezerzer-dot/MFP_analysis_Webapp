"""Deterministic layout of UV peak labels, with leader lines.

Vertical labels (the default, as in the lab's figures) sit in a band along the top of the plot in
retention order, left to right, each as close above its peak as its neighbours allow; with more
labels than fit in one band, they alternate between bands. Horizontal labels use stairs:

Works in pixel space (x right, y down) for a plot area of a given size. Labels are placed left to
right, each above its peak and above the trace under it, climbing in stair levels and trying small
sideways nudges until it overlaps nothing already placed. Label centres keep the left-to-right
order of their peaks, so leader lines don't cross each other. A label that still collides becomes a numbered callout
(the full text goes in the results table); nothing is hidden. Offsets come back in the frontend's
UVLabelLayoutOffset shape: ax/ay are pixels from the peak to the label centre.
"""
from __future__ import annotations

from typing import Callable, List, Literal, Optional, Sequence

import numpy as np
from pydantic import BaseModel


class LayoutOptions(BaseModel):
    orientation: Literal["vertical", "horizontal"] = "vertical"
    plot_width_px: float = 900.0
    plot_height_px: float = 300.0
    font_px: float = 11.0
    base_gap_px: float = 18.0  # space between the peak (or trace) and the lowest stair
    gap_px: float = 4.0
    max_levels: int = 12


class LayoutInput(BaseModel):
    id: str
    x_px: float
    y_px: float
    text: str


class Box(BaseModel):
    x0: float
    y0: float
    x1: float
    y1: float


class LayoutItem(BaseModel):
    id: str
    ax: float
    ay: float
    axRef: Literal["pixel"] = "pixel"
    ayRef: Literal["pixel"] = "pixel"
    callout: Optional[int] = None  # numbered marker instead of the full text
    shown_text: str
    box: Box
    leader: Box  # from the peak (x0, y0) to the label's near edge (x1, y1)


def text_size(text: str, font_px: float, vertical: bool = False) -> tuple[float, float]:
    """(width, height) of a label's box in pixels; a vertical label is its horizontal box turned."""
    along, across = len(text) * font_px * 0.6 + 8.0, font_px + 8.0
    return (across, along) if vertical else (along, across)


def _overlaps(a: Box, b: Box, pad: float) -> bool:
    return a.x0 < b.x1 + pad and b.x0 < a.x1 + pad and a.y0 < b.y1 + pad and b.y0 < a.y1 + pad


def trace_top(x_px: Sequence[float], y_px: Sequence[float]) -> Callable[[float, float], float]:
    """Topmost (smallest) trace y in a pixel x span, for keeping labels off the curve."""
    xs = np.asarray(x_px, dtype=float)
    ys = np.asarray(y_px, dtype=float)
    order = np.argsort(xs)
    xs, ys = xs[order], ys[order]

    def top(x0: float, x1: float) -> float:
        lo, hi = np.searchsorted(xs, [min(x0, x1), max(x0, x1)])
        seg = ys[max(0, lo - 1) : min(len(ys), hi + 1)]
        seg = seg[np.isfinite(seg)]
        return float(seg.min()) if seg.size else float("inf")

    return top


def _item(item: LayoutInput, box: Box, shown: str, callout: Optional[int] = None) -> LayoutItem:
    cx, cy = (box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2
    return LayoutItem(
        id=item.id,
        ax=round(cx - item.x_px, 1),
        ay=round(cy - item.y_px, 1),
        callout=callout,
        shown_text=shown,
        box=box,
        leader=Box(x0=item.x_px, y0=item.y_px, x1=cx, y1=box.y1),
    )


def _rt_ordered_band(items: Sequence[LayoutInput], opts: LayoutOptions) -> List[LayoutItem]:
    """Vertical labels top-aligned in bands, in retention order, packed as close to their peaks as fits."""
    ordered = sorted(items, key=lambda it: (it.x_px, it.id))
    sizes = [text_size(it.text, opts.font_px, vertical=True) for it in ordered]
    gap = opts.gap_px

    def pack(rows: int) -> tuple[List[float], bool]:
        centres = [0.0] * len(ordered)
        fits = True
        for row in range(rows):
            idx = [i for i in range(len(ordered)) if i % rows == row]
            right = float("-inf")
            for i in idx:  # as close to the peak as the label on its left allows
                w = sizes[i][0]
                centres[i] = max(ordered[i].x_px, right + gap + w / 2, w / 2)
                right = centres[i] + w / 2
            left = opts.plot_width_px + gap
            for i in reversed(idx):  # pull back inside the plot
                w = sizes[i][0]
                centres[i] = min(centres[i], left - gap - w / 2)
                left = centres[i] - w / 2
            if idx and left < 0:
                fits = False
        return centres, fits

    rows = 1
    centres, fits = pack(rows)
    while not fits and rows < len(ordered):
        rows += 1
        centres, fits = pack(rows)
    band_h = max((h for _, h in sizes), default=0.0)
    out = []
    for i, item in enumerate(ordered):
        w, h = sizes[i]
        y0 = gap + (i % rows) * (band_h + gap)
        out.append(_item(item, Box(x0=centres[i] - w / 2, y0=y0, x1=centres[i] + w / 2, y1=y0 + h), item.text))
    by_id = {it.id: k for k, it in enumerate(items)}
    return sorted(out, key=lambda it: by_id[it.id])


def layout_labels(
    items: Sequence[LayoutInput],
    opts: LayoutOptions,
    curve_top: Optional[Callable[[float, float], float]] = None,
) -> List[LayoutItem]:
    """Place every label; same input, same output (ties broken by x, then id)."""
    if opts.orientation == "vertical":
        return _rt_ordered_band(items, opts)
    placed: List[Box] = []
    out: List[LayoutItem] = []
    nudges = (0.0, 0.25, -0.25, 0.5, -0.5)
    next_callout = 1
    last_cx = float("-inf")  # centre of the previous label: keep order, no crossing leaders

    def find(item: LayoutInput, w: float, h: float) -> Optional[Box]:
        for level in range(opts.max_levels):
            for nudge in nudges:
                cx = min(max(item.x_px + nudge * w, w / 2), opts.plot_width_px - w / 2)
                if cx < last_cx:
                    continue
                floor = item.y_px - opts.base_gap_px
                if curve_top is not None:
                    floor = min(floor, curve_top(cx - w / 2, cx + w / 2) - opts.gap_px)
                y1 = floor - level * (h + opts.gap_px)
                box = Box(x0=cx - w / 2, y0=y1 - h, x1=cx + w / 2, y1=y1)
                if box.y0 < 0:
                    break  # this nudge has no room higher up; try the next nudge
                if not any(_overlaps(box, p, opts.gap_px) for p in placed):
                    return box
        return None

    for item in sorted(items, key=lambda it: (it.x_px, it.id)):
        w, h = text_size(item.text, opts.font_px)
        box = find(item, w, h)
        callout: Optional[int] = None
        shown = item.text
        if box is None:
            callout = next_callout
            next_callout += 1
            shown = str(callout)
            w, h = text_size(shown, opts.font_px)
            box = find(item, w, h)
            if box is None:
                # Truly no room: sit just above the peak, inside the plot.
                cx = min(max(item.x_px, last_cx, w / 2), opts.plot_width_px - w / 2)
                y1 = max(h, item.y_px - opts.base_gap_px)
                box = Box(x0=cx - w / 2, y0=y1 - h, x1=cx + w / 2, y1=y1)
        placed.append(box)
        last_cx = max(last_cx, (box.x0 + box.x1) / 2)
        out.append(_item(item, box, shown, callout))
    by_id = {it.id: i for i, it in enumerate(items)}
    return sorted(out, key=lambda it: by_id[it.id])
