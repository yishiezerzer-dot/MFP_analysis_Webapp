import { describe, expect, it } from "vitest";
import type { PlateAnalysis, PlateExperiment } from "../../api";
import { combinedAnalysis, explainExperiment, growthFill, gridCsv, micGrid } from "../plateExperiment";
import polymers from "./fixtures/plate_polymers.json";
import gentamicin from "./fixtures/plate_gentamicin.json";

const plate = (id: string, name: string, number: string, fixture: unknown) => ({
  session_id: id,
  display_name: name,
  metadata: { plate_number: number },
  layout_source: "saved" as const,
  analysis: (fixture as { analysis: PlateAnalysis }).analysis,
});

// The user's MIC run: polymers on Plate 1, gentamicin (B12 excluded) on Plate 3.
const exp: PlateExperiment = {
  experiment_tag: "MIC run 12",
  plates: [
    plate("p1", "LacGlyDOH 511 and 111.xlsx", "Plate 1", polymers),
    plate("p3", "gentamicin.xlsx", "Plate 3", gentamicin),
  ],
};

describe("combinedAnalysis", () => {
  it("lists every compound once, marks the reference and gives each its own colour", () => {
    const a = combinedAnalysis(exp);
    expect(a.groups.map((g) => g.name)).toEqual(["LacGlyDOH 5:1:1", "LacGlyDOH 1:1:1", "Gentamicin (reference)"]);
    expect(new Set(a.groups.map((g) => g.colour)).size).toBe(3);
    expect(new Set(a.groups.map((g) => g.id)).size).toBe(3);
  });

  it("names the plate when two plates hold the same compound", () => {
    const twice: PlateExperiment = { ...exp, plates: [exp.plates[1], { ...exp.plates[1], session_id: "p4", metadata: { plate_number: "Plate 4" } }] };
    expect(combinedAnalysis(twice).groups.map((g) => g.name)).toEqual([
      "Gentamicin (Plate 3) (reference)",
      "Gentamicin (Plate 4) (reference)",
    ]);
  });
});

describe("micGrid", () => {
  const grid = micGrid(exp);

  it("runs from the top concentration down", () => {
    expect(grid.concentrations[0]).toBe(1024);
    expect(grid.concentrations.at(-1)).toBe(1);
    expect(grid.unit).toBe("µg/mL");
  });

  it("has a mean row and one row per replicate row for each compound", () => {
    expect(grid.rows.map((r) => `${r.compound}|${r.label}`)).toEqual([
      "LacGlyDOH 5:1:1|mean",
      "LacGlyDOH 5:1:1|row A",
      "LacGlyDOH 5:1:1|row B",
      "LacGlyDOH 5:1:1|row C",
      "LacGlyDOH 1:1:1|mean",
      "LacGlyDOH 1:1:1|row D",
      "LacGlyDOH 1:1:1|row E",
      "LacGlyDOH 1:1:1|row F",
      "Gentamicin|mean",
      "Gentamicin|row A",
      "Gentamicin|row B",
      "Gentamicin|row C",
    ]);
  });

  it("shows gentamicin's MIC: no growth down to 4 µg/mL, regrowth at 2 and 1", () => {
    const mean = grid.rows.find((r) => r.compound === "Gentamicin" && r.mean);
    const pct = mean?.cells.map((c) => Math.round(c.percent ?? NaN) || 0);
    expect(pct).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 22, 46]);
  });

  it("marks the excluded F1 well", () => {
    const rowF = grid.rows.find((r) => r.label === "row F");
    expect(rowF?.cells[0].excluded).toBe(true);
    expect(gridCsv(exp).find((r) => r[2] === "row F")?.[3]).toBe("");
  });
});

describe("growthFill", () => {
  it("is white at no growth and blue at full growth", () => {
    expect(growthFill(-1).background).toBe("rgb(255, 255, 255)");
    expect(growthFill(100).background).toBe("rgb(64, 90, 156)");
    expect(growthFill(null).background).toBe("transparent");
  });
});

describe("explainExperiment", () => {
  it("lists each plate's own blank and growth controls, and prefixes checks with the plate", () => {
    const e = explainExperiment("growth", exp);
    expect(e.steps[1]).toMatch(/^Plate 1 \(LacGlyDOH 511 and 111\.xlsx\): blank 0\.047 \(24 wells\) · LacGlyDOH 5:1:1 growth control 1\.141/);
    expect(e.checks.some((c) => c.message.startsWith("Plate 3 (gentamicin.xlsx): ") && c.level === "warn")).toBe(true);
  });
});
