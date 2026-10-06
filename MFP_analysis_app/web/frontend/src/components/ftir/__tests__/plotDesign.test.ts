import { describe, expect, it } from "vitest";
import { DESIGN_PRESETS, applyPreset, arrangeLabels, labelSize, mergeGraphSettings, type LabelToPlace } from "../plotDesign";

const boxOf = (l: LabelToPlace, o: { ax: number; ay: number }, size: { width: number; height: number }) => ({
  x0: l.px + o.ax - size.width / 2,
  x1: l.px + o.ax + size.width / 2,
  y0: l.py + o.ay - size.height / 2,
  y1: l.py + o.ay + size.height / 2,
});

describe("FTIR plot design", () => {
  it("reads settings saved before the new options existed", () => {
    const s = mergeGraphSettings({ lineWidth: 2, axisTickSize: 99 } as never);
    expect(s.lineWidth).toBe(2);
    expect(s.axisTickSize).toBe(24);
    expect(s).toMatchObject({ showPeakMarkers: true, peakLabelOrientation: "horizontal", yMin: null, xTickStep: null });
  });

  it("presets change the look but keep trace colours", () => {
    const s = applyPreset({ ...mergeGraphSettings({}), traceColors: { a: "#000" } }, DESIGN_PRESETS.Paper);
    expect(s.traceColors).toEqual({ a: "#000" });
    expect(s.peakLabelOrientation).toBe("vertical");
  });

  it("auto-arranges close labels so none overlap and all clear the curve", () => {
    // Three peaks 10 px apart on a curve whose top in the area is at y = 200.
    const labels: LabelToPlace[] = [0, 1, 2].map((i) => ({ key: `p${i}`, px: 300 + i * 10, py: 220, text: "C-O stretch (ester)" }));
    const placed = arrangeLabels(labels, {
      direction: "up",
      fontSize: 10,
      vertical: false,
      plotWidth: 800,
      plotHeight: 400,
      curveEdge: () => 200,
    });
    const size = labelSize("C-O stretch (ester)", 10, false);
    const boxes = labels.map((l) => boxOf(l, placed[l.key], size));
    for (const b of boxes) {
      expect(b.y1).toBeLessThanOrEqual(200);
      expect(b.y0).toBeGreaterThanOrEqual(0);
    }
    for (let i = 0; i < boxes.length; i += 1)
      for (let j = i + 1; j < boxes.length; j += 1) {
        const [a, b] = [boxes[i], boxes[j]];
        expect(a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1).toBe(false);
      }
  });

  it("places transmittance labels below the dips", () => {
    const placed = arrangeLabels([{ key: "a", px: 100, py: 300, text: "C=O" }], {
      direction: "down", fontSize: 10, vertical: true, plotWidth: 500, plotHeight: 400, curveEdge: () => 300,
    });
    expect(placed.a.ay).toBeGreaterThan(0);
  });
});

describe("auto-arrange on a crowded spectrum", () => {
  it("falls back to rows in peak order with no overlaps", () => {
    const labels: LabelToPlace[] = Array.from({ length: 10 }, (_, i) => ({ key: `p${i}`, px: 400 + i * 15, py: 300, text: "CH2 scissor / CH3 asymmetric bend" }));
    const placed = arrangeLabels(labels, { direction: "up", fontSize: 10, vertical: false, plotWidth: 700, plotHeight: 330, curveEdge: () => 60 });
    const size = labelSize(labels[0].text, 10, false);
    const boxes = labels.map((l) => boxOf(l, placed[l.key], size));
    for (let i = 0; i < boxes.length; i += 1)
      for (let j = i + 1; j < boxes.length; j += 1) {
        const [a, b] = [boxes[i], boxes[j]];
        expect(a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1).toBe(false);
      }
    // Same row keeps peak order.
    const centres = labels.map((l) => l.px + placed[l.key].ax);
    const rowOf = labels.map((l) => l.py + placed[l.key].ay);
    for (let i = 0; i < labels.length; i += 1)
      for (let j = i + 1; j < labels.length; j += 1) if (rowOf[i] === rowOf[j]) expect(centres[i]).toBeLessThan(centres[j]);
  });
});
