import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import type { SpectrumData, LCMSEICData } from "../../api";
import {
  buildKendrickPoints,
  groupFeatureRowsForMatrix,
  integrateEICPeak,
  type LCMSFeatureRow,
} from "../analysis";

const FIXTURES_DIR = resolve(__dirname, "../../../../shared_fixtures/lcms");

function load(file: string): { cases: Array<{ name: string; input: any; expected: any }> } {
  return JSON.parse(readFileSync(resolve(FIXTURES_DIR, file), "utf8"));
}

function eicFromFixture(input: { rt_min: number[]; intensity: number[] }): LCMSEICData {
  return {
    target_mz: 0,
    tolerance: 0.02,
    rt_min: input.rt_min,
    intensity: input.intensity,
    polarity: input.rt_min.map(() => "positive"),
    best: { rt_min: null, intensity: 0, mz: null, spectrum_id: null, polarity: "positive" },
    n_scans: input.rt_min.length,
  };
}

function spectrumFromFixture(mz: number[], intensity: number[]): SpectrumData {
  return {
    meta: {
      spectrum_id: "fixture",
      rt_min: 0,
      tic: intensity.reduce((sum, v) => sum + v, 0),
      polarity: "positive",
      n_peaks: mz.length,
    },
    mz,
    intensity,
    labels: [],
  };
}

function featureRowFromFixture(raw: Record<string, unknown>): LCMSFeatureRow {
  return {
    id: String(raw.id),
    eicPlotId: String(raw.eic_plot_id ?? raw.id),
    session_id: (raw.session_id as string | null) ?? null,
    sourceFile: String(raw.source_file ?? ""),
    mz: Number(raw.mz),
    tolerance: Number(raw.tolerance ?? 0.02),
    polarity: (raw.polarity as string | null) ?? null,
    rtStart: Number(raw.rt_start ?? raw.rt_apex ?? 0),
    rtApex: Number(raw.rt_apex ?? 0),
    rtEnd: Number(raw.rt_end ?? raw.rt_apex ?? 0),
    height: Number(raw.height ?? 0),
    area: Number(raw.area ?? 0),
    baseline: Number(raw.baseline ?? 0),
    nPoints: Number(raw.n_points ?? 0),
    source: ((raw.source as LCMSFeatureRow["source"]) ?? "manual"),
    label: (raw.label as string | undefined) ?? undefined,
    expectedProduct: (raw.expected_product as string | undefined) ?? undefined,
    annotation: (raw.annotation as string | undefined) ?? undefined,
    createdAt: String(raw.created_at ?? "2026-01-01T00:00:00Z"),
  };
}

describe("cross-language fixture: integrateEICPeak", () => {
  const fixture = load("integrate_eic_peak.json");
  for (const c of fixture.cases) {
    it(c.name, () => {
      const result = integrateEICPeak(eicFromFixture(c.input), c.input.reference_rt ?? null);
      expect(result).not.toBeNull();
      // Map TS camelCase output to snake_case keys used by fixtures.
      const snake: Record<string, number> = {
        rt_start: result!.rtStart,
        rt_apex: result!.rtApex,
        rt_end: result!.rtEnd,
        height: result!.height,
        area: result!.area,
        baseline: result!.baseline,
        n_points: result!.nPoints,
      };
      for (const [key, expected] of Object.entries(c.expected)) {
        expect(snake[key]).toBeCloseTo(expected as number, 6);
      }
    });
  }
});

describe("cross-language fixture: buildKendrickPoints", () => {
  const fixture = load("kendrick.json");
  for (const c of fixture.cases) {
    it(c.name, () => {
      const spectrum = spectrumFromFixture(c.input.mz, c.input.intensity);
      const result = buildKendrickPoints(
        spectrum,
        c.input.repeat_mass,
        c.input.min_rel_intensity,
        c.input.tolerance_value,
        c.input.tolerance_unit,
        c.input.min_series_points,
      );
      if (c.expected.series_count !== undefined) {
        expect(result.series).toHaveLength(c.expected.series_count);
      }
      if (c.expected.series_0_count !== undefined) {
        expect(result.series[0].count).toBe(c.expected.series_0_count);
      }
    });
  }
});

describe("cross-language fixture: groupFeatureRowsForMatrix", () => {
  const fixture = load("comparison_matrix.json");
  for (const c of fixture.cases) {
    it(c.name, () => {
      const rows = (c.input.rows as Record<string, unknown>[]).map(featureRowFromFixture);
      const result = groupFeatureRowsForMatrix(rows, [], {
        metric: c.input.metric,
        groupMode: c.input.group_mode,
        mzTolerance: c.input.mz_tolerance,
      });
      if (c.expected.group_count !== undefined) {
        expect(result.groups).toHaveLength(c.expected.group_count);
      }
      if (c.expected.members !== undefined) {
        const members = result.groups
          .map((g) => g.rows.map((r) => r.id).sort())
          .sort((a, b) => a[0].localeCompare(b[0]));
        const expectedMembers = (c.expected.members as string[][]).map((m) => [...m].sort()).sort(
          (a, b) => a[0].localeCompare(b[0]),
        );
        expect(members).toEqual(expectedMembers);
      }
      if (c.expected.headline_row_id !== undefined) {
        const cell = Object.values(result.groups[0].cells)[0];
        expect(cell.row.id).toBe(c.expected.headline_row_id);
      }
      if (c.expected.collision_ids !== undefined) {
        const cell = Object.values(result.groups[0].cells)[0];
        expect(cell.collisions.map((r) => r.id).sort()).toEqual(
          [...(c.expected.collision_ids as string[])].sort(),
        );
      }
    });
  }
});
