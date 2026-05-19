import type { LCMSEICData, LCMSSessionSummary, SpectrumData } from "../../../api";
import {
  PROTON_MASS,
  type LCMSFeatureRow,
  type PolymerUiSettings,
} from "../../analysis";

export function spectrumFixture(mz: number[], intensity: number[]): SpectrumData {
  return {
    meta: {
      spectrum_id: "scan-1",
      rt_min: 1,
      tic: intensity.reduce((sum, value) => sum + value, 0),
      polarity: "positive",
      n_peaks: mz.length,
    },
    mz,
    intensity,
    labels: [],
  };
}

export function eicFixture(rt_min: number[], intensity: number[]): LCMSEICData {
  return {
    target_mz: 101.0073,
    tolerance: 0.02,
    rt_min,
    intensity,
    polarity: rt_min.map(() => "positive"),
    best: {
      rt_min: null,
      intensity: 0,
      mz: null,
      spectrum_id: null,
      polarity: "positive",
    },
    n_scans: rt_min.length,
  };
}

export function polymerSettingsFixture(partial?: Partial<PolymerUiSettings>): PolymerUiSettings {
  return {
    shared: {
      enabled: true,
      monomers_text: "Test 100.000000",
      bond_delta: 0,
      extra_delta: 0,
      charges: "1",
      decarb: false,
      oxid: false,
      h2o_loss: false,
      cluster: true,
      max_dp: 1,
      tol_value: 0.02,
      tol_unit: "Da",
      min_rel_int: 0,
    },
    positive: {
      adduct_mass: PROTON_MASS,
      cluster_adduct_mass: PROTON_MASS,
      adduct_na: false,
      adduct_k: false,
      adduct_cl: false,
      adduct_formate: false,
      adduct_acetate: false,
    },
    negative: {
      adduct_mass: -PROTON_MASS,
      cluster_adduct_mass: -PROTON_MASS,
      adduct_na: false,
      adduct_k: false,
      adduct_cl: false,
      adduct_formate: false,
      adduct_acetate: false,
    },
    monomers: [],
    ...partial,
  };
}

export function featureRowFixture(partial: Partial<LCMSFeatureRow>): LCMSFeatureRow {
  return {
    id: partial.id ?? "row",
    eicPlotId: partial.eicPlotId ?? "plot",
    session_id: partial.session_id ?? null,
    sourceFile: partial.sourceFile ?? "file-a.mzML",
    mz: partial.mz ?? 101.0073,
    tolerance: partial.tolerance ?? 0.02,
    polarity: partial.polarity ?? "positive",
    rtStart: partial.rtStart ?? 1,
    rtApex: partial.rtApex ?? 1.1,
    rtEnd: partial.rtEnd ?? 1.2,
    height: partial.height ?? 100,
    area: partial.area ?? 200,
    baseline: partial.baseline ?? 0,
    nPoints: partial.nPoints ?? 3,
    source: partial.source ?? "manual",
    label: partial.label,
    expectedProduct: partial.expectedProduct,
    annotation: partial.annotation,
    createdAt: partial.createdAt ?? "2026-01-01T00:00:00.000Z",
  };
}

export const sessionFixtures: LCMSSessionSummary[] = [
  {
    session_id: "s1",
    display_name: "Sample 1",
    path: "a.mzML",
    ms1_count: 1,
    rt_min: 0,
    rt_max: 1,
    polarities: ["positive"],
    stats: {},
  },
  {
    session_id: "s2",
    display_name: "Sample 2",
    path: "b.mzML",
    ms1_count: 1,
    rt_min: 0,
    rt_max: 1,
    polarities: ["positive"],
    stats: {},
  },
];
