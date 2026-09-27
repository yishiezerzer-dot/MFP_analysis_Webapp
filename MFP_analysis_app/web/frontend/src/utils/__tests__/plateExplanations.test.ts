import { describe, expect, it } from "vitest";
import type { PlateAnalysis, PlateLayout } from "../../api";
import { checkSummary, explainPlateChart, wellRange } from "../plateExplanations";
import polymers from "./fixtures/plate_polymers.json";
import gentamicin from "./fixtures/plate_gentamicin.json";

// Analysis output of the two real Gen5 plates (lab_gui.plate_mic.analyse_plate).
const poly = polymers as unknown as { layout: PlateLayout; analysis: PlateAnalysis };
const gent = gentamicin as unknown as { layout: PlateLayout; analysis: PlateAnalysis };
const on = { subtractBlank: true, fit4pl: false };

describe("wellRange", () => {
  it("shortens rectangles and long lists", () => {
    expect(wellRange(["H12", "G1", ...Array.from({ length: 22 }, (_, i) => (i < 11 ? `G${i + 2}` : `H${i - 10}`))])).toBe("G1–H12");
    expect(wellRange(["A12", "C12"])).toBe("A12, C12");
    expect(wellRange([])).toBe("none");
  });
});

describe("checkSummary", () => {
  it("counts passed checks, warnings and notes", () => {
    expect(checkSummary(poly.analysis.checks)).toBe("✓ 7 checks passed · ⚠ 1 warning · 3 notes");
  });
});

describe("explainPlateChart on the polymer plate", () => {
  const dose = explainPlateChart("dose", poly.analysis, poly.layout, on);

  it("states the blank, replicate rows and concentrations of this plate", () => {
    expect(dose.steps[0]).toBe("Blank = mean of 24 wells G1–H12 = 0.047 ± 0.002 (SD)");
    expect(dose.steps).toContain("Replicates: LacGlyDOH 5:1:1 = rows A–C · LacGlyDOH 1:1:1 = rows D–F");
    expect(dose.steps).toContain(
      "Concentration of column n = 1024 ÷ 2^(n − 1) µg/mL (column 1 = 1024 … column 11 = 1)",
    );
    expect(dose.steps).toContain("Dashed line — LacGlyDOH 5:1:1: growth control = mean of A12–C12 = 1.141");
  });

  it("notes the excluded well and its effect on n", () => {
    expect(dose.notes).toEqual(["Excluded F1 → n = 2 at 1024 µg/mL for LacGlyDOH 1:1:1"]);
  });

  it("carries the row-A replicate warning", () => {
    expect(dose.checks.find((c) => c.level === "warn")?.message).toMatch(/row A deviates most/);
  });

  it("works a % growth example with this plate's numbers", () => {
    const growth = explainPlateChart("growth", poly.analysis, poly.layout, on);
    const first = poly.analysis.groups[0].points[0];
    expect(growth.steps.at(-1)).toBe(
      `e.g. LacGlyDOH 5:1:1 at 1024 µg/mL: 100 × ${first.mean?.toFixed(3)} ÷ 1.141 = ${Math.round(first.percent_growth ?? 0)}%`,
    );
    expect(growth.reproduce).toContain("average the blank wells (G1–H12)");
  });

  it("flags a 4PL IC50 outside the tested range", () => {
    const withFit = explainPlateChart("dose", poly.analysis, poly.layout, { subtractBlank: true, fit4pl: true });
    expect(withFit.steps.some((s) => s.startsWith("LacGlyDOH 1:1:1: IC₅₀") && s.includes("do not report"))).toBe(true);
  });

  it("limits the heatmap to plate-level checks", () => {
    const heat = explainPlateChart("heatmap", poly.analysis, poly.layout, on);
    expect(heat.checks.map((c) => c.id)).toEqual(["blank", "reader_range", "excluded"]);
  });
});

describe("explainPlateChart on the gentamicin plate", () => {
  it("says which growth-control well was excluded", () => {
    const growth = explainPlateChart("growth", gent.analysis, gent.layout, on);
    expect(growth.steps).toContain("Gentamicin: growth control = mean of A12, C12 = " + gent.analysis.groups[0].growth_control.mean?.toFixed(3) + "; B12 excluded");
  });

  it("describes blank subtraction being off", () => {
    const off = { ...gent.analysis, blank: { ...gent.analysis.blank, used: false } };
    const dose = explainPlateChart("dose", off, gent.layout, { subtractBlank: false, fit4pl: false });
    expect(dose.steps[0]).toBe("Blank subtraction is off: values are OD as read");
    expect(dose.steps[1]).toBe("Each well: OD as read (nothing subtracted)");
  });
});
