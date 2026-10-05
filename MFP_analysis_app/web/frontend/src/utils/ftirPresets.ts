import type { FTIRPreprocessOptions } from "../api";

export const FTIR_PRESETS: Record<string, Partial<FTIRPreprocessOptions>> = {
  "KBr disc": { smoothing_window: 5, poly_order: 2, baseline: "asls", normalize: "max", baseline_lambda: 100000, baseline_p: 0.01 },
  "ATR sample": { smoothing_window: 5, poly_order: 2, baseline: "rubberband", normalize: "vector", atr_correction: true, atr_n_crystal: 1.5 },
  "Polymer thin film": { smoothing_window: 5, poly_order: 2, baseline: "airpls", normalize: "snv" },
  "Raw film": { smoothing_window: 0, poly_order: 2, baseline: "none", normalize: "none" },
};
