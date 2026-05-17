/**
 * Thin typed wrapper around the FastAPI backend.
 */

export interface LCMSUVMeta {
  available: boolean;
  filename?: string;
  path?: string;
  n_points?: number;
  rt_min?: number;
  rt_max?: number;
  x_col?: string;
  y_col?: string;
  x_label?: string;
  y_label?: string;
  unit_guess?: string;
  warnings?: string[];
}

export interface LCMSSessionSummary {
  session_id: string;
  display_name: string;
  path: string;
  ms1_count: number;
  rt_min: number | null;
  rt_max: number | null;
  polarities: string[];
  stats: Record<string, unknown>;
  uv?: LCMSUVMeta;
}

export interface UVPeak {
  rt_min: number;
  signal: number;
}

export type UVChromatogramResponse =
  | {
      available: false;
      reason: string;
    }
  | {
      available: true;
      meta: LCMSUVMeta;
      rt_min: number[];
      signal: number[];
      peaks: UVPeak[];
    };

export interface TICData {
  rt_min: number[];
  tic: number[];
  polarity: (string | null)[];
}

export interface SpectrumLabel {
  mz: number;
  intensity: number;
  text?: string;
  kind?: string;
  abs_err?: number;
  source?: "auto" | "polymer";
  peak_index?: number;
}

export interface PolymerSettings {
  enabled: boolean;
  monomers_text: string;
  bond_delta: number;
  extra_delta: number;
  adduct_mass: number;
  cluster_adduct_mass: number;
  adduct_na: boolean;
  adduct_k: boolean;
  adduct_cl: boolean;
  adduct_formate: boolean;
  adduct_acetate: boolean;
  charges: string;
  decarb: boolean;
  oxid: boolean;
  h2o_loss?: boolean;
  cluster: boolean;
  max_dp: number;
  tol_value: number;
  tol_unit: "Da" | "ppm";
  min_rel_int: number;
}

export interface SpectrumData {
  meta: {
    spectrum_id: string;
    rt_min: number;
    rt_max?: number;
    rt_start?: number;
    rt_end?: number;
    tic: number;
    polarity: string | null;
    n_peaks: number;
    n_scans?: number;
    bin_width?: number;
    merge_mode?: string;
  };
  mz: number[];
  intensity: number[];
  labels: SpectrumLabel[];
  polymer_labels?: SpectrumLabel[];
}

export interface LCMSFindMzResponse {
  target_mz: number;
  tolerance: number;
  n_scans: number;
  best: {
    rt_min: number | null;
    intensity: number;
    mz: number | null;
    spectrum_id: string | null;
    polarity: string | null;
  };
}

export interface LCMSEICData {
  target_mz: number;
  tolerance: number;
  rt_min: number[];
  intensity: number[];
  polarity: (string | null)[];
  best: LCMSFindMzResponse["best"];
  n_scans: number;
}

export interface LCMSRegionSpectrumData {
  rt_min: number;
  rt_max: number;
  bin_width: number;
  n_scans: number;
  mz: number[];
  intensity: number[];
  polymer_labels?: SpectrumLabel[];
}

export interface LCMSTICOverlayTrace extends TICData {
  session_id: string;
  display_name: string;
}

export interface LCMSTICOverlayResponse {
  traces: LCMSTICOverlayTrace[];
  missing_session_ids: string[];
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const j = await res.json();
      detail = (j && (j.detail ?? j.message)) || detail;
    } catch {
      // ignore
    }
    throw new Error(`HTTP ${res.status}: ${detail}`);
  }
  return res.json() as Promise<T>;
}

async function handleBlob(res: Response): Promise<Blob> {
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const j = await res.json();
      detail = (j && (j.detail ?? j.message)) || detail;
    } catch {
      // ignore
    }
    throw new Error(`HTTP ${res.status}: ${detail}`);
  }
  return res.blob();
}

// --- Plate Reader types ---

export interface PlateSessionSummary {
  session_id: string;
  display_name: string;
  path: string;
  sheets: string[];
}

export interface PlatePreview {
  columns: string[];
  rows: string[][];
  n_rows_total: number;
  n_cols_total: number;
  n_rows_preview: number;
}

export type MICPlotType = "bar" | "line" | "scatter";
export type MICControlStyle = "bars" | "line";

export interface MICRequestBody {
  sheet_name?: string | null;
  use_first_row_as_header: boolean;
  sample_rows: number[];
  control_rows: number[];
  blank_rows?: number[];
  subtract_blank?: boolean;
  concentration_columns: string[];
  tick_text: string;
  auto_tick_labels_power2: boolean;
  title: string;
  x_label: string;
  y_label: string;
  plot_type: MICPlotType;
  control_style: MICControlStyle;
}

export interface MICResult {
  config: {
    use_first_row_as_header: boolean;
    sample_rows: number[];
    control_rows: number[];
    blank_rows?: number[];
    subtract_blank?: boolean;
    concentration_columns: string[];
    tick_labels: string[];
    auto_tick_labels_power2: boolean;
    title: string;
    x_label: string;
    y_label: string;
    plot_type: MICPlotType;
    control_style: MICControlStyle;
    invert_x: boolean;
    sample_color: string;
    control_color: string;
  };
  result: {
    concentrations: number[];
    x_tick_labels: string[];
    sample_mean: number[];
    sample_std: number[];
    control_mean: number[] | null;
    control_std: number[] | null;
    blank_mean?: number[] | null;
    blank_std?: number[] | null;
  };
  sample_nan_ratio: number;
}

// --- FTIR types ---

export type FTIRYMode = "absorbance" | "transmittance";
export type FTIRBaseline = "none" | "polyfit" | "rubberband" | "asls" | "airpls";
export type FTIRNormalize = "none" | "max" | "area" | "snv" | "vector" | "min-max" | "msc";

export interface FTIRSessionSummary {
  session_id: string;
  display_name: string;
  path: string;
  n_points: number;
  wn_min: number | null;
  wn_max: number | null;
  y_min: number | null;
  y_max: number | null;
  y_mode: FTIRYMode;
  meta: Record<string, string | number>;
}

export interface FTIRPreprocessOptions {
  mode: FTIRYMode;
  smoothing_window: number;
  poly_order: number;
  baseline: FTIRBaseline;
  normalize: FTIRNormalize;
  baseline_lambda: number;
  baseline_p: number;
  mask_atmospheric: boolean;
  atr_correction: boolean;
  atr_n_crystal: number;
}

export interface FTIRSpectrumResponse {
  wn: number[];
  y: number[];
  n_points_full: number;
  n_points_returned: number;
  mode: FTIRYMode;
  preprocess: {
    smoothing_window: number;
    poly_order: number;
    baseline: FTIRBaseline;
    normalize: FTIRNormalize;
    baseline_lambda?: number;
    baseline_p?: number;
    mask_atmospheric?: boolean;
    atr_correction?: boolean;
    atr_n_crystal?: number;
  };
  atmospheric_regions?: Array<{ lo: number; hi: number; label: string }>;
}

export interface FTIRPeak {
  wn: number;
  y: number;
  prominence: number;
  width_cm1: number | null;
  left_base_wn: number | null;
  right_base_wn: number | null;
}

export interface FTIRAssignmentCandidate {
  id: string;
  band_id?: string;
  label: string;
  score: number;
  reasons: string[];
  group?: string;
  category?: string;
  subcategory?: string;
}

export interface FTIRAssignment {
  wn: number;
  peak_metrics: {
    wn: number;
    height: number | null;
    width: number | null;
    prominence: number | null;
    sharpness: number | null;
    shape: string;
    intensity: string;
  };
  status?: "auto" | "ambiguous" | "none";
  auto_band_id?: string | null;
  ambiguity_ratio?: number;
  override?: FTIRPeakLabelOverride | null;
  candidates: FTIRAssignmentCandidate[];
}

export interface FTIRPeaksResponse {
  peaks: FTIRPeak[];
  assignments: FTIRAssignment[] | null;
}

export interface FTIRPeaksRequest extends FTIRPreprocessOptions {
  min_prominence: number;
  min_height?: number | null;
  min_distance_cm1: number;
  top_n: number;
  second_derivative?: boolean;
  assign: boolean;
  assign_top_n?: number;
  assign_min_score?: number;
  excluded_categories?: string[];
  excluded_subcategories?: string[];
  ambiguity_ratio?: number;
}

export interface FTIRLibraryCategories {
  version: string;
  categories: string[];
  subcategories_by_category: Record<string, string[]>;
}

export interface FTIRPeakLabelOverride {
  band_id?: string | null;
  custom_text?: string | null;
  hidden?: boolean;
}

export interface FTIRSpectrumRequest extends FTIRPreprocessOptions {
  max_points: number;
}

export interface FTIRIntegrationRequest extends FTIRSpectrumRequest {
  region: [number, number];
  baseline_mode: "linear" | "horizontal" | "tangent";
}

export interface FTIRIntegrationResponse {
  region: [number, number];
  baseline_mode: string;
  area: number;
  height: number;
  fwhm: number | null;
  baseline_y_at_lo: number;
  baseline_y_at_hi: number;
  peak_wn: number;
}

export interface FTIRSubtractRequest extends FTIRSpectrumRequest {
  sid_b: string;
  k: number;
  region_minimize?: [number, number] | null;
}

export interface FTIRSubtractResponse {
  wn: number[];
  y: number[];
  sid_a: string;
  sid_b: string;
  k: number;
  n_points_full: number;
  n_points_returned: number;
}

export interface FTIRReferenceHit {
  name: string;
  label: string;
  correlation: number;
  ranking_method: string;
  source: string;
  reference: {
    wn: number[];
    y: number[];
  };
}

export interface FTIRMatchRequest extends FTIRSpectrumRequest {
  region?: [number, number] | null;
  derivative_order: 0 | 1 | 2;
  top_n: number;
}

export interface FTIRMatchResponse {
  hits: FTIRReferenceHit[];
  ranking_method: string;
  region: [number, number];
}

export interface FTIRFitRequest extends FTIRSpectrumRequest {
  region: [number, number];
  n_components: number;
  profile: "gauss" | "lorentz" | "voigt";
}

export interface FTIRFitComponent {
  index: number;
  amplitude: number;
  center: number;
  width: number;
  area: number;
  wn: number[];
  y: number[];
}

export interface FTIRFitResponse {
  region: [number, number];
  profile: string;
  components: FTIRFitComponent[];
  fit: {
    wn: number[];
    y: number[];
  };
  r2: number | null;
  residual_rms: number;
}

// --- Data Studio types ---

export interface DSSessionSummary {
  session_id: string;
  display_name: string;
  path: string;
  sheets: string[];
  sheet_name: string | null;
  header_row: number;
  decimal_comma: boolean;
  shape: [number, number] | null;
}

export interface DSSchema {
  columns: string[];
  dtypes: string[];
  numeric_columns: string[];
  n_rows: number;
  n_cols: number;
  schema_hash: string;
}

export interface DSTransformStep {
  type:
    | "select_columns"
    | "rename"
    | "to_numeric"
    | "fillna"
    | "normalize"
    | "baseline"
    | "log"
    | "rolling_mean";
  columns?: string[];
  mode?: string;
  mapping?: Record<string, string>;
  errors?: string;
  value?: unknown;
  method?: string;
  range?: [number, number];
  base?: number;
  offset?: number;
  window?: number;
  center?: boolean;
}

export interface DSPreview {
  columns: string[];
  rows: (string | number | null)[][];
  n_rows_preview: number;
  n_rows_total: number;
  n_cols_total: number;
  schema: DSSchema;
  warnings: string[];
}

export type DSNormMode = "none" | "minmax" | "zscore";

export interface DSPlotResponse {
  x: (number | string | null)[] | null;
  series: { name: string; y: (number | null)[] }[];
  meta: {
    x_col: string | null;
    x_is_numeric?: boolean;
    n_series: number;
    n_points_full?: number;
    n_points_returned?: number;
  };
}

export interface DSHistResponse {
  series: { name: string; counts: number[]; edges: number[] }[];
  meta: { bins: number };
}

export interface DSLoadOptions {
  sheet_name?: string | null;
  header_row: number;
  decimal_comma: boolean;
}

// --- AI Assistant types ---

export type AIProvider = "demo" | "openai" | "ollama";

export interface AIProviderStatus {
  openai: {
    available: boolean;
    sdk: boolean;
    api_key_env_var: string;
    has_api_key: boolean;
    default_model: string;
  };
  ollama: {
    available: boolean | null;
    base_url: string;
    default_model: string;
  };
  demo: { available: boolean };
  default: AIProvider;
  system_prompt: string;
}

export interface AIContextSession {
  session_id: string;
  display_name: string;
}

export type AIModuleName = "LCMS" | "FTIR" | "Plate Reader" | "Data Studio";

export type AIContextSnapshot = Record<
  AIModuleName,
  { sessions: AIContextSession[]; summary: string }
>;

export interface AIAssistantMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface AIChatRequest {
  messages: AIAssistantMessage[];
  provider: AIProvider;
  model?: string | null;
  active_module?: string | null;
  session_ids?: string[];
  include_context?: boolean;
  ollama_base_url?: string | null;
}

export interface AIAssistantResponsePayload {
  text: string;
  is_mock: boolean;
  used_context: boolean;
  model: string;
  error: string | null;
}

export interface AIChatResponse {
  response: AIAssistantResponsePayload;
  mode_hint: string;
  used_context: {
    active_module: string;
    loaded_filenames: string[];
    module_summary: string;
  } | null;
}

export const api = {
  health: () => fetch("/api/health").then((r) => handle<{ status: string }>(r)),

  ai: {
    status: () => fetch("/api/ai/status").then((r) => handle<AIProviderStatus>(r)),
    context: () => fetch("/api/ai/context").then((r) => handle<AIContextSnapshot>(r)),
    chat: (body: AIChatRequest) =>
      fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then((r) => handle<AIChatResponse>(r)),
  },

  dataStudio: {
    upload: (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      return fetch("/api/data-studio/sessions", { method: "POST", body: fd }).then((r) =>
        handle<DSSessionSummary>(r),
      );
    },
    list: () =>
      fetch("/api/data-studio/sessions").then((r) => handle<DSSessionSummary[]>(r)),
    get: (sid: string) =>
      fetch(`/api/data-studio/sessions/${sid}`).then((r) => handle<DSSessionSummary>(r)),
    remove: (sid: string) =>
      fetch(`/api/data-studio/sessions/${sid}`, { method: "DELETE" }).then((r) =>
        handle<{ deleted: boolean }>(r),
      ),
    updateLoad: (sid: string, body: DSLoadOptions) =>
      fetch(`/api/data-studio/sessions/${sid}/load`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then((r) => handle<DSSessionSummary>(r)),
    schema: (sid: string) =>
      fetch(`/api/data-studio/sessions/${sid}/schema`).then((r) => handle<DSSchema>(r)),
    preview: (sid: string, body: { transforms: DSTransformStep[]; max_rows?: number }) =>
      fetch(`/api/data-studio/sessions/${sid}/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then((r) => handle<DSPreview>(r)),
    plot: (
      sid: string,
      body: {
        transforms: DSTransformStep[];
        x_col: string | null;
        y_cols: string[];
        y_normalize?: DSNormMode;
        x_normalize?: DSNormMode;
        max_points?: number;
      },
    ) =>
      fetch(`/api/data-studio/sessions/${sid}/plot`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then((r) => handle<DSPlotResponse>(r)),
    histogram: (
      sid: string,
      body: { transforms: DSTransformStep[]; y_cols: string[]; bins?: number },
    ) =>
      fetch(`/api/data-studio/sessions/${sid}/histogram`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then((r) => handle<DSHistResponse>(r)),
  },

  ftir: {
    upload: (file: File, yMode: FTIRYMode = "transmittance") => {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("y_mode", yMode);
      return fetch("/api/ftir/sessions", { method: "POST", body: fd }).then((r) =>
        handle<FTIRSessionSummary>(r),
      );
    },
    list: () => fetch("/api/ftir/sessions").then((r) => handle<FTIRSessionSummary[]>(r)),
    get: (sid: string) =>
      fetch(`/api/ftir/sessions/${sid}`).then((r) => handle<FTIRSessionSummary>(r)),
    remove: (sid: string) =>
      fetch(`/api/ftir/sessions/${sid}`, { method: "DELETE" }).then((r) =>
        handle<{ deleted: boolean }>(r),
      ),
    spectrum: (sid: string, body: FTIRSpectrumRequest) =>
      fetch(`/api/ftir/sessions/${sid}/spectrum`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then((r) => handle<FTIRSpectrumResponse>(r)),
    peaks: (sid: string, body: FTIRPeaksRequest) =>
      fetch(`/api/ftir/sessions/${sid}/peaks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then((r) => handle<FTIRPeaksResponse>(r)),
    library: () =>
      fetch("/api/ftir/library").then((r) => handle<{ version: string; n_entries: number }>(r)),
    libraryCategories: () =>
      fetch("/api/ftir/library/categories").then((r) => handle<FTIRLibraryCategories>(r)),
    updatePeakLabel: (sid: string, wn: number, override: FTIRPeakLabelOverride | null) =>
      fetch(`/api/ftir/sessions/${sid}/peak-labels`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wn, override }),
      }).then((r) => handle<{ wn: number; key: string; override: FTIRPeakLabelOverride | null }>(r)),
    integrate: (sid: string, body: FTIRIntegrationRequest) =>
      fetch(`/api/ftir/sessions/${sid}/integrate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then((r) => handle<FTIRIntegrationResponse>(r)),
    subtract: (sid: string, body: FTIRSubtractRequest) =>
      fetch(`/api/ftir/sessions/${sid}/subtract`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then((r) => handle<FTIRSubtractResponse>(r)),
    match: (sid: string, body: FTIRMatchRequest) =>
      fetch(`/api/ftir/sessions/${sid}/match`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then((r) => handle<FTIRMatchResponse>(r)),
    fit: (sid: string, body: FTIRFitRequest) =>
      fetch(`/api/ftir/sessions/${sid}/fit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then((r) => handle<FTIRFitResponse>(r)),
  },

  plateReader: {
    upload: (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      return fetch("/api/plate-reader/sessions", { method: "POST", body: fd }).then((r) =>
        handle<PlateSessionSummary>(r),
      );
    },
    list: () => fetch("/api/plate-reader/sessions").then((r) => handle<PlateSessionSummary[]>(r)),
    get: (sid: string) =>
      fetch(`/api/plate-reader/sessions/${sid}`).then((r) => handle<PlateSessionSummary>(r)),
    loadSheet: (
      sid: string,
      body: { sheet_name?: string | null; use_first_row_as_header: boolean; max_rows?: number },
    ) =>
      fetch(`/api/plate-reader/sessions/${sid}/load`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then((r) => handle<PlatePreview>(r)),
    runMIC: (sid: string, body: MICRequestBody) =>
      fetch(`/api/plate-reader/sessions/${sid}/mic`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then((r) => handle<MICResult>(r)),
    remove: (sid: string) =>
      fetch(`/api/plate-reader/sessions/${sid}`, { method: "DELETE" }).then((r) =>
        handle<{ deleted: boolean }>(r),
      ),
  },

  lcms: {
    upload: (file: File, rtUnit: "minutes" | "seconds" = "minutes") => {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("rt_unit", rtUnit);
      return fetch("/api/lcms/sessions", { method: "POST", body: fd }).then((r) =>
        handle<LCMSSessionSummary>(r),
      );
    },
    loadFromPath: (path: string, displayName?: string, rtUnit?: "minutes" | "seconds") =>
      fetch("/api/lcms/sessions/from_path", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, display_name: displayName, rt_unit: rtUnit ?? "minutes" }),
      }).then((r) => handle<LCMSSessionSummary>(r)),
    list: () => fetch("/api/lcms/sessions").then((r) => handle<LCMSSessionSummary[]>(r)),
    get: (sid: string) =>
      fetch(`/api/lcms/sessions/${sid}`).then((r) => handle<LCMSSessionSummary>(r)),
    tic: (sid: string, polarity?: "positive" | "negative") => {
      const qs = polarity ? `?polarity=${polarity}` : "";
      return fetch(`/api/lcms/sessions/${sid}/tic${qs}`).then((r) => handle<TICData>(r));
    },
    spectrum: (
      sid: string,
      opts: {
        rt_min: number;
        polarity?: "positive" | "negative";
        top_n?: number;
        min_rel?: number;
        polymer?: PolymerSettings;
      },
    ) => {
      const params = new URLSearchParams({ rt_min: String(opts.rt_min) });
      if (opts.polarity) params.set("polarity", opts.polarity);
      if (opts.top_n !== undefined) params.set("top_n", String(opts.top_n));
      if (opts.min_rel !== undefined) params.set("min_rel", String(opts.min_rel));
      if (opts.polymer?.enabled)
        params.set("polymer_settings", JSON.stringify(opts.polymer));
      return fetch(`/api/lcms/sessions/${sid}/spectrum?${params.toString()}`).then((r) =>
        handle<SpectrumData>(r),
      );
    },
    findMz: (
      sid: string,
      opts: { mz: number; tolerance?: number; polarity?: "positive" | "negative" },
    ) => {
      const params = new URLSearchParams({ mz: String(opts.mz) });
      if (opts.tolerance !== undefined) params.set("tolerance", String(opts.tolerance));
      if (opts.polarity) params.set("polarity", opts.polarity);
      return fetch(`/api/lcms/sessions/${sid}/find-mz?${params.toString()}`).then((r) =>
        handle<LCMSFindMzResponse>(r),
      );
    },
    eic: (
      sid: string,
      body: { mz: number; tolerance?: number; polarity?: "positive" | "negative" },
    ) =>
      fetch(`/api/lcms/sessions/${sid}/eic`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then((r) => handle<LCMSEICData>(r)),
    regionSpectrum: (
      sid: string,
      body: {
        rt_min: number;
        rt_max: number;
        polarity?: "positive" | "negative";
        bin_width?: number;
        min_rel?: number;
        max_bins?: number;
        polymer?: PolymerSettings;
      },
    ) =>
      fetch(`/api/lcms/sessions/${sid}/region-spectrum`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...body,
          polymer: undefined,
          polymer_settings: body.polymer?.enabled ? body.polymer : undefined,
        }),
      }).then((r) => handle<LCMSRegionSpectrumData>(r)),
    ticOverlay: (body: { session_ids: string[]; polarity?: "positive" | "negative" }) =>
      fetch("/api/lcms/overlays/tic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then((r) => handle<LCMSTICOverlayResponse>(r)),
    exportTICOverlay: (body: {
      session_ids: string[];
      polarity?: "positive" | "negative";
    }) =>
      fetch("/api/lcms/exports/tic-overlay.csv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then(handleBlob),
    exportSpectrum: (
      sid: string,
      opts: { rt_min: number; polarity?: "positive" | "negative" },
    ) => {
      const params = new URLSearchParams({ rt_min: String(opts.rt_min) });
      if (opts.polarity) params.set("polarity", opts.polarity);
      return fetch(`/api/lcms/sessions/${sid}/exports/spectrum.csv?${params.toString()}`).then(
        handleBlob,
      );
    },
    exportLabels: (
      sid: string,
      opts?: { top_n?: number; min_rel?: number; polarity?: "positive" | "negative" },
    ) => {
      const params = new URLSearchParams();
      if (opts?.top_n !== undefined) params.set("top_n", String(opts.top_n));
      if (opts?.min_rel !== undefined) params.set("min_rel", String(opts.min_rel));
      if (opts?.polarity) params.set("polarity", opts.polarity);
      const qs = params.toString() ? `?${params.toString()}` : "";
      return fetch(`/api/lcms/sessions/${sid}/exports/labels.csv${qs}`).then(handleBlob);
    },
    exportUV: (sid: string) =>
      fetch(`/api/lcms/sessions/${sid}/exports/uv.csv`).then(handleBlob),
    attachUVFromPath: (sid: string, path: string) =>
      fetch(`/api/lcms/sessions/${sid}/uv/from_path`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      }).then((r) => handle<LCMSSessionSummary>(r)),
    uploadUV: (sid: string, file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      return fetch(`/api/lcms/sessions/${sid}/uv`, {
        method: "POST",
        body: fd,
      }).then((r) => handle<LCMSSessionSummary>(r));
    },
    uv: (
      sid: string,
      opts?: { top_n?: number; min_rel?: number; min_distance_min?: number },
    ) => {
      const params = new URLSearchParams();
      if (opts?.top_n !== undefined) params.set("top_n", String(opts.top_n));
      if (opts?.min_rel !== undefined) params.set("min_rel", String(opts.min_rel));
      if (opts?.min_distance_min !== undefined)
        params.set("min_distance_min", String(opts.min_distance_min));
      const qs = params.toString() ? `?${params.toString()}` : "";
      return fetch(`/api/lcms/sessions/${sid}/uv${qs}`).then((r) =>
        handle<UVChromatogramResponse>(r),
      );
    },
    removeUV: (sid: string) =>
      fetch(`/api/lcms/sessions/${sid}/uv`, { method: "DELETE" }).then((r) =>
        handle<{ deleted: boolean }>(r),
      ),
    remove: (sid: string) =>
      fetch(`/api/lcms/sessions/${sid}`, { method: "DELETE" }).then((r) =>
        handle<{ deleted: boolean }>(r),
      ),
  },
};
