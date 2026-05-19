import { describe, expect, it } from "vitest";

import {
  buildExpectedProductHits,
  buildKendrickPoints,
  buildSpectrumIndex,
  escapeCsvCell,
  findMostIntenseSpectrumPeak,
  generateCompositions,
  groupFeatureRowsForMatrix,
  integrateEICPeak,
  ionLabel,
  parseExpectedProductMonomers,
  parsePositiveCharges,
  PROTON_MASS,
  rowsToCsv,
  toApiPolymerSettings,
} from "../analysis";
import {
  eicFixture,
  featureRowFixture,
  polymerSettingsFixture,
  sessionFixtures,
  spectrumFixture,
} from "./fixtures/analysisFixtures";

describe("integrateEICPeak", () => {
  it("picks the apex nearest the reference RT (not the global max)", () => {
    // Two peaks: small at idx 3 (intensity 80), large at idx 7 (intensity 120)
    const result = integrateEICPeak(
      eicFixture([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [10, 10, 20, 80, 20, 10, 15, 120, 15, 10]),
      3,
    );
    expect(result?.rtApex).toBe(3);
    expect(result?.height).toBe(80);
  });

  it("falls back to global max when no reference RT is given", () => {
    const result = integrateEICPeak(
      eicFixture([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [10, 10, 20, 80, 20, 10, 15, 120, 15, 10]),
    );
    expect(result?.rtApex).toBe(7);
    expect(result?.height).toBe(120);
  });

  it("stops integration at the valley between two peaks", () => {
    // Valley at idx 5 (intensity 10) separates two peaks
    const result = integrateEICPeak(
      eicFixture([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [10, 10, 20, 80, 20, 10, 15, 120, 15, 10]),
      7,
    );
    expect(result?.rtStart).toBeGreaterThanOrEqual(5);
    expect(result?.rtEnd).toBeLessThanOrEqual(9);
  });

  it("uses baseline from points outside the slope-bounded window", () => {
    // Long flat noise at intensity 5, single peak of 100 in the middle
    const intensity = [5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 100, 5, 5, 5, 5, 5, 5, 5, 5, 5];
    const rt = intensity.map((_, i) => i);
    const result = integrateEICPeak(eicFixture(rt, intensity));
    expect(result?.baseline).toBe(5);
    expect(result?.height).toBe(100);
  });
});

describe("findMostIntenseSpectrumPeak", () => {
  it("returns the most intense peak inside the tolerance window", () => {
    const index = buildSpectrumIndex(spectrumFixture([101.0, 101.004, 101.006, 101.02], [10, 200, 50, 500]));
    const peak = findMostIntenseSpectrumPeak(index, 101.005, 0.006);
    expect(peak?.mz).toBeCloseTo(101.004, 6);
    expect(peak?.intensity).toBe(200);
  });

  it("returns null when no peak is in tolerance", () => {
    const index = buildSpectrumIndex(spectrumFixture([100, 200], [10, 20]));
    expect(findMostIntenseSpectrumPeak(index, 150, 0.01)).toBeNull();
  });
});

describe("buildKendrickPoints", () => {
  const repeatMass = 100.1;
  const scale = Math.round(repeatMass) / repeatMass;
  const mzForKmd = (nominal: number, kmd: number) => (nominal - kmd) / scale;

  it("clusters with running-mean (anchor) and a kmd tolerance", () => {
    const result = buildKendrickPoints(
      spectrumFixture([mzForKmd(100, 0), mzForKmd(200, 0.009), mzForKmd(300, 0.018)], [100, 90, 80]),
      repeatMass,
      0,
      0.01,
      "kmd",
      2,
    );
    expect(result.series).toHaveLength(1);
    expect(result.series[0].count).toBe(2);
  });

  it("respects minSeriesPoints — clusters below threshold are dropped", () => {
    const result = buildKendrickPoints(
      spectrumFixture([mzForKmd(100, 0), mzForKmd(200, 0.005)], [100, 90]),
      repeatMass,
      0,
      0.01,
      "kmd",
      5,
    );
    expect(result.series).toHaveLength(0);
  });

  it("scales tolerance with m/z when unit is ppm", () => {
    // 20 ppm at m/z 1000 → ~0.02 kendrick mass tolerance after scaling.
    // Two points at the same kmd should cluster; a 3rd far away should not.
    const result = buildKendrickPoints(
      spectrumFixture([mzForKmd(100, 0), mzForKmd(110, 0), mzForKmd(120, 0.5)], [100, 90, 80]),
      repeatMass,
      0,
      20,
      "ppm",
      2,
    );
    expect(result.series).toHaveLength(1);
    expect(result.series[0].count).toBe(2);
  });
});

describe("buildExpectedProductHits", () => {
  it("matches [M+H]+ for a single composition", () => {
    const index = buildSpectrumIndex(
      spectrumFixture([100 + PROTON_MASS], [1000]),
    );
    const hits = buildExpectedProductHits(polymerSettingsFixture(), "positive", index, 1, "normal", 0.2);
    expect(hits.some((hit) => hit.composition === "1-Test" && hit.observedMz != null)).toBe(true);
  });

  it("annotates [2M+H]+ when monomer is at least as intense as the dimer", () => {
    const index = buildSpectrumIndex(
      spectrumFixture([100 + PROTON_MASS, 200 + PROTON_MASS], [2000, 1000]),
    );
    const hits = buildExpectedProductHits(polymerSettingsFixture(), "positive", index, 1, "normal", 0.2);
    expect(hits.some((hit) => hit.variant === "2M" && hit.observedMz != null)).toBe(true);
  });

  it("suppresses [2M+H]+ when the monomer is missing (or too weak)", () => {
    // Dimer peak at 200+H present; no monomer peak at 100+H at all.
    const index = buildSpectrumIndex(
      spectrumFixture([200 + PROTON_MASS], [1000]),
    );
    const hits = buildExpectedProductHits(polymerSettingsFixture(), "positive", index, 1, "normal", 0.2);
    expect(hits.some((hit) => hit.variant === "2M")).toBe(false);
  });
});

describe("groupFeatureRowsForMatrix", () => {
  it("groups by evidence label first", () => {
    const rows = [
      featureRowFixture({ id: "a-low", session_id: "s1", area: 100, expectedProduct: "1-Test" }),
      featureRowFixture({ id: "a-high", session_id: "s1", area: 300, expectedProduct: "1-Test" }),
      featureRowFixture({ id: "b", session_id: "s2", area: 200, expectedProduct: "1-Test" }),
      featureRowFixture({ id: "fallback", session_id: null, sourceFile: "loose.mzML", mz: 150 }),
    ];
    const matrix = groupFeatureRowsForMatrix(rows, sessionFixtures, {
      metric: "area",
      groupMode: "evidence",
      mzTolerance: 0.05,
    });
    const expectedGroup = matrix.groups.find((group) => group.label === "1-Test");
    expect(matrix.columnLabels.s1).toBe("Sample 1");
    expect(matrix.columnLabels["file:loose.mzML"]).toBe("loose.mzML");
    expect(expectedGroup?.cells.s1?.row.id).toBe("a-high");
    expect(expectedGroup?.cells.s2?.row.id).toBe("b");
  });

  it("surfaces cell collisions instead of silently dropping the smaller value", () => {
    const rows = [
      featureRowFixture({ id: "a-low", session_id: "s1", area: 100, expectedProduct: "1-Test" }),
      featureRowFixture({ id: "a-high", session_id: "s1", area: 300, expectedProduct: "1-Test" }),
      featureRowFixture({ id: "a-mid", session_id: "s1", area: 200, expectedProduct: "1-Test" }),
    ];
    const matrix = groupFeatureRowsForMatrix(rows, sessionFixtures, {
      metric: "area",
      groupMode: "evidence",
      mzTolerance: 0.05,
    });
    const group = matrix.groups[0];
    expect(group.cells.s1?.row.id).toBe("a-high");
    expect(group.cells.s1?.collisions.map((r) => r.id).sort()).toEqual(["a-low", "a-mid"]);
  });

  it("m/z fallback clusters against the anchor m/z (no transitive drift)", () => {
    // Points spaced 0.04 apart with tolerance 0.05 would all merge under
    // running-mean clustering; with anchor clustering only the first two land
    // in the same group (anchor 100.00, third point at 100.08 is outside tol).
    const rows = [
      featureRowFixture({ id: "a", session_id: "s1", mz: 100.00, polarity: "positive" }),
      featureRowFixture({ id: "b", session_id: "s2", mz: 100.04, polarity: "positive" }),
      featureRowFixture({ id: "c", session_id: "s1", mz: 100.08, polarity: "positive", sourceFile: "c.mzML" }),
    ];
    const matrix = groupFeatureRowsForMatrix(rows, sessionFixtures, {
      metric: "area",
      groupMode: "mz",
      mzTolerance: 0.05,
    });
    expect(matrix.groups).toHaveLength(2);
    expect(matrix.groups[0].rows.map((r) => r.id).sort()).toEqual(["a", "b"]);
    expect(matrix.groups[1].rows.map((r) => r.id)).toEqual(["c"]);
  });
});

describe("generateCompositions", () => {
  it("enumerates compositions with total DP up to max", () => {
    const monomers = [
      { name: "A", mass: 100 },
      { name: "B", mass: 200 },
    ];
    const out = generateCompositions(monomers, 2);
    const labels = out.map((c) => c.label).sort();
    expect(labels).toEqual(["1-A", "1-A + 1-B", "1-B", "2-A", "2-B"]);
  });

  it("respects the safety limit", () => {
    const monomers = [{ name: "A", mass: 100 }];
    expect(generateCompositions(monomers, 100, 3)).toHaveLength(3);
  });
});

describe("ionLabel", () => {
  it("uses Unicode superscript and minus signs", () => {
    expect(ionLabel("M", "+Na", 22.99, 1, "positive")).toBe("[M+Na]⁺");
    expect(ionLabel("M", "+H", PROTON_MASS, 2, "positive")).toBe("[M+H]²⁺");
    expect(ionLabel("M", "-H", -PROTON_MASS, 1, "negative")).toBe("[M−H]⁻");
    expect(ionLabel("2M", "", PROTON_MASS, 1, "positive")).toBe("[2M+H]⁺");
  });
});

describe("parseExpectedProductMonomers", () => {
  it("parses one per line, name + mass", () => {
    const out = parseExpectedProductMonomers("Gly 75.032\nArg 174.112");
    expect(out).toEqual([
      { name: "Gly", mass: 75.032 },
      { name: "Arg", mass: 174.112 },
    ]);
  });

  it("skips lines without a numeric mass and auto-names by line index", () => {
    // "75 " (line index 2 → name "M3") is the only line with a valid mass.
    expect(parseExpectedProductMonomers("Gly\n\n75 \nbad notanumber")).toEqual([
      { name: "M3", mass: 75 },
    ]);
  });
});

describe("parsePositiveCharges", () => {
  it("parses comma- or semicolon-separated positive integers", () => {
    expect(parsePositiveCharges("1, 2; 3")).toEqual([1, 2, 3]);
  });
  it("falls back to [1] on empty input", () => {
    expect(parsePositiveCharges("")).toEqual([1]);
  });
});

describe("escapeCsvCell and rowsToCsv", () => {
  it("quotes cells containing commas, quotes, or newlines", () => {
    expect(escapeCsvCell("plain")).toBe("plain");
    expect(escapeCsvCell("a,b")).toBe('"a,b"');
    expect(escapeCsvCell('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvCell(null)).toBe("");
    expect(escapeCsvCell(undefined)).toBe("");
  });
  it("joins rows correctly", () => {
    expect(rowsToCsv([["a", "b"], ["c", "d,e"]])).toBe('a,b\nc,"d,e"');
  });
});

describe("toApiPolymerSettings", () => {
  it("includes positive-only adducts when polarity is positive", () => {
    const out = toApiPolymerSettings(polymerSettingsFixture(), "positive");
    expect(out.adduct_na).toBe(false);
    expect(out.adduct_cl).toBe(false);
  });
  it("includes negative-only adducts when polarity is negative", () => {
    const out = toApiPolymerSettings(polymerSettingsFixture(), "negative");
    expect(out.adduct_na).toBe(false);
    expect(out.adduct_cl).toBe(false);
  });
});
