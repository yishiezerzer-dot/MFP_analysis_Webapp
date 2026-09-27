import { describe, expect, it } from "vitest";
import type { PlotData } from "plotly.js";
import type { PlateAnalysis } from "../../../api";
import gentamicin from "../../../utils/__tests__/fixtures/plate_gentamicin.json";
import polymers from "../../../utils/__tests__/fixtures/plate_polymers.json";
import { doseTraces, growthTraces, stickTraces } from "../PlateCharts";
import { resultsCsv } from "../ResultsTab";

const gent = (gentamicin as unknown as { analysis: PlateAnalysis }).analysis;
const poly = (polymers as unknown as { analysis: PlateAnalysis }).analysis;
const asPlot = (d: unknown) => d as Partial<PlotData> & { error_y: { array: number[] } };

describe("plate chart traces", () => {
  it("dose–response: one mean ± SD trace and one growth-control line per compound", () => {
    const traces = doseTraces(poly, "day", false).map(asPlot);
    expect(traces.map((t) => t.name)).toEqual([
      "LacGlyDOH 5:1:1",
      "LacGlyDOH 5:1:1 growth control",
      "LacGlyDOH 1:1:1",
      "LacGlyDOH 1:1:1 growth control",
    ]);
    expect(traces[0].x).toHaveLength(11);
    expect(traces[1].y).toEqual([poly.groups[0].growth_control.mean, poly.groups[0].growth_control.mean]);
    expect(traces[1].line?.dash).toBe("dash");
  });

  it("dose–response adds the 4PL curve only when asked and fitted", () => {
    const fitted = poly.groups.filter((g) => g.fit).map((g) => `${g.name} 4PL`);
    expect(fitted).toHaveLength(1);
    expect(doseTraces(poly, "day", true).map(asPlot).filter((t) => t.name?.endsWith("4PL")).map((t) => t.name)).toEqual(fitted);
    expect(doseTraces(gent, "day", true).map(asPlot).filter((t) => t.name?.endsWith("4PL"))).toHaveLength(0);
  });

  it("% growth: gentamicin reaches 0% at 4 µg/mL and above", () => {
    const [t] = growthTraces(gent, "day").map(asPlot);
    const byConc = new Map((t.x as number[]).map((x, i) => [x, (t.y as number[])[i]]));
    expect(byConc.get(4)).toBeCloseTo(0, 0);
    expect(Math.round(byConc.get(2) as number)).toBe(22);
    expect(Math.round(byConc.get(1) as number)).toBe(46);
  });

  it("stick plot: plate order with the growth control last", () => {
    const [t] = stickTraces(gent, "day").map(asPlot);
    expect((t.x as string[])[0]).toBe("1024");
    expect((t.x as string[]).at(-1)).toBe("GC");
    expect((t.y as number[]).at(-1)).toBe(gent.groups[0].growth_control.mean);
  });

  it("keeps the original colour for export on the night theme", () => {
    const [t] = growthTraces(poly, "night") as Array<Partial<PlotData> & { meta: { exportColor: string } }>;
    expect(t.meta.exportColor).toBe(poly.groups[0].colour ?? "#405a9c");
    expect(t.marker?.color).not.toBe(t.meta.exportColor);
  });
});

describe("resultsCsv", () => {
  it("lists every point with replicates and leaves excluded wells blank", () => {
    const lines = resultsCsv(poly).split("\n");
    expect(lines[0]).toBe(
      "Compound,Kind,Concentration (µg/mL),n,Replicate 1,Replicate 2,Replicate 3,Mean OD,SD,% growth,Excluded wells",
    );
    expect(lines).toHaveLength(1 + 22);
    const f1 = lines.find((l) => l.startsWith("LacGlyDOH 1:1:1,sample,1024,"));
    expect(f1?.split(",")[3]).toBe("2");
    expect(f1?.endsWith(",F1")).toBe(true);
  });
});
