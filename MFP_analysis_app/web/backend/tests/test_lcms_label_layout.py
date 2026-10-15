"""Pipeline label layout: no overlaps, deterministic, collisions become numbered callouts."""
import itertools

from app.services.lcms_label_layout import LayoutInput, LayoutOptions, layout_labels, trace_top


def boxes_overlap(a, b) -> bool:
    return a.x0 < b.x1 and b.x0 < a.x1 and a.y0 < b.y1 and b.y0 < a.y1


def crowded_items():
    # Ten long labels on peaks 12 px apart, plus a few spread out.
    xs = [300 + 12 * i for i in range(10)] + [60, 700, 820]
    return [LayoutInput(id=f"L{i}", x_px=x, y_px=250 - (i % 3) * 30, text=f"{i + 2}-GA + {i}-LA [M+H]⁺") for i, x in enumerate(xs)]


def test_layout_has_no_overlaps_and_stays_inside():
    opts = LayoutOptions(plot_width_px=900, plot_height_px=300)
    placed = layout_labels(crowded_items(), opts)
    assert len(placed) == 13  # nothing hidden
    for a, b in itertools.combinations(placed, 2):
        assert not boxes_overlap(a.box, b.box), (a.id, b.id)
    for item in placed:
        assert item.box.x0 >= 0 and item.box.x1 <= 900 and item.box.y0 >= 0
        assert item.axRef == "pixel" and item.ayRef == "pixel"
        assert item.ay < 0  # above its peak


def test_layout_is_deterministic():
    opts = LayoutOptions()
    first = [p.model_dump() for p in layout_labels(crowded_items(), opts)]
    again = [p.model_dump() for p in layout_labels(list(reversed(crowded_items())), opts)]
    assert sorted(first, key=lambda d: d["id"]) == sorted(again, key=lambda d: d["id"])


def test_labels_clear_the_trace():
    xs = list(range(0, 900, 5))
    ys = [280 - 200 if 400 <= x <= 420 else 280 for x in xs]  # a tall narrow peak near x 410
    placed = layout_labels([LayoutInput(id="a", x_px=330, y_px=280, text="2-GA [M+H]⁺")], LayoutOptions(), trace_top(xs, ys))
    box = placed[0].box
    if box.x1 >= 400 and box.x0 <= 420:
        assert box.y1 <= 80


def test_unplaceable_labels_become_numbered_callouts():
    # A very short plot: only one stair of full text fits, so the rest are numbered.
    opts = LayoutOptions(plot_width_px=300, plot_height_px=60, max_levels=3)
    items = [LayoutInput(id=f"L{i}", x_px=150 + i, y_px=58, text="12-GA + 9-LA -H2O [M+Na]⁺") for i in range(4)]
    placed = layout_labels(items, opts)
    callouts = [p for p in placed if p.callout is not None]
    assert callouts and [p.callout for p in callouts] == list(range(1, len(callouts) + 1))
    assert all(p.shown_text == str(p.callout) for p in callouts)
