/**
 * Thin typed wrapper around the FastAPI backend.
 */

let activeWorkspaceId: string =
  typeof window !== "undefined"
    ? window.localStorage.getItem("mfp_active_workspace") || "general"
    : "general";

export function getActiveWorkspaceId(): string {
  return activeWorkspaceId;
}

export function setActiveWorkspaceId(id: string): void {
  activeWorkspaceId = id;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem("mfp_active_workspace", id);
    } catch {
      // ignore
    }
  }
}

export function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (!headers.has("X-Workspace-Id")) {
    headers.set("X-Workspace-Id", activeWorkspaceId);
  }
  return window.fetch(input, { ...init, headers });
}

async function postFileUpload(
  endpoint: string,
  file: File,
  extraFields: Record<string, string> = {},
): Promise<Response> {
  const fd = new FormData();
  fd.append("file", file);
  for (const [key, value] of Object.entries(extraFields)) {
    fd.append(key, value);
  }
  return apiFetch(endpoint, { method: "POST", body: fd });
}

export type UploadProgressCallback = (loaded: number, total: number, pct: number) => void;

export function uploadFileWithProgress(
  endpoint: string,
  file: File,
  extraFields: Record<string, string> = {},
  onProgress?: UploadProgressCallback,
): Promise<Response> {
  if (!onProgress) {
    return postFileUpload(endpoint, file, extraFields);
  }

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", endpoint);
    xhr.setRequestHeader("X-Workspace-Id", activeWorkspaceId);

    if (xhr.upload) {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && onProgress) {
          const pct = (event.loaded / event.total) * 100;
          onProgress(event.loaded, event.total, pct);
        }
      };
    }

    xhr.onload = () => {
      const response = new Response(xhr.responseText, {
        status: xhr.status,
        statusText: xhr.statusText,
        headers: {
          "Content-Type": xhr.getResponseHeader("Content-Type") || "application/json",
        },
      });
      resolve(response);
    };

    xhr.onerror = () => reject(new TypeError("Network request failed"));
    xhr.ontimeout = () => reject(new TypeError("Network request timed out"));

    const fd = new FormData();
    fd.append("file", file);
    for (const [key, value] of Object.entries(extraFields)) {
      fd.append(key, value);
    }
    xhr.send(fd);
  });
}

export interface RestoreError {
  session_id: string;
  workspace_id: string;
  module: string;
  display_name: string;
  reason: string;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  created_at: string;
  last_active_at: string;
  session_count: number;
}

export interface LCMSUVMeta {
  available: boolean;
  filename?: string;
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
  uploaded_at?: string | null;
  // First 12 hex digits of the file's SHA-256: identical uploads share it.
  file_id?: string | null;
  experiment_tag?: string;
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

export interface CustomAdduct {
  id: string;
  name: string;
  mass: number;
  charge: number;
  enabled: boolean;
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
  custom_adducts?: CustomAdduct[];
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
    ignored_mz?: number[];
    ignored_tolerance?: number;
    ignored_peak_count?: number;
  };
  mz: number[];
  intensity: number[];
  labels: SpectrumLabel[];
  polymer_labels?: SpectrumLabel[];
}

export interface DeconvolutedChargeState {
  charge: number;
  observed_mz: number;
  theoretical_mz: number;
  intensity: number;
  error_da: number;
  error_ppm: number;
}

export interface DeconvolutedComponent {
  mass: number;
  total_intensity: number;
  score: number;
  method: string;
  charges: number[];
  charge_states: DeconvolutedChargeState[];
}

export interface LCMSDeconvolutionResult {
  components: DeconvolutedComponent[];
  zero_charge_spectrum: {
    mass: number[];
    intensity: number[];
  };
  summary: {
    total_components: number;
    deconvoluted_intensity: number;
    polarity: string;
    min_charge: number;
    max_charge: number;
  };
}

export interface DeconvoluteRequest {
  rt_min?: number;
  rt_max?: number;
  polarity?: "positive" | "negative";
  min_charge?: number;
  max_charge?: number;
  tolerance?: number;
  tolerance_unit?: "da" | "ppm";
  min_rel_intensity?: number;
  mz_min?: number;
  mz_max?: number;
}

export interface LCMSFindMzResponse {
  target_mz: number;
  tolerance: number;
  tolerance_value?: number;
  tolerance_unit?: "da" | "ppm";
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
  tolerance_value?: number;
  tolerance_unit?: "da" | "ppm";
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
    if (res.status === 413) {
      detail = "File is too large for the server to accept in one request.";
    }
    if (res.status === 404 && String(detail).toLowerCase().includes("session")) {
      detail = "Session not found or expired. Re-upload your file to continue.";
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

// --- Example datasets ---

export interface ExampleSummary {
  id: string;
  module: "lcms" | "ftir" | "plate_reader";
  route: string;
  title: string;
  description: string;
  try_this: string[];
}

export interface ExampleOpened {
  example_id: string;
  module: ExampleSummary["module"];
  route: string;
  session_ids: string[];
}

// --- Plate Reader types ---

export type PlateWell = string;
export type PlateLayoutSource = "saved" | "notes" | "empty";
export type PlateMetadata = Record<string, string | number | null>;
export type PlateGroupKind = "sample" | "reference";

export interface PlateDilution {
  top: number;
  unit: string;
  factor: number;
  direction: "columns" | "rows";
  first: number;
  last: number;
}

export interface PlateGroup {
  id: string;
  name: string;
  kind: PlateGroupKind;
  wells: PlateWell[];
  colour?: string | null;
}

export interface PlateLayout {
  dilution: PlateDilution;
  groups: PlateGroup[];
  growth_control: PlateWell[];
  blank: PlateWell[];
  excluded: PlateWell[];
}

export interface PlateSummary {
  session_id: string;
  workspace_id: string;
  display_name: string;
  experiment_tag: string;
  uploaded_at: string | null;
  metadata: PlateMetadata;
  notes: string[];
  label: string | null;
  values: Record<PlateWell, number | null>;
  layout: PlateLayout;
  layout_source: PlateLayoutSource;
}

export interface PlateWellValue {
  well: PlateWell;
  raw: number | null;
  value: number | null;
  percent_growth: number | null;
  excluded: boolean;
}

export interface PlatePoint {
  concentration: number;
  n: number;
  mean: number | null;
  sd: number | null;
  cv: number | null;
  percent_growth: number | null;
  wells: PlateWellValue[];
}

export interface FourPLFit {
  bottom: number;
  top: number;
  ic50: number;
  hill_slope: number;
  r_squared: number;
  curve_x: number[];
  curve_y: number[];
  bottom_se?: number | null;
  top_se?: number | null;
  ic50_se?: number | null;
  hill_slope_se?: number | null;
  ic50_in_range?: boolean;
}

export interface PlateGroupResult {
  id: string;
  name: string;
  kind: PlateGroupKind;
  colour: string | null;
  growth_control: {
    wells: PlateWell[];
    all_wells: PlateWell[];
    source: "own" | "plate";
    mean: number | null;
    sd: number | null;
    cv: number | null;
  };
  points: PlatePoint[];
  fit: FourPLFit | null;
}

export interface PlateCheck {
  id: string;
  level: "ok" | "warn" | "info";
  message: string;
  group?: string;
  well?: PlateWell;
}

export interface PlateAnalysis {
  blank: { used: boolean; mean: number | null; sd: number | null; n: number; wells: PlateWell[] };
  unit: string;
  groups: PlateGroupResult[];
  checks: PlateCheck[];
  excluded: PlateWell[];
}

export interface PlateTemplate {
  id: string;
  name: string;
  layout: PlateLayout;
  created_at: string;
  updated_at: string;
}

export interface PlateExperiment {
  experiment_tag: string;
  plates: {
    session_id: string;
    display_name: string;
    metadata: PlateMetadata;
    layout_source: PlateLayoutSource;
    analysis: PlateAnalysis;
  }[];
}

// --- FTIR types ---

export type FTIRYMode = "absorbance" | "transmittance";
export type FTIRBaseline = "none" | "polyfit" | "rubberband" | "asls" | "airpls";
export type FTIRNormalize = "none" | "max" | "area" | "snv" | "vector" | "min-max";

export interface FTIRSessionSummary {
  session_id: string;
  display_name: string;
  experiment_tag?: string;
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
  second_derivative?: number[];
  inverted_second_derivative?: number[];
  baseline?: number[];
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
  include_second_derivative?: boolean;
  include_baseline?: boolean;
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
  fwhm?: number;
  area: number;
  area_percent?: number;
  assignment?: string;
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
  second_derivative?: {
    wn: number[];
    d2y: number[];
    inverted: number[];
  };
  r2: number | null;
  residual_rms: number;
  // False when the optimiser failed: components are then only the starting guesses.
  converged?: boolean;
  fit_error?: string | null;
}
// --- AI Assistant types ---

export type AIProvider = "demo" | "openai" | "anthropic" | "ollama";

export interface AIProviderStatus {
  openai: {
    available: boolean;
    sdk: boolean;
    api_key_env_var: string;
    has_api_key: boolean;
    default_model: string;
  };
  anthropic?: {
    available: boolean;
    has_api_key?: boolean;
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
  health: () => apiFetch("/api/health").then((r) => handle<{ status: string }>(r)),

  ai: {
    status: () => apiFetch("/api/ai/status").then((r) => handle<AIProviderStatus>(r)),
    context: () => apiFetch("/api/ai/context").then((r) => handle<AIContextSnapshot>(r)),
    chat: (body: AIChatRequest) =>
      apiFetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then((r) => handle<AIChatResponse>(r)),
  },


  ftir: {
    // Without yMode the backend detects absorbance/transmittance from the file.
    upload: (file: File, yMode?: FTIRYMode) =>
      postFileUpload("/api/ftir/sessions", file, yMode ? { y_mode: yMode } : {}).then((r) =>
        handle<FTIRSessionSummary>(r),
      ),
    list: () => apiFetch("/api/ftir/sessions").then((r) => handle<FTIRSessionSummary[]>(r)),
    get: (sid: string) =>
      apiFetch(`/api/ftir/sessions/${sid}`).then((r) => handle<FTIRSessionSummary>(r)),
    remove: (sid: string) =>
      apiFetch(`/api/ftir/sessions/${sid}`, { method: "DELETE" }).then((r) =>
        handle<{ deleted: boolean }>(r),
      ),
    spectrum: (sid: string, body: FTIRSpectrumRequest) =>
      apiFetch(`/api/ftir/sessions/${sid}/spectrum`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then((r) => handle<FTIRSpectrumResponse>(r)),
    peaks: (sid: string, body: FTIRPeaksRequest) =>
      apiFetch(`/api/ftir/sessions/${sid}/peaks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then((r) => handle<FTIRPeaksResponse>(r)),
    library: () =>
      apiFetch("/api/ftir/library").then((r) => handle<{ version: string; n_entries: number }>(r)),
    libraryCategories: () =>
      apiFetch("/api/ftir/library/categories").then((r) => handle<FTIRLibraryCategories>(r)),
    updatePeakLabel: (sid: string, wn: number, override: FTIRPeakLabelOverride | null) =>
      apiFetch(`/api/ftir/sessions/${sid}/peak-labels`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wn, override }),
      }).then((r) => handle<{ wn: number; key: string; override: FTIRPeakLabelOverride | null }>(r)),
    integrate: (sid: string, body: FTIRIntegrationRequest) =>
      apiFetch(`/api/ftir/sessions/${sid}/integrate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then((r) => handle<FTIRIntegrationResponse>(r)),
    subtract: (sid: string, body: FTIRSubtractRequest) =>
      apiFetch(`/api/ftir/sessions/${sid}/subtract`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then((r) => handle<FTIRSubtractResponse>(r)),
    match: (sid: string, body: FTIRMatchRequest) =>
      apiFetch(`/api/ftir/sessions/${sid}/match`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then((r) => handle<FTIRMatchResponse>(r)),
    fit: (sid: string, body: FTIRFitRequest) =>
      apiFetch(`/api/ftir/sessions/${sid}/fit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then((r) => handle<FTIRFitResponse>(r)),
  },

  examples: {
    list: () => apiFetch("/api/examples").then((r) => handle<ExampleSummary[]>(r)),
    open: (id: string) =>
      apiFetch(`/api/examples/${encodeURIComponent(id)}/open`, { method: "POST" }).then((r) =>
        handle<ExampleOpened>(r),
      ),
  },

  plateReader: {
    upload: (file: File) =>
      postFileUpload("/api/plate-reader/sessions", file).then((r) => handle<PlateSummary>(r)),
    list: () => apiFetch("/api/plate-reader/sessions").then((r) => handle<PlateSummary[]>(r)),
    get: (sid: string) =>
      apiFetch(`/api/plate-reader/sessions/${sid}`).then((r) => handle<PlateSummary>(r)),
    saveLayout: (sid: string, layout: PlateLayout) =>
      apiFetch(`/api/plate-reader/sessions/${sid}/layout`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(layout),
      }).then((r) => handle<PlateLayout>(r)),
    analyse: (sid: string, body: { layout?: PlateLayout; subtract_blank: boolean; fit_4pl: boolean }) =>
      apiFetch(`/api/plate-reader/sessions/${sid}/analysis`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then((r) => handle<PlateAnalysis>(r)),
    workbook: (sid: string, subtractBlank: boolean) =>
      apiFetch(`/api/plate-reader/sessions/${sid}/workbook?subtract_blank=${subtractBlank}`).then(handleBlob),
    templates: () => apiFetch("/api/plate-reader/templates").then((r) => handle<PlateTemplate[]>(r)),
    saveTemplate: (name: string, layout: PlateLayout) =>
      apiFetch("/api/plate-reader/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, layout }),
      }).then((r) => handle<PlateTemplate>(r)),
    deleteTemplate: (id: string) =>
      apiFetch(`/api/plate-reader/templates/${id}`, { method: "DELETE" }).then((r) =>
        handle<{ deleted: boolean }>(r),
      ),
    experiment: (tag: string, subtractBlank: boolean) =>
      apiFetch(
        `/api/plate-reader/experiments/${encodeURIComponent(tag)}?subtract_blank=${subtractBlank}`,
      ).then((r) => handle<PlateExperiment>(r)),
    experimentWorkbook: (tag: string, subtractBlank: boolean) =>
      apiFetch(
        `/api/plate-reader/experiments/${encodeURIComponent(tag)}/workbook?subtract_blank=${subtractBlank}`,
      ).then(handleBlob),
    remove: (sid: string) =>
      apiFetch(`/api/plate-reader/sessions/${sid}`, { method: "DELETE" }).then((r) =>
        handle<{ deleted: boolean }>(r),
      ),
  },

  lcms: {
    // RT unit is read from the mzML itself; the Display-tab RT unit is presentation only.
    upload: (file: File, onProgress?: UploadProgressCallback) =>
      uploadFileWithProgress("/api/lcms/sessions", file, {}, onProgress).then((r) =>
        handle<LCMSSessionSummary>(r),
      ),
    list: () => apiFetch("/api/lcms/sessions").then((r) => handle<LCMSSessionSummary[]>(r)),
    get: (sid: string) =>
      apiFetch(`/api/lcms/sessions/${sid}`).then((r) => handle<LCMSSessionSummary>(r)),
    tic: (sid: string, polarity?: "positive" | "negative") => {
      const qs = polarity ? `?polarity=${polarity}` : "";
      return apiFetch(`/api/lcms/sessions/${sid}/tic${qs}`).then((r) => handle<TICData>(r));
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
      return apiFetch(`/api/lcms/sessions/${sid}/spectrum?${params.toString()}`).then((r) =>
        handle<SpectrumData>(r),
      );
    },
    findMz: (
      sid: string,
      opts: { mz: number; tolerance?: number; tolerance_unit?: "da" | "ppm"; polarity?: "positive" | "negative" },
    ) => {
      const params = new URLSearchParams({ mz: String(opts.mz) });
      if (opts.tolerance !== undefined) params.set("tolerance", String(opts.tolerance));
      if (opts.tolerance_unit !== undefined) params.set("tolerance_unit", opts.tolerance_unit);
      if (opts.polarity) params.set("polarity", opts.polarity);
      return apiFetch(`/api/lcms/sessions/${sid}/find-mz?${params.toString()}`).then((r) =>
        handle<LCMSFindMzResponse>(r),
      );
    },
    eic: (
      sid: string,
      body: { mz: number; tolerance?: number; tolerance_unit?: "da" | "ppm"; polarity?: "positive" | "negative" },
    ) =>
      apiFetch(`/api/lcms/sessions/${sid}/eic`, {
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
      apiFetch(`/api/lcms/sessions/${sid}/region-spectrum`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...body,
          polymer: undefined,
          polymer_settings: body.polymer?.enabled ? body.polymer : undefined,
        }),
      }).then((r) => handle<LCMSRegionSpectrumData>(r)),
    deconvolute: (sid: string, body: DeconvoluteRequest) =>
      apiFetch(`/api/lcms/sessions/${sid}/deconvolute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then((r) => handle<LCMSDeconvolutionResult>(r)),
    ticOverlay: (body: { session_ids: string[]; polarity?: "positive" | "negative" }) =>
      apiFetch("/api/lcms/overlays/tic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then((r) => handle<LCMSTICOverlayResponse>(r)),
    exportTICOverlay: (body: {
      session_ids: string[];
      polarity?: "positive" | "negative";
    }) =>
      apiFetch("/api/lcms/exports/tic-overlay.csv", {
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
      return apiFetch(`/api/lcms/sessions/${sid}/exports/spectrum.csv?${params.toString()}`).then(
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
      return apiFetch(`/api/lcms/sessions/${sid}/exports/labels.csv${qs}`).then(handleBlob);
    },
    exportUV: (sid: string) =>
      apiFetch(`/api/lcms/sessions/${sid}/exports/uv.csv`).then(handleBlob),
    uploadUV: (sid: string, file: File, rtUnit: "auto" | "minutes" | "seconds" = "auto") =>
      postFileUpload(`/api/lcms/sessions/${sid}/uv`, file, { rt_unit: rtUnit }).then((r) =>
        handle<LCMSSessionSummary>(r),
      ),
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
      return apiFetch(`/api/lcms/sessions/${sid}/uv${qs}`).then((r) =>
        handle<UVChromatogramResponse>(r),
      );
    },
    removeUV: (sid: string) =>
      apiFetch(`/api/lcms/sessions/${sid}/uv`, { method: "DELETE" }).then((r) =>
        handle<{ deleted: boolean }>(r),
      ),
    remove: (sid: string) =>
      apiFetch(`/api/lcms/sessions/${sid}`, { method: "DELETE" }).then((r) =>
        handle<{ deleted: boolean }>(r),
      ),
  },

  workspaces: {
    list: () => apiFetch("/api/workspaces").then((r) => handle<WorkspaceSummary[]>(r)),
    restoreErrors: (id: string) =>
      apiFetch(`/api/workspaces/${id}/restore-errors`).then((r) => handle<RestoreError[]>(r)),
    get: (id: string) => apiFetch(`/api/workspaces/${id}`).then((r) => handle<WorkspaceSummary>(r)),
    create: (name: string, id?: string) =>
      apiFetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, id }),
      }).then((r) => handle<WorkspaceSummary>(r)),
    getState: (id: string, module: string) =>
      apiFetch(`/api/workspaces/${id}/state/${module}`).then((r) =>
        handle<{ workspace_id: string; module: string; state: any }>(r),
      ),
    saveState: (id: string, module: string, state: any) =>
      apiFetch(`/api/workspaces/${id}/state/${module}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state }),
      }).then((r) => handle<{ status: string; workspace_id: string; module: string }>(r)),
  },

  experiments: {
    listTags: (workspaceId?: string) => {
      const qs = workspaceId ? `?workspace_id=${encodeURIComponent(workspaceId)}` : "";
      return apiFetch(`/api/experiments/tags${qs}`).then((r) => handle<string[]>(r));
    },
    getBundle: (tag: string, workspaceId?: string) => {
      const qs = workspaceId ? `?workspace_id=${encodeURIComponent(workspaceId)}` : "";
      return apiFetch(`/api/experiments/bundle/${encodeURIComponent(tag)}${qs}`).then((r) =>
        handle<ExperimentBundle>(r),
      );
    },
    updateSessionTag: (sessionId: string, experimentTag: string) =>
      apiFetch(`/api/experiments/sessions/${sessionId}/tag`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ experiment_tag: experimentTag }),
      }).then((r) => handle<SessionTagResponse>(r)),
    batchTag: (sessionIds: string[], experimentTag: string) =>
      apiFetch("/api/experiments/batch-tag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_ids: sessionIds, experiment_tag: experimentTag }),
      }).then((r) =>
        handle<{ status: string; experiment_tag: string; tagged_count: number; total_requested: number }>(r),
      ),
    getSessionInfo: (sessionId: string) =>
      apiFetch(`/api/experiments/sessions/${sessionId}`).then((r) => handle<SessionExperimentInfo>(r)),
  },
  publication: {
    downloadSIPackage: async (req: SIPackageRequest): Promise<Blob> => {
      const res = await apiFetch("/api/publication/si-package", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.blob();
    },
  },
};

export interface SIPackageRequest {
  experiment_tag?: string;
  session_ids?: string[];
  include_raw_files?: boolean;
}

export interface LinkedSessionItem {
  session_id: string;
  workspace_id: string;
  module: "lcms" | "ftir" | "plate_reader";
  display_name: string;
  file_path: string;
  experiment_tag: string;
  extra?: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface ExperimentBundle {
  experiment_tag: string;
  sessions: LinkedSessionItem[];
  counts: {
    lcms: number;
    ftir: number;
    plate_reader: number;
  };
}

export interface SessionTagResponse {
  status: string;
  session_id: string;
  experiment_tag: string;
  linked: ExperimentBundle;
}

export interface SessionExperimentInfo {
  session_id: string;
  experiment_tag: string;
  display_name: string;
  module: string;
  workspace_id: string;
  linked: ExperimentBundle;
}
