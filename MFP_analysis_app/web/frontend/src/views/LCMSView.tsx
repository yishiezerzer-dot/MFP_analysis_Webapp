import {
  ChangeEvent,
  DependencyList,
  DragEvent,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Plot from "react-plotly.js";
import type { PlotMouseEvent, PlotSelectionEvent, PlotlyHTMLElement } from "plotly.js";
import clsx from "clsx";
import { useLocation } from "react-router-dom";
import {
  api,
  LCMSEICData,
  LCMSRegionSpectrumData,
  LCMSTICOverlayTrace,
  LCMSFindMzResponse,
  LCMSSessionSummary,
  PolymerSettings,
  SpectrumData,
  SpectrumLabel,
  TICData,
  UVChromatogramResponse,
} from "../api";
import { PageHeaderContent, usePageHeader } from "../layout/PageHeader";
import { HelpOpenButton, HelpShell } from "../help/HelpShell";
import { getHelpModule } from "../help/registry";
import { usePlotlyTheme } from "../theme/ThemeProvider";
import { AlertBanner } from "../components/AlertBanner";
import { PaperFigureExportToolbar } from "../components/PaperFigureExportToolbar";
import { Tooltip } from "../components/Tooltip";
import { useBrowserAutomation } from "../automation/BrowserBridge";
import { useAutomationDispatch } from "../automation/registry";
import { useStoredState } from "../hooks/useStoredState";
import {
  exportPlotlyPublicationImage,
  PublicationExportFormat,
  PublicationExportSettings,
  publicationFilenameSuffix,
  sanitizeFilenamePart,
} from "../utils/publicationPlotExport";
import {
  buildExpectedProductHits,
  buildKendrickPoints,
  buildSpectrumIndex,
  eicSourceFile,
  eicSourceSessionId,
  EXPECTED_PRODUCT_MAX_DP,
  featureMatrixValue,
  groupFeatureRowsForMatrix,
  integrateEICPeak,
  KENDRICK_POINT_LIMIT,
  parseExpectedProductMonomers,
  polymerMonomerText,
  rowsToCsv,
  toApiPolymerSettings,
  type ExpectedProductHit,
  type ExpectedProductResolutionMode,
  type FeatureMatrixGroupMode,
  type FeatureMatrixMetric,
  type KendrickPoint,
  type LCMSFeatureRow,
  type LCMSEICMetadata,
  type LCMSEICPlot,
  type PolymerModeSettings,
  type PolymerMonomerCategory,
  type PolymerMonomerPreset,
  type PolymerSharedSettings,
  type PolymerUiSettings,
} from "../lcms/analysis";
import {
  cloneGraphSettings,
  DEFAULT_AXIS_LIMITS,
  DEFAULT_GRAPH_SETTINGS,
  GRAPH_SETTINGS_DEFAULT_STORAGE_KEY,
  loadGraphSettingsDefault,
  mergeChartSettings,
  mergeGraphSettings,
  saveGraphSettingsDefault,
  type AxisLimits,
  type ChartSettings,
  type EICOverlaySettings,
  type FrameMode,
  type GraphSettings,
  type LabelSettings,
} from "../lcms/settings";

let pendingPlotResizeFrame: number | null = null;

interface IgnoredRegionMass {
  mz: number;
  tolerance: number;
}

function schedulePlotResize() {
  if (typeof window === "undefined" || pendingPlotResizeFrame !== null) return;
  pendingPlotResizeFrame = window.requestAnimationFrame(() => {
    pendingPlotResizeFrame = null;
    window.dispatchEvent(new Event("resize"));
  });
}

function useContainerSize(
  ref: React.RefObject<HTMLDivElement>,
  fallbackHeight = 300,
): { height: number; width?: number; revision: number } {
  const [size, setSize] = useState<{ height: number; width?: number; revision: number }>({
    height: fallbackHeight,
    revision: 0,
  });
  const sizeRef = useRef<{ height: number; width?: number; revision: number }>({
    height: fallbackHeight,
    revision: 0,
  });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const animationFrames = new Set<number>();
    const timers = new Set<number>();
    const measure = () => {
      const rect = el.getBoundingClientRect();
      const h = Math.floor(rect.height);
      const w = Math.floor(rect.width);
      const height = h > 0 ? h : sizeRef.current.height;
      const width = w > 0 ? w : sizeRef.current.width;
      if (height === sizeRef.current.height && width === sizeRef.current.width) return;
      const next = { height, width, revision: sizeRef.current.revision + 1 };
      sizeRef.current = next;
      setSize(next);
      schedulePlotResize();
    };
    const queueMeasure = () => {
      const frame = window.requestAnimationFrame(() => {
        animationFrames.delete(frame);
        measure();
      });
      animationFrames.add(frame);
    };
    const queueSeveralMeasures = () => {
      queueMeasure();
      [80, 240].forEach((delay) => {
        const timer = window.setTimeout(() => {
          timers.delete(timer);
          queueMeasure();
        }, delay);
        timers.add(timer);
      });
    };
    const ro = new ResizeObserver(() => {
      queueMeasure();
    });
    const onTrustedWindowResize = (event: Event) => {
      if (!event.isTrusted) return;
      queueMeasure();
    };
    const onVisibilityOrFocus = () => {
      queueSeveralMeasures();
    };
    ro.observe(el);
    if (el.parentElement) ro.observe(el.parentElement);
    const pollTimer = window.setInterval(() => {
      if (document.visibilityState === "visible") queueMeasure();
    }, 300);
    window.addEventListener("resize", onTrustedWindowResize);
    window.addEventListener("orientationchange", onTrustedWindowResize);
    window.addEventListener("focus", onVisibilityOrFocus);
    document.addEventListener("visibilitychange", onVisibilityOrFocus);
    window.visualViewport?.addEventListener("resize", onVisibilityOrFocus);
    queueSeveralMeasures();
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", onTrustedWindowResize);
      window.removeEventListener("orientationchange", onTrustedWindowResize);
      window.removeEventListener("focus", onVisibilityOrFocus);
      document.removeEventListener("visibilitychange", onVisibilityOrFocus);
      window.visualViewport?.removeEventListener("resize", onVisibilityOrFocus);
      animationFrames.forEach((frame) => window.cancelAnimationFrame(frame));
      timers.forEach((timer) => window.clearTimeout(timer));
      window.clearInterval(pollTimer);
    };
  }, [ref, fallbackHeight]);
  return size;
}

function usePlotResizePulses(
  deps: DependencyList,
  plotRef?: { current: PlotlyHTMLElement | null },
) {
  useEffect(() => {
    const resizeNow = () => {
      schedulePlotResize();
      if (!plotRef?.current) return;
      resizePlotlyElement(plotRef.current);
    };
    resizeNow();
    const timers = [0, 80, 240, 500].map((delay) => window.setTimeout(resizeNow, delay));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
}

function resizePlotlyElement(graphDiv: PlotlyHTMLElement | null) {
  if (!graphDiv) return;
  void import("plotly.js-dist-min").then((plotlyModule) => {
    void plotlyModule.default.Plots.resize(graphDiv);
  });
}

function queuePlotlyElementResize(graphDiv: PlotlyHTMLElement | null) {
  resizePlotlyElement(graphDiv);
  [0, 80, 240, 500].forEach((delay) => {
    window.setTimeout(() => resizePlotlyElement(graphDiv), delay);
  });
}

type Polarity = "all" | "positive" | "negative";
type RtUnit = "minutes" | "seconds";
type TabId = "navigate" | "view" | "annotate" | "polymer";
type GraphId = "tic" | "uv" | "spectrum" | "eic";
type UVLabelOrientation = "horizontal" | "vertical";

interface UVTextLabel {
  id: string;
  kind: "polymer" | "custom";
  uv_rt_min: number;
  signal: number;
  text: string;
  source_ms_rt_min?: number;
  source_peak_index?: number;
  ax?: number;
  ay?: number;
  axRef?: "pixel" | "x";
  ayRef?: "pixel" | "y";
}

interface UVLabelAnchor {
  uv_rt_min: number;
  signal: number;
  source_peak_index?: number;
}

type AvailableUVChromatogram = Extract<UVChromatogramResponse, { available: true }>;

interface LCMSUVOverlayTrace {
  session_id: string;
  display_name: string;
  uv: AvailableUVChromatogram;
}

interface LCMSUVOverlayChartTrace extends LCMSUVOverlayTrace {
  labels: UVTextLabel[];
}

interface LCMSSpectrumOverlayTrace {
  session_id: string;
  display_name: string;
  spectrum: SpectrumData;
}

interface CustomUvLabelDraft {
  id?: string;
  text: string;
  rtText: string;
  snap: boolean;
}

interface UVLabelLayoutOffset {
  id: string;
  ax: number;
  ay: number;
  axRef?: "pixel" | "x";
  ayRef?: "pixel" | "y";
}

interface LCMSProject {
  id: string;
  name: string;
  createdAt: string;
}

type LCMSActiveProjectId = "__all" | "__unassigned" | string;

interface LCMSWorkspaceEnvelope {
  version: 1 | 2;
  module: "LCMS";
  createdAt: string;
  sessions: Array<{
    session_id: string;
    display_name: string;
    path?: string;
    uv?: { available: boolean; filename?: string; path?: string };
  }>;
  activeSessionId: string | null;
  projects?: LCMSProject[];
  sessionProjectById?: Record<string, string | null>;
  activeProjectId?: LCMSActiveProjectId;
  viewState: {
    polarity: Polarity;
    rtUnit: RtUnit;
    activeTab: TabId;
    showTIC: boolean;
    showSpectrum: boolean;
    showUV: boolean;
    selectedRt: number | null;
    selectedUvRt: number | null;
    uvOffset: number;
    uvOffsetText: string;
    graphSettings: GraphSettings;
    overlayTicEnabled: boolean;
    overlayUvEnabled: boolean;
    overlaySpectrumEnabled: boolean;
    overlayEicEnabled?: boolean;
    overlaySessionIds: string[];
  };
  analysisState: {
    annotateSpectrum: boolean;
    spectrumTopN: number;
    spectrumMinRel: number;
    transferMsToUv: boolean;
    uvTransferCount: number;
    uvProminence: number;
    uvMinDistance: number;
    snapUvLabels: boolean;
    uvBunchLabels?: boolean;
    uvBunchOffsets?: Record<string, { ax: number; ay: number }>;
    uvBunchHubOffset?: number;
    uvLabelOrientation: UVLabelOrientation;
    uvLabelStairXStep: number;
    uvLabelStairYStep: number;
    uvTextLabels: UVTextLabel[];
    uvTextLabelsBySessionId?: Record<string, UVTextLabel[]>;
    polymerSettings: PolymerUiSettings;
    eic?: LCMSEICData | null;
    eics?: LCMSEICPlot[];
    features?: LCMSFeatureRow[];
  };
}

interface LCMSProjectPersistenceEnvelope {
  version: 1;
  projects: LCMSProject[];
  sessionProjectById: Record<string, string | null>;
  activeProjectId: LCMSActiveProjectId;
}

const POLYMER_SETTINGS_DEFAULT_STORAGE_KEY = "mfp.lcms.polymerSettings.default";
const POLYMER_MONOMER_PRESETS_STORAGE_KEY = "mfp.lcms.polymerMonomerPresets";
const LCMS_PROJECTS_STORAGE_KEY = "mfp.lcms.projects";
const KENDRICK_SETTINGS_STORAGE_KEY = "mfp.lcms.kendrickSettings";
const LCMS_STORAGE_PREFIX = "mfp.lcms";

function isPolarity(value: unknown): value is Polarity {
  return value === "all" || value === "positive" || value === "negative";
}

function isRtUnit(value: unknown): value is RtUnit {
  return value === "minutes" || value === "seconds";
}

function isTabId(value: unknown): value is TabId {
  return value === "navigate" || value === "view" || value === "annotate" || value === "polymer";
}
const UV_PEAK_FETCH_LIMIT = 250;
const UV_LABEL_STAIR_X_STEP_MIN = 0.5;
const UV_LABEL_STAIR_Y_STEP_PX = 5;
const UV_LABEL_STAIR_BASE_Y_PX = 24;
const OVERLAY_PALETTE = [
  "#5573b9",
  "#0f766e",
  "#b45309",
  "#7c3aed",
  "#be123c",
  "#2563eb",
  "#4d7c0f",
  "#c2410c",
];

const BUILT_IN_POLYMER_MONOMERS: PolymerMonomerPreset[] = [
  { id: "hydroxy:glycolic-acid", category: "hydroxy", name: "Glycolic acid", abbr: "GA", mass: 76.016044, selected: false },
  { id: "hydroxy:lactic-acid", category: "hydroxy", name: "Lactic acid", abbr: "LA", mass: 90.031694, selected: false },
  { id: "hydroxy:phenyllactic-acid", category: "hydroxy", name: "Phenyllactic acid", abbr: "PLA", mass: 166.062994, selected: false },
  { id: "hydroxy:mandelic-acid", category: "hydroxy", name: "Mandelic acid", abbr: "MA", mass: 152.047344, selected: false },
  { id: "hydroxy:hydroxybutyric-acid", category: "hydroxy", name: "Hydroxybutyric acid", abbr: "HBA", mass: 104.047344, selected: false },
  { id: "amino:alanine", category: "amino", name: "Alanine", abbr: "Ala", mass: 89.047678, selected: false },
  { id: "amino:arginine", category: "amino", name: "Arginine", abbr: "Arg", mass: 174.111676, selected: false },
  { id: "amino:asparagine", category: "amino", name: "Asparagine", abbr: "Asn", mass: 132.053492, selected: false },
  { id: "amino:aspartic-acid", category: "amino", name: "Aspartic acid", abbr: "Asp", mass: 133.037508, selected: false },
  { id: "amino:cysteine", category: "amino", name: "Cysteine", abbr: "Cys", mass: 121.019749, selected: false },
  { id: "amino:glutamine", category: "amino", name: "Glutamine", abbr: "Gln", mass: 146.069142, selected: false },
  { id: "amino:glutamic-acid", category: "amino", name: "Glutamic acid", abbr: "Glu", mass: 147.053158, selected: false },
  { id: "amino:glycine", category: "amino", name: "Glycine", abbr: "Gly", mass: 75.032028, selected: false },
  { id: "amino:histidine", category: "amino", name: "Histidine", abbr: "His", mass: 155.069477, selected: false },
  { id: "amino:isoleucine", category: "amino", name: "Isoleucine", abbr: "Ile", mass: 131.094629, selected: false },
  { id: "amino:leucine", category: "amino", name: "Leucine", abbr: "Leu", mass: 131.094629, selected: false },
  { id: "amino:lysine", category: "amino", name: "Lysine", abbr: "Lys", mass: 146.105528, selected: false },
  { id: "amino:methionine", category: "amino", name: "Methionine", abbr: "Met", mass: 149.051049, selected: false },
  { id: "amino:phenylalanine", category: "amino", name: "Phenylalanine", abbr: "Phe", mass: 165.078979, selected: false },
  { id: "amino:proline", category: "amino", name: "Proline", abbr: "Pro", mass: 115.063329, selected: false },
  { id: "amino:serine", category: "amino", name: "Serine", abbr: "Ser", mass: 105.042593, selected: false },
  { id: "amino:threonine", category: "amino", name: "Threonine", abbr: "Thr", mass: 119.058243, selected: false },
  { id: "amino:tryptophan", category: "amino", name: "Tryptophan", abbr: "Trp", mass: 204.089878, selected: false },
  { id: "amino:tyrosine", category: "amino", name: "Tyrosine", abbr: "Tyr", mass: 181.073893, selected: false },
  { id: "amino:valine", category: "amino", name: "Valine", abbr: "Val", mass: 117.078979, selected: false },
  { id: "amino:ornithine", category: "amino", name: "Ornithine", abbr: "Orn", mass: 132.089878, selected: false },
  { id: "amino:dab", category: "amino", name: "2,4-Diaminobutyric acid", abbr: "DAB", mass: 118.074228, selected: false },
  { id: "amino:dpr", category: "amino", name: "2,3-Diaminopropionic acid", abbr: "DPR", mass: 104.058578, selected: false },
];

const DEFAULT_POLYMER_SHARED_SETTINGS: PolymerSharedSettings = {
  enabled: false,
  monomers_text: "",
  bond_delta: -18.010565,
  extra_delta: 0,
  charges: "1",
  decarb: false,
  oxid: false,
  h2o_loss: false,
  cluster: false,
  max_dp: 12,
  tol_value: 0.02,
  tol_unit: "Da",
  min_rel_int: 0.01,
};

const DEFAULT_POLYMER_UI_SETTINGS: PolymerUiSettings = {
  shared: DEFAULT_POLYMER_SHARED_SETTINGS,
  positive: {
    adduct_mass: 1.007276,
    cluster_adduct_mass: 1.007276,
    adduct_na: false,
    adduct_k: false,
    adduct_cl: false,
    adduct_formate: false,
    adduct_acetate: false,
  },
  negative: {
    adduct_mass: -1.007276,
    cluster_adduct_mass: -1.007276,
    adduct_na: false,
    adduct_k: false,
    adduct_cl: false,
    adduct_formate: false,
    adduct_acetate: false,
  },
  monomers: BUILT_IN_POLYMER_MONOMERS,
};

function clonePolymerMonomers(monomers: PolymerMonomerPreset[]): PolymerMonomerPreset[] {
  return monomers.map((monomer) => ({ ...monomer }));
}

function mergePolymerMonomerPresets(saved: PolymerMonomerPreset[]): PolymerMonomerPreset[] {
  const builtIns = clonePolymerMonomers(BUILT_IN_POLYMER_MONOMERS);
  const savedById = new Map(saved.map((monomer) => [monomer.id, monomer]));
  const merged = builtIns.map((monomer) => {
    const savedMonomer = savedById.get(monomer.id);
    return savedMonomer
      ? {
          ...monomer,
          abbr: savedMonomer.abbr || monomer.abbr,
          selected: Boolean(savedMonomer.selected),
        }
      : monomer;
  });
  for (const monomer of saved) {
    if (monomer.custom && !merged.some((existing) => existing.id === monomer.id)) {
      merged.push({
        ...monomer,
        selected: Boolean(monomer.selected),
        custom: true,
      });
    }
  }
  return merged;
}

function loadPolymerMonomerPresets(): PolymerMonomerPreset[] {
  const builtIns = clonePolymerMonomers(BUILT_IN_POLYMER_MONOMERS);
  if (typeof window === "undefined") return builtIns;
  try {
    const stored = window.localStorage.getItem(POLYMER_MONOMER_PRESETS_STORAGE_KEY);
    if (!stored) return builtIns;
    const saved = JSON.parse(stored) as PolymerMonomerPreset[];
    return mergePolymerMonomerPresets(saved);
  } catch {
    return builtIns;
  }
}

function savePolymerMonomerPresets(monomers: PolymerMonomerPreset[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(POLYMER_MONOMER_PRESETS_STORAGE_KEY, JSON.stringify(monomers));
}

function defaultPolymerUiSettings(): PolymerUiSettings {
  return {
    ...DEFAULT_POLYMER_UI_SETTINGS,
    shared: { ...DEFAULT_POLYMER_SHARED_SETTINGS },
    positive: { ...DEFAULT_POLYMER_UI_SETTINGS.positive },
    negative: { ...DEFAULT_POLYMER_UI_SETTINGS.negative },
    monomers: loadPolymerMonomerPresets(),
  };
}

function mergePolymerUiSettings(saved: Partial<PolymerUiSettings>): PolymerUiSettings {
  const base = defaultPolymerUiSettings();
  return {
    ...base,
    shared: { ...base.shared, ...(saved.shared ?? {}) },
    positive: { ...base.positive, ...(saved.positive ?? {}) },
    negative: { ...base.negative, ...(saved.negative ?? {}) },
    monomers: Array.isArray(saved.monomers)
      ? mergePolymerMonomerPresets(saved.monomers)
      : base.monomers,
  };
}

function loadPolymerUiSettings(): PolymerUiSettings {
  if (typeof window === "undefined") return defaultPolymerUiSettings();
  try {
    const stored = window.localStorage.getItem(POLYMER_SETTINGS_DEFAULT_STORAGE_KEY);
    if (!stored) return defaultPolymerUiSettings();
    return mergePolymerUiSettings(JSON.parse(stored) as Partial<PolymerUiSettings>);
  } catch {
    return defaultPolymerUiSettings();
  }
}

function savePolymerUiSettingsDefault(settings: PolymerUiSettings) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(POLYMER_SETTINGS_DEFAULT_STORAGE_KEY, JSON.stringify(settings));
}

function makeUvLabelId(sourceMsRt: number, uvRt: number, text: string, index: number): string {
  return `${sourceMsRt.toFixed(6)}:${uvRt.toFixed(6)}:${index}:${text}`;
}

function makeCustomUvLabelId(uvRt: number, text: string): string {
  return `custom:${uvRt.toFixed(6)}:${Date.now()}:${text}`;
}

function cleanLabelText(text: string): string {
  return text.replace(/\s+z=1\b/gi, "").replace(/\s{2,}/g, " ").trim();
}

function normalizeUvBunchText(text: string): string {
  return cleanLabelText(text).toLowerCase();
}

interface UvPlotAnnotation {
  x: number;
  y: number;
  text: string;
  textangle: "-90" | "0";
  showarrow: boolean;
  arrowhead?: number;
  arrowcolor?: string;
  ax?: number;
  axref?: "x" | "pixel";
  ay?: number;
  ayref?: "y" | "pixel";
  editable?: boolean;
  font: { size: number; color: string };
  bgcolor?: string;
  bordercolor?: string;
  borderpad?: number;
}

interface UvPlotShape {
  type: "line";
  xref: "x";
  yref: "y" | "paper";
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  line: { color: string; width: number; dash?: "dot" | "solid" };
}

interface UvBunchOptions {
  xOffset: number;
  scale: number;
  labelOrientation: UVLabelOrientation;
  connectorColor: string;
  connectorArrowColor: string;
  fontSize: number;
  fontColor: string;
  signalMin: number;
  signalMax: number;
  hubOffset: number;
  bunchOffsets: Record<string, { ax: number; ay: number }>;
}

function buildBunchedAnnotations(
  labels: UVTextLabel[],
  opts: UvBunchOptions,
): { annotations: UvPlotAnnotation[]; shapes: UvPlotShape[] } {
  const groups = new Map<string, UVTextLabel[]>();
  for (const label of labels) {
    const key = normalizeUvBunchText(label.text);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), label]);
  }

  const signalRange = Math.max(1, opts.signalMax - opts.signalMin);
  const annotations: UvPlotAnnotation[] = [];
  const shapes: UvPlotShape[] = [];

  [...groups.entries()].forEach(([key, group], groupIndex) => {
    const xs = group.map((label) => (label.uv_rt_min + opts.xOffset) * opts.scale);
    const convX = xs.reduce((sum, value) => sum + value, 0) / xs.length;
    const peakY = Math.max(...group.map((label) => label.signal));
    const isBunched = group.length > 1;
    const first = group[0];

    if (!isBunched) {
      annotations.push({
        x: (first.uv_rt_min + opts.xOffset) * opts.scale,
        y: first.signal,
        text: cleanLabelText(first.text),
        textangle: opts.labelOrientation === "vertical" ? "-90" : "0",
        showarrow: true,
        arrowhead: 0,
        arrowcolor: opts.connectorArrowColor,
        ax: first.ax ?? 0,
        axref: first.axRef === "x" ? "x" : "pixel",
        ayref: first.ayRef === "y" ? "y" : "pixel",
        ay: first.ay ?? (opts.labelOrientation === "vertical" ? -78 : -42),
        editable: false,
        font: { size: opts.fontSize, color: opts.fontColor },
      });
      return;
    }

    // Hub sits just above the tallest peak — lines from each peak converge here.
    const convY = peakY + signalRange * opts.hubOffset;
    group.forEach((label) => {
      shapes.push({
        type: "line",
        xref: "x",
        yref: "y",
        x0: (label.uv_rt_min + opts.xOffset) * opts.scale,
        y0: label.signal,
        x1: convX,
        y1: convY,
        line: { color: opts.connectorColor, width: 1, dash: "solid" },
      });
    });

    // Arrow from hub to the floating label. ax/ay are stored in bunchOffsets.
    const offset = opts.bunchOffsets[key];
    const defaultLabelY = convY + signalRange * (0.08 + (groupIndex % 4) * 0.035);
    annotations.push({
      x: convX,
      y: convY,
      text: cleanLabelText(first.text),
      textangle: opts.labelOrientation === "vertical" ? "-90" : "0",
      showarrow: true,
      arrowhead: 0,
      arrowcolor: opts.connectorArrowColor,
      ax: offset?.ax ?? convX,
      axref: "x",
      ay: offset?.ay ?? defaultLabelY,
      ayref: "y",
      editable: false,
      font: { size: opts.fontSize, color: opts.fontColor },
    });
  });

  return { annotations, shapes };
}

function normalizeLinkName(name: string): string {
  return name
    .replace(/^.*[\\/]/, "")
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .replace(/\b(uv|dad|pda|chrom|chromatogram|trace|lcms|mzml|csv|export)\b/g, " ")
    .replace(/[_\-.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function linkNameTokens(name: string): string[] {
  return normalizeLinkName(name)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length > 1);
}

function scoreUvSessionMatch(file: File, session: LCMSSessionSummary): number {
  const fileName = normalizeLinkName(file.name);
  const sessionName = normalizeLinkName(session.display_name || session.path || session.session_id);
  if (!fileName || !sessionName) return 0;
  if (fileName === sessionName) return 1;

  const fileCompact = fileName.replace(/\s+/g, "");
  const sessionCompact = sessionName.replace(/\s+/g, "");
  const contains =
    fileCompact.includes(sessionCompact) || sessionCompact.includes(fileCompact)
      ? Math.min(fileCompact.length, sessionCompact.length) / Math.max(fileCompact.length, sessionCompact.length)
      : 0;

  const fileTokens = new Set(linkNameTokens(file.name));
  const sessionTokens = new Set([
    ...linkNameTokens(session.display_name),
    ...linkNameTokens(session.path),
  ]);
  const shared = [...fileTokens].filter((token) => sessionTokens.has(token)).length;
  const union = new Set([...fileTokens, ...sessionTokens]).size || 1;
  return Math.max(contains, shared / union);
}

function matchUvFilesToSessions(
  files: File[],
  sessions: LCMSSessionSummary[],
  activeSid: string | null,
): Array<{ file: File; session: LCMSSessionSummary; score: number }> {
  const remaining = new Set(sessions.map((session) => session.session_id));
  const matches: Array<{ file: File; session: LCMSSessionSummary; score: number }> = [];
  for (const file of files) {
    const ranked = sessions
      .filter((session) => remaining.has(session.session_id))
      .map((session) => ({ file, session, score: scoreUvSessionMatch(file, session) }))
      .sort((a, b) => b.score - a.score);
    const best = ranked[0];
    if (best && (best.score >= 0.45 || (files.length === 1 && activeSid === best.session.session_id))) {
      matches.push(best);
      remaining.delete(best.session.session_id);
    }
  }
  return matches;
}

function makeProjectId(): string {
  return `project:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
}

function sessionsForProject(
  sessions: LCMSSessionSummary[],
  sessionProjectById: Record<string, string | null>,
  activeProjectId: LCMSActiveProjectId,
): LCMSSessionSummary[] {
  if (activeProjectId === "__all") return sessions;
  if (activeProjectId === "__unassigned") {
    return sessions.filter((session) => !sessionProjectById[session.session_id]);
  }
  return sessions.filter((session) => sessionProjectById[session.session_id] === activeProjectId);
}

function normalizeProjectPersistence(
  saved: Partial<LCMSProjectPersistenceEnvelope> | null | undefined,
): LCMSProjectPersistenceEnvelope {
  const projects: LCMSProject[] = [];
  const seenProjectIds = new Set<string>();
  for (const project of saved?.projects ?? []) {
    if (
      !project ||
      typeof project.id !== "string" ||
      typeof project.name !== "string" ||
      typeof project.createdAt !== "string" ||
      seenProjectIds.has(project.id)
    ) {
      continue;
    }
    projects.push(project);
    seenProjectIds.add(project.id);
  }

  const sessionProjectById: Record<string, string | null> = {};
  if (saved?.sessionProjectById && typeof saved.sessionProjectById === "object") {
    for (const [sid, projectId] of Object.entries(saved.sessionProjectById)) {
      if (!sid) continue;
      sessionProjectById[sid] =
        typeof projectId === "string" && seenProjectIds.has(projectId) ? projectId : null;
    }
  }

  const activeProjectId =
    saved?.activeProjectId === "__all" ||
    saved?.activeProjectId === "__unassigned" ||
    (typeof saved?.activeProjectId === "string" && seenProjectIds.has(saved.activeProjectId))
      ? saved.activeProjectId
      : "__all";

  return {
    version: 1,
    projects,
    sessionProjectById,
    activeProjectId,
  };
}

function loadProjectPersistence(): LCMSProjectPersistenceEnvelope {
  if (typeof window === "undefined") {
    return normalizeProjectPersistence(null);
  }
  try {
    const stored = window.localStorage.getItem(LCMS_PROJECTS_STORAGE_KEY);
    if (!stored) return normalizeProjectPersistence(null);
    return normalizeProjectPersistence(JSON.parse(stored) as Partial<LCMSProjectPersistenceEnvelope>);
  } catch {
    return normalizeProjectPersistence(null);
  }
}

function saveProjectPersistence(state: LCMSProjectPersistenceEnvelope) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LCMS_PROJECTS_STORAGE_KEY, JSON.stringify(state));
}

type LabeledSpectrumLabel = SpectrumLabel & { text: string };

function spectrumLabelsForUv(sp: SpectrumData): LabeledSpectrumLabel[] {
  const labeledByPeak = new Map<number, LabeledSpectrumLabel>();
  const candidates = [
    ...(sp.polymer_labels ?? []),
    ...sp.labels.filter((label) => label.source === "polymer"),
  ];
  for (const label of candidates) {
    if (!label.text) continue;
    const text = cleanLabelText(label.text);
    if (!text) continue;
    const key = label.peak_index ?? Number(label.mz.toFixed(4));
    const current = labeledByPeak.get(key);
    if (!current || label.intensity > current.intensity) {
      labeledByPeak.set(key, { ...label, text });
    }
  }
  return [...labeledByPeak.values()].sort((a, b) => b.intensity - a.intensity);
}

function parsePolymerLabelGroup(text: string): string {
  const core = text
    .replace(/\s+z=\d+.*$/i, "")
    .replace(/\s+\([^)]*\)\s*$/g, "")
    .trim();
  const groups = core
    .split(/\s+\+\s+/)
    .map((part) => part.match(/^\s*\d+-([A-Za-z][A-Za-z0-9]*)/)?.[1])
    .filter((value): value is string => Boolean(value));
  return groups.length > 0 ? [...new Set(groups)].join("+") : "custom";
}

function parseHydroxyCount(text: string, hydroxyAbbreviations: Set<string>): number {
  const core = text
    .replace(/\s+z=\d+.*$/i, "")
    .replace(/\s+\([^)]*\)\s*$/g, "")
    .trim();
  const matches = [...core.matchAll(/(\d+)-([A-Za-z][A-Za-z0-9]*)/g)];
  let hydroxyCount = 0;
  for (const match of matches) {
    const count = Number.parseInt(match[1], 10);
    const abbr = match[2].toUpperCase();
    if (Number.isFinite(count) && hydroxyAbbreviations.has(abbr)) {
      hydroxyCount += count;
    }
  }
  if (hydroxyCount > 0) return hydroxyCount;
  const fallback = matches.at(-1);
  return fallback ? Number.parseInt(fallback[1], 10) || 0 : 0;
}

function arrangeUvLabelsAsSeriesStairs(
  labels: UVTextLabel[],
  xOffsetMin: number,
  rtScale: number,
  xStepMin: number,
  yStepPx: number,
  yUnitsPerPx: number,
  uvRtMin: number[],
  uvSignal: number[],
  hydroxyAbbreviations: Set<string>,
): UVLabelLayoutOffset[] {
  const offsets: UVLabelLayoutOffset[] = [];
  for (const cluster of [labels]) {
    const clusterMinRt = Math.min(...cluster.map((label) => label.uv_rt_min));
    const clusterMaxRt = Math.max(...cluster.map((label) => label.uv_rt_min));
    const clusterCenterRt = (clusterMinRt + clusterMaxRt) / 2;
    const rtPad = Math.max(UV_LABEL_STAIR_X_STEP_MIN, (clusterMaxRt - clusterMinRt) * 0.05);
    const localSignals = uvRtMin
      .map((rt, index) => ({ rt, signal: uvSignal[index] }))
      .filter(
        (point) =>
          Number.isFinite(point.rt) &&
          Number.isFinite(point.signal) &&
          point.rt >= clusterMinRt - rtPad &&
          point.rt <= clusterMaxRt + rtPad,
      )
      .map((point) => point.signal);
    const localMaxSignal =
      localSignals.length > 0
        ? Math.max(...localSignals)
        : Math.max(...cluster.map((label) => label.signal));
    const grouped = new Map<number, UVTextLabel[]>();
    for (const label of cluster) {
      const key = parseHydroxyCount(label.text, hydroxyAbbreviations);
      grouped.set(key, [...(grouped.get(key) ?? []), label]);
    }
    const rows = [...grouped.entries()]
      .sort((a, b) => {
        if (a[0] !== b[0]) return a[0] - b[0];
        const aRt = Math.min(...a[1].map((label) => label.uv_rt_min));
        const bRt = Math.min(...b[1].map((label) => label.uv_rt_min));
        return aRt - bRt;
      })
      .map(([_hydroxyCount, rowLabels]) =>
        [...rowLabels].sort((a, b) => a.uv_rt_min - b.uv_rt_min || a.text.localeCompare(b.text)),
      );
    const groupGapSlots = 1;
    const totalSlots = rows.reduce(
      (sum, rowLabels, rowIndex) =>
        sum + rowLabels.length + (rowIndex > 0 ? groupGapSlots : 0),
      0,
    );
    const blockCenter = (Math.max(1, totalSlots) - 1) / 2;
    let slotCursor = 0;
    rows.forEach((rowLabels, rowIndex) => {
      if (rowIndex > 0) slotCursor += groupGapSlots;
      const rowStartSlot = slotCursor;
      rowLabels.forEach((label, labelIndex) => {
        const slot = rowStartSlot + labelIndex;
        offsets.push({
          id: label.id,
          ax:
            (clusterCenterRt +
              xOffsetMin +
              (slot - blockCenter) * xStepMin) *
            rtScale,
          ay:
            localMaxSignal +
            (UV_LABEL_STAIR_BASE_Y_PX - rowIndex * yStepPx) * yUnitsPerPx,
          axRef: "x",
          ayRef: "y",
        });
      });
      slotCursor += rowLabels.length;
    });
  }
  return offsets;
}

function withAlpha(color: string, alpha: number): string {
  const safeAlpha = Math.min(1, Math.max(0, alpha));
  const hex = color.trim();
  const short = /^#([0-9a-fA-F]{3})$/;
  const long = /^#([0-9a-fA-F]{6})$/;
  if (short.test(hex)) {
    const [, triplet] = short.exec(hex) ?? [];
    if (!triplet) return color;
    const r = parseInt(`${triplet[0]}${triplet[0]}`, 16);
    const g = parseInt(`${triplet[1]}${triplet[1]}`, 16);
    const b = parseInt(`${triplet[2]}${triplet[2]}`, 16);
    return `rgba(${r}, ${g}, ${b}, ${safeAlpha})`;
  }
  if (long.test(hex)) {
    const [, value] = long.exec(hex) ?? [];
    if (!value) return color;
    const r = parseInt(value.slice(0, 2), 16);
    const g = parseInt(value.slice(2, 4), 16);
    const b = parseInt(value.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${safeAlpha})`;
  }
  return color;
}

// --- Helpers -----------------------------------------------------------------

function nearestIndex(arr: number[], value: number): number {
  if (arr.length === 0) return -1;
  let best = 0;
  let bestDiff = Math.abs(arr[0] - value);
  for (let i = 1; i < arr.length; i += 1) {
    const d = Math.abs(arr[i] - value);
    if (d < bestDiff) {
      bestDiff = d;
      best = i;
    }
  }
  return best;
}

function formatRange(a: number | null, b: number | null): string {
  if (a == null || b == null) return "—";
  return `${a.toFixed(2)} – ${b.toFixed(2)}`;
}

function formatRt(rtMin: number, unit: RtUnit): string {
  return unit === "seconds" ? `${(rtMin * 60).toFixed(2)} s` : `${rtMin.toFixed(3)} min`;
}

function formatScanId(spectrumId: string): string {
  const m = /scan=(\d+)/i.exec(spectrumId);
  if (m) return m[1];
  const m2 = /scan\s+(\d+)/i.exec(spectrumId);
  if (m2) return m2[1];
  return spectrumId;
}

function axisRange(min: number | null, max: number | null): [number, number] | undefined {
  return min != null && max != null ? [min, max] : undefined;
}

function maxFinite(values: number[], fallback = 0): number {
  let max = -Infinity;
  for (const value of values) {
    if (Number.isFinite(value) && value > max) max = value;
  }
  return max === -Infinity ? fallback : max;
}

function axisTitle(text: string, size: number) {
  return { text, font: { size } };
}

function axisFrame(settings: ChartSettings) {
  const ticks: "" | "outside" = settings.showScaleBars ? "outside" : "";
  return {
    showline: settings.frameMode !== "none",
    mirror: settings.frameMode === "full",
    linecolor: "#46536a",
    linewidth: 1,
    ticks,
    ticklen: settings.showScaleBars ? 6 : 0,
    tickwidth: settings.showScaleBars ? 1 : 0,
    tickcolor: "#46536a",
  };
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadJson(value: unknown, filename: string) {
  downloadBlob(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
    filename,
  );
}

function readJsonFile<T>(file: File): Promise<T> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        resolve(JSON.parse(String(reader.result)) as T);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file."));
    reader.readAsText(file);
  });
}

function parseRegionIgnoredMasses(text: string, tolerance: number): IgnoredRegionMass[] {
  const tol = Math.max(0, Number.isFinite(tolerance) ? tolerance : 0);
  if (!text.trim() || tol <= 0) return [];
  return text
    .split(/[\s,;]+/)
    .map((part) => Number(part.trim()))
    .filter((mz, index, values) =>
      Number.isFinite(mz) && mz > 0 && values.findIndex((other) => Math.abs(other - mz) < 1e-9) === index,
    )
    .map((mz) => ({ mz, tolerance: tol }));
}

function isIgnoredRegionMz(mz: number, ignored: IgnoredRegionMass[]): boolean {
  return ignored.some((item) => Math.abs(mz - item.mz) <= item.tolerance);
}

function filterIgnoredRegionSpectrum(
  mzValues: number[],
  intensityValues: number[],
  labels: SpectrumLabel[],
  polymerLabels: SpectrumLabel[],
  ignored: IgnoredRegionMass[],
): {
  mz: number[];
  intensity: number[];
  labels: SpectrumLabel[];
  polymerLabels: SpectrumLabel[];
  ignoredPeakCount: number;
} {
  if (!ignored.length) {
    return { mz: mzValues, intensity: intensityValues, labels, polymerLabels, ignoredPeakCount: 0 };
  }
  const mz: number[] = [];
  const intensity: number[] = [];
  let ignoredPeakCount = 0;
  mzValues.forEach((value, index) => {
    if (isIgnoredRegionMz(value, ignored)) {
      ignoredPeakCount += 1;
      return;
    }
    mz.push(value);
    intensity.push(intensityValues[index] ?? 0);
  });
  return {
    mz,
    intensity,
    labels: labels.filter((label) => !isIgnoredRegionMz(label.mz, ignored)),
    polymerLabels: polymerLabels.filter((label) => !isIgnoredRegionMz(label.mz, ignored)),
    ignoredPeakCount,
  };
}

// --- Main view ---------------------------------------------------------------

export function LCMSView() {
  const browserAutomation = useBrowserAutomation();
  const actionDispatch = useAutomationDispatch();
  const persistedProjectState = useMemo(() => loadProjectPersistence(), []);

  // Sessions / data
  const [sessions, setSessions] = useState<LCMSSessionSummary[]>([]);
  const [sessionsHydrated, setSessionsHydrated] = useState(false);
  const [activeSid, setActiveSid] = useStoredState<string | null>(
    `${LCMS_STORAGE_PREFIX}.activeSessionId`,
    null,
    (value) => (typeof value === "string" ? value : null),
  );
  const [projects, setProjects] = useState<LCMSProject[]>(() => persistedProjectState.projects);
  const [sessionProjectById, setSessionProjectById] = useState<Record<string, string | null>>(
    () => persistedProjectState.sessionProjectById,
  );
  const [activeProjectId, setActiveProjectId] = useState<LCMSActiveProjectId>(
    () => persistedProjectState.activeProjectId,
  );
  const [tic, setTic] = useState<TICData | null>(null);
  const [spectrum, setSpectrum] = useState<SpectrumData | null>(null);
  const [uv, setUv] = useState<UVChromatogramResponse | null>(null);
  const [eicPlots, setEicPlots] = useState<LCMSEICPlot[]>([]);
  const [featureRows, setFeatureRows] = useState<LCMSFeatureRow[]>([]);
  const [ticOverlay, setTicOverlay] = useState<LCMSTICOverlayTrace[]>([]);
  const [uvOverlay, setUvOverlay] = useState<LCMSUVOverlayTrace[]>([]);
  const [spectrumOverlay, setSpectrumOverlay] = useState<LCMSSpectrumOverlayTrace[]>([]);
  const [overlayTicEnabled, setOverlayTicEnabled] = useStoredState(`${LCMS_STORAGE_PREFIX}.overlayTicEnabled`, false);
  const [overlayUvEnabled, setOverlayUvEnabled] = useStoredState(`${LCMS_STORAGE_PREFIX}.overlayUvEnabled`, false);
  const [overlaySpectrumEnabled, setOverlaySpectrumEnabled] = useStoredState(`${LCMS_STORAGE_PREFIX}.overlaySpectrumEnabled`, false);
  const [overlayEicEnabled, setOverlayEicEnabled] = useStoredState(`${LCMS_STORAGE_PREFIX}.overlayEicEnabled`, false);
  const [overlaySessionIds, setOverlaySessionIds] = useStoredState<string[]>(
    `${LCMS_STORAGE_PREFIX}.overlaySessionIds`,
    [],
    (value) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []),
  );

  // Filters / display
  const [polarity, setPolarity] = useStoredState<Polarity>(
    `${LCMS_STORAGE_PREFIX}.polarity`,
    "all",
    (value) => (isPolarity(value) ? value : "all"),
  );
  const [rtUnit, setRtUnit] = useStoredState<RtUnit>(
    `${LCMS_STORAGE_PREFIX}.rtUnit`,
    "minutes",
    (value) => (isRtUnit(value) ? value : "minutes"),
  );

  // Right sidebar state
  const [activeTab, setActiveTab] = useStoredState<TabId>(
    `${LCMS_STORAGE_PREFIX}.activeTab`,
    "navigate",
    (value) => (isTabId(value) ? value : "navigate"),
  );
  const [workflowHidden, setWorkflowHidden] = useStoredState(`${LCMS_STORAGE_PREFIX}.workflowHidden`, false);
  const [showPolymerControls, setShowPolymerControls] = useStoredState(`${LCMS_STORAGE_PREFIX}.showPolymerControls`, false);
  const [showConfidenceControls, setShowConfidenceControls] = useStoredState(`${LCMS_STORAGE_PREFIX}.showConfidenceControls`, false);
  const [showAlignmentDiagnostics, setShowAlignmentDiagnostics] = useStoredState(`${LCMS_STORAGE_PREFIX}.showAlignmentDiagnostics`, false);

  // Panel visibility
  const [showTIC, setShowTIC] = useStoredState(`${LCMS_STORAGE_PREFIX}.showTIC`, true);
  const [showSpectrum, setShowSpectrum] = useStoredState(`${LCMS_STORAGE_PREFIX}.showSpectrum`, true);
  const [showUV, setShowUV] = useStoredState(`${LCMS_STORAGE_PREFIX}.showUV`, true);
  const [regionIgnoredMzText, setRegionIgnoredMzText] = useStoredState(
    `${LCMS_STORAGE_PREFIX}.regionIgnoredMzText`,
    "",
  );
  const [regionIgnoredMzTolerance, setRegionIgnoredMzTolerance] = useStoredState(
    `${LCMS_STORAGE_PREFIX}.regionIgnoredMzTolerance`,
    0.2,
    (value) => {
      const n = Number(value);
      return Number.isFinite(n) && n > 0 ? n : 0.2;
    },
  );
  const regionIgnoredMasses = useMemo(
    () => parseRegionIgnoredMasses(regionIgnoredMzText, regionIgnoredMzTolerance),
    [regionIgnoredMzText, regionIgnoredMzTolerance],
  );

  // UV↔MS alignment
  const [uvOffsetText, setUvOffsetText] = useStoredState(`${LCMS_STORAGE_PREFIX}.uvOffsetText`, "0.000");
  const [uvOffset, setUvOffset] = useStoredState(`${LCMS_STORAGE_PREFIX}.uvOffset`, 0);
  const [autoAlignUv, setAutoAlignUv] = useStoredState(`${LCMS_STORAGE_PREFIX}.autoAlignUv`, false);

  // Annotate – spectrum
  const [annotateSpectrum, setAnnotateSpectrum] = useStoredState(`${LCMS_STORAGE_PREFIX}.annotateSpectrum`, true);
  const [spectrumTopN, setSpectrumTopN] = useStoredState(`${LCMS_STORAGE_PREFIX}.spectrumTopN`, 10);
  const [spectrumMinRel, setSpectrumMinRel] = useStoredState(`${LCMS_STORAGE_PREFIX}.spectrumMinRel`, 0.05);
  const [enableDragLabels, setEnableDragLabels] = useStoredState(`${LCMS_STORAGE_PREFIX}.enableDragLabels`, true);

  // Annotate – UV
  const [transferMsToUv, setTransferMsToUv] = useStoredState(`${LCMS_STORAGE_PREFIX}.transferMsToUv`, false);
  const [uvTransferCount, setUvTransferCount] = useStoredState(`${LCMS_STORAGE_PREFIX}.uvTransferCount`, 3);
  const [uvProminence, setUvProminence] = useStoredState(`${LCMS_STORAGE_PREFIX}.uvProminence`, 0.05);
  const [uvMinDistance, setUvMinDistance] = useStoredState(`${LCMS_STORAGE_PREFIX}.uvMinDistance`, 0.2);
  const [snapUvLabels, setSnapUvLabels] = useStoredState(`${LCMS_STORAGE_PREFIX}.snapUvLabels`, true);
  const [uvBunchLabels, setUvBunchLabels] = useStoredState(`${LCMS_STORAGE_PREFIX}.uvBunchLabels`, false);
  const [uvBunchOffsets, setUvBunchOffsets] = useStoredState<Record<string, { ax: number; ay: number }>>(
    `${LCMS_STORAGE_PREFIX}.uvBunchOffsets`,
    {},
    (value) => (value && typeof value === "object" ? value : {}),
  );
  const [uvBunchHubOffset, setUvBunchHubOffset] = useStoredState(`${LCMS_STORAGE_PREFIX}.uvBunchHubOffset`, 0.1);
  const [uvLabelOrientation, setUvLabelOrientation] =
    useStoredState<UVLabelOrientation>(
      `${LCMS_STORAGE_PREFIX}.uvLabelOrientation`,
      "vertical",
      (value) => (value === "horizontal" || value === "vertical" ? value : "vertical"),
    );
  const [uvLabelStairXStep, setUvLabelStairXStep] =
    useStoredState(`${LCMS_STORAGE_PREFIX}.uvLabelStairXStep`, UV_LABEL_STAIR_X_STEP_MIN);
  const [uvLabelStairYStep, setUvLabelStairYStep] =
    useStoredState(`${LCMS_STORAGE_PREFIX}.uvLabelStairYStep`, UV_LABEL_STAIR_Y_STEP_PX);

  // Annotate – overlay
  const [showOverlayLabels, setShowOverlayLabels] = useStoredState(`${LCMS_STORAGE_PREFIX}.showOverlayLabels`, false);
  const [multiDragOverlay, setMultiDragOverlay] = useStoredState(`${LCMS_STORAGE_PREFIX}.multiDragOverlay`, false);
  const [polymerSettings, setPolymerSettings] =
    useState<PolymerUiSettings>(() => loadPolymerUiSettings());
  const polymerSettingsRef = useRef(polymerSettings);
  useEffect(() => { polymerSettingsRef.current = polymerSettings; }, [polymerSettings]);
  const [uvLabelsBySessionId, setUvLabelsBySessionId] = useStoredState<Record<string, UVTextLabel[]>>(
    `${LCMS_STORAGE_PREFIX}.uvLabelsBySessionId`,
    {},
    (value) => (value && typeof value === "object" ? value : {}),
  );
  const uvTextLabels = useMemo(
    () => (activeSid ? uvLabelsBySessionId[activeSid] ?? [] : []),
    [activeSid, uvLabelsBySessionId],
  );
  const setUvTextLabels = useCallback(
    (next: UVTextLabel[] | ((prev: UVTextLabel[]) => UVTextLabel[])) => {
      if (!activeSid) return;
      setUvLabelsBySessionId((prev) => {
        const previousLabels = prev[activeSid] ?? [];
        const nextLabels =
          typeof next === "function" ? next(previousLabels) : next;
        return { ...prev, [activeSid]: nextLabels };
      });
    },
    [activeSid],
  );
  const setUvTextLabelsForSession = useCallback(
    (sid: string, next: UVTextLabel[] | ((prev: UVTextLabel[]) => UVTextLabel[])) => {
      setUvLabelsBySessionId((prev) => {
        const previousLabels = prev[sid] ?? [];
        const nextLabels = typeof next === "function" ? next(previousLabels) : next;
        return { ...prev, [sid]: nextLabels };
      });
    },
    [],
  );
  const clearUvLabelsForSession = useCallback((sid: string) => {
    setUvLabelsBySessionId((prev) => {
      if (!(sid in prev)) return prev;
      const next = { ...prev };
      delete next[sid];
      return next;
    });
  }, []);

  // View – region select
  const [regionSelect, setRegionSelect] = useState(false);
  const [selectedRegion, setSelectedRegion] = useState<{ rtMin: number; rtMax: number } | null>(null);

  // RT navigation
  const [selectedRt, setSelectedRt] = useStoredState<number | null>(
    `${LCMS_STORAGE_PREFIX}.selectedRt`,
    null,
    (value) => (typeof value === "number" && Number.isFinite(value) ? value : null),
  );
  const [selectedUvRt, setSelectedUvRt] = useStoredState<number | null>(
    `${LCMS_STORAGE_PREFIX}.selectedUvRt`,
    null,
    (value) => (typeof value === "number" && Number.isFinite(value) ? value : null),
  );
  const [rtJumpText, setRtJumpText] = useState("");

  // IO state
  const [busy, setBusy] = useState(false);
  const [uvBusy, setUvBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // Dialog / modal state
  const [findMzOpen, setFindMzOpen] = useState(false);
  const [eicOpen, setEicOpen] = useState(false);
  const [graphSettingsOpen, setGraphSettingsOpen] = useState(false);
  const [graphSettings, setGraphSettings] = useState<GraphSettings>(() =>
    loadGraphSettingsDefault(),
  );
  const [polymerDialogOpen, setPolymerDialogOpen] = useState(false);
  const [expectedProductsOpen, setExpectedProductsOpen] = useState(false);
  const [kendrickOpen, setKendrickOpen] = useState(false);
  const [featureTableOpen, setFeatureTableOpen] = useState(false);
  const [comparisonMatrixOpen, setComparisonMatrixOpen] = useState(false);
  const [highlightedEicPlotId, setHighlightedEicPlotId] = useState<string | null>(null);
  const eicPlotRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [customUvLabelDraft, setCustomUvLabelDraft] =
    useState<CustomUvLabelDraft | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);
  const uvFileRef = useRef<HTMLInputElement>(null);
  const workspaceFileRef = useRef<HTMLInputElement>(null);
  const eicPlotCounterRef = useRef(0);

  const location = useLocation();
  const [helpOpen, setHelpOpen] = useState(false);
  const helpModule = useMemo(() => getHelpModule(location.pathname), [location.pathname]);

  const dispatchUiAction = useCallback(
    (actionId: Parameters<typeof actionDispatch>[0], args: Record<string, unknown> = {}) => {
      void actionDispatch(actionId, args).catch((err) => setError(String(err)));
    },
    [actionDispatch],
  );

  /** Awaitable variant of dispatchUiAction. Surface the result to the caller
   * (e.g. CSV exports that need the payload) while still funneling errors
   * through setError. Returns `null` on failure. */
  const runUiAction = useCallback(
    async (
      actionId: Parameters<typeof actionDispatch>[0],
      args: Record<string, unknown> = {},
    ): Promise<Record<string, unknown> | null> => {
      try {
        return await actionDispatch(actionId, args);
      } catch (err) {
        setError(String(err));
        return null;
      }
    },
    [actionDispatch],
  );

  const featureRowsForAutomation = useCallback(
    (rows: LCMSFeatureRow[]) =>
      rows.map((row) => ({
        id: row.id,
        eic_plot_id: row.eicPlotId,
        session_id: row.session_id,
        source_file: row.sourceFile,
        mz: row.mz,
        tolerance: row.tolerance,
        polarity: row.polarity,
        rt_start: row.rtStart,
        rt_apex: row.rtApex,
        rt_end: row.rtEnd,
        height: row.height,
        area: row.area,
        baseline: row.baseline,
        n_points: row.nPoints,
        source: row.source,
        label: row.label,
        expected_product: row.expectedProduct,
        annotation: row.annotation,
        created_at: row.createdAt,
      })),
    [],
  );

  const downloadAutomationCsv = useCallback((payload: unknown, fallbackName: string) => {
    const data = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
    const csv = typeof data.csv === "string" ? data.csv : "";
    if (!csv) throw new Error("CSV export action did not return CSV text.");
    const filename = typeof data.filename === "string" ? data.filename : fallbackName;
    const contentType = typeof data.content_type === "string" ? data.content_type : "text/csv;charset=utf-8";
    downloadBlob(new Blob([csv], { type: contentType }), filename);
  }, []);

  const active = useMemo(
    () => sessions.find((s) => s.session_id === activeSid) ?? null,
    [sessions, activeSid],
  );
  const visibleEicPlots = useMemo(
    () =>
      activeSid
        ? eicPlots.filter((plot) => {
            const sourceSid = eicSourceSessionId(plot);
            return sourceSid == null || sourceSid === activeSid;
          })
        : [],
    [activeSid, eicPlots],
  );
  const projectSessions = useMemo(
    () => sessionsForProject(sessions, sessionProjectById, activeProjectId),
    [activeProjectId, sessionProjectById, sessions],
  );

  useEffect(() => {
    const projectIds = new Set(projects.map((project) => project.id));
    if (activeProjectId !== "__all" && activeProjectId !== "__unassigned" && !projectIds.has(activeProjectId)) {
      setActiveProjectId("__all");
    }
  }, [activeProjectId, projects]);

  useEffect(() => {
    saveProjectPersistence({
      version: 1,
      projects,
      sessionProjectById,
      activeProjectId,
    });
  }, [activeProjectId, projects, sessionProjectById]);

  useEffect(() => {
    if (!sessionsHydrated) return;
    setSessionProjectById((prev) => {
      const available = new Set(sessions.map((session) => session.session_id));
      const projectIds = new Set(projects.map((project) => project.id));
      const next: Record<string, string | null> = {};
      let changed = false;
      for (const session of sessions) {
        const current = prev[session.session_id] ?? null;
        next[session.session_id] = current && projectIds.has(current) ? current : null;
        if (next[session.session_id] !== prev[session.session_id]) changed = true;
      }
      for (const sid of Object.keys(prev)) {
        if (!available.has(sid)) changed = true;
      }
      return changed ? next : prev;
    });
  }, [projects, sessions, sessionsHydrated]);

  useEffect(() => {
    if (activeProjectId === "__all") return;
    const visible = sessionsForProject(sessions, sessionProjectById, activeProjectId);
    if (activeSid && visible.some((session) => session.session_id === activeSid)) return;
    setActiveSid(visible[0]?.session_id ?? null);
    setSpectrum(null);
    setSelectedRt(null);
    setSelectedUvRt(null);
  }, [activeProjectId, activeSid, sessionProjectById, sessions]);

  useEffect(() => {
    setOverlaySessionIds((prev) => {
      const scopedSessions = activeProjectId === "__all" ? sessions : projectSessions;
      const available = new Set(scopedSessions.map((session) => session.session_id));
      const kept = prev.filter((sid) => available.has(sid));
      if (kept.length > 0 || scopedSessions.length === 0) return kept;
      return scopedSessions.map((session) => session.session_id);
    });
  }, [activeProjectId, projectSessions, sessions]);

  const pol = polarity === "all" ? undefined : polarity;
  const activePolymerSettings = useMemo(
    () =>
      polarity === "all" || !polymerSettings.shared.enabled
        ? undefined
        : toApiPolymerSettings(polymerSettings, polarity),
    [polarity, polymerSettings],
  );

  const exportFeatureTableCsv = useCallback(
    async (rows: LCMSFeatureRow[]) => {
      const payload = await runUiAction("lcms.export_feature_table_csv", {
        rows: featureRowsForAutomation(rows),
      });
      if (payload) downloadAutomationCsv(payload, "lcms_feature_table.csv");
    },
    [downloadAutomationCsv, featureRowsForAutomation, runUiAction],
  );

  const exportComparisonMatrixCsv = useCallback(
    async (
      rows: LCMSFeatureRow[],
      options: {
        metric: FeatureMatrixMetric;
        groupMode: FeatureMatrixGroupMode;
        mzTolerance: number;
        normalizeRows: boolean;
      },
    ) => {
      const payload = await runUiAction("lcms.export_comparison_matrix_csv", {
        rows: featureRowsForAutomation(rows),
        metric: options.metric,
        group_mode: options.groupMode,
        mz_tolerance: options.mzTolerance,
        normalize_rows: options.normalizeRows,
      });
      if (payload) downloadAutomationCsv(payload, "lcms_comparison_matrix.csv");
    },
    [downloadAutomationCsv, featureRowsForAutomation, runUiAction],
  );

  const openComparisonMatrix = useCallback(async () => {
    // The Comparison Matrix dialog computes everything locally via
    // groupFeatureRowsForMatrix; no need to ask the backend to recompute
    // it on dialog open. Codex/in-app assistant invokes
    // lcms.build_comparison_matrix directly when it wants the JSON.
    try {
      await actionDispatch("lcms.open_dialog", { dialog: "comparison_matrix" });
    } catch (err) {
      setError(String(err));
    }
  }, [actionDispatch]);

  const openPolymerDialogWithMatch = useCallback(async () => {
    if (activeSid && spectrum && activePolymerSettings) {
      const result = (await runUiAction("lcms.match_polymers_for_spectrum", {
        session_id: activeSid,
        rt_min: spectrum.meta.rt_min,
        polarity: pol,
        settings: activePolymerSettings,
      })) as { labels?: SpectrumLabel[] } | null;
      if (result && Array.isArray(result.labels)) {
        setSpectrum((prev) =>
          prev
            ? { ...prev, labels: [...prev.labels.filter((label) => label.source !== "polymer"), ...result.labels!], polymer_labels: result.labels }
            : prev,
        );
      }
    }
    await runUiAction("lcms.open_dialog", { dialog: "polymer" });
  }, [activePolymerSettings, activeSid, pol, runUiAction, spectrum]);

  // The Expected Products and Kendrick dialogs compute everything locally
  // via buildExpectedProductHits / buildKendrickPoints. The dialog open
  // just toggles UI state — no backend warmup needed. Agents that want the
  // JSON call the corresponding action explicitly.
  const openExpectedProductsWithCompute = useCallback(async () => {
    try {
      await actionDispatch("lcms.open_dialog", { dialog: "expected_products" });
    } catch (err) {
      setError(String(err));
    }
  }, [actionDispatch]);

  const openKendrickWithCompute = useCallback(async () => {
    try {
      await actionDispatch("lcms.open_dialog", { dialog: "kendrick" });
    } catch (err) {
      setError(String(err));
    }
  }, [actionDispatch]);

  // --- data loading ---------------------------------------------------------

  useEffect(() => {
    api.lcms
      .list()
      .then((list) => {
        setSessions(list);
        setSessionsHydrated(true);
        setActiveSid((current) =>
          current && list.some((session) => session.session_id === current)
            ? current
            : list[0]?.session_id ?? null,
        );
      })
      .catch((err) => setError(String(err)));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    savePolymerMonomerPresets(polymerSettings.monomers);
  }, [polymerSettings.monomers]);

  const savePolymerDefaults = useCallback(() => {
    savePolymerUiSettingsDefault(polymerSettings);
    setInfo("Saved polymer matching defaults.");
  }, [polymerSettings]);

  const createProject = useCallback((providedName?: string) => {
    const name = providedName ?? window.prompt("Project name") ?? "";
    const trimmed = name.trim();
    if (!trimmed) return;
    const project: LCMSProject = {
      id: makeProjectId(),
      name: trimmed,
      createdAt: new Date().toISOString(),
    };
    setProjects((prev) => [...prev, project]);
    setActiveProjectId(project.id);
    return project;
  }, []);

  const deleteProject = useCallback((projectId: string) => {
    setProjects((prev) => prev.filter((project) => project.id !== projectId));
    setSessionProjectById((prev) => {
      const next = { ...prev };
      for (const [sid, assignedProjectId] of Object.entries(next)) {
        if (assignedProjectId === projectId) next[sid] = null;
      }
      return next;
    });
    setActiveProjectId((current) => (current === projectId ? "__unassigned" : current));
  }, []);

  const moveSessionToProject = useCallback((sessionId: string, projectId: string | null) => {
    setSessionProjectById((prev) => ({ ...prev, [sessionId]: projectId }));
  }, []);

  useEffect(() => {
    if (!activeSid) {
      setTic(null);
      return;
    }
    api.lcms
      .tic(activeSid, pol)
      .then(setTic)
      .catch((err) => setError(String(err)));
  }, [activeSid, pol]);

  useEffect(() => {
    if (!activeSid) {
      setUv(null);
      return;
    }
    api.lcms
      .uv(activeSid, {
        top_n: UV_PEAK_FETCH_LIMIT,
        min_rel: uvProminence,
        min_distance_min: uvMinDistance,
      })
      .then(setUv)
      .catch((err) => setError(String(err)));
  }, [activeSid, uvProminence, uvMinDistance]);

  useEffect(() => {
    if (!overlayTicEnabled || overlaySessionIds.length <= 1) {
      setTicOverlay([]);
      return;
    }
    api.lcms
      .ticOverlay({ session_ids: overlaySessionIds, polarity: pol })
      .then((payload) => setTicOverlay(payload.traces))
      .catch((err) => setError(String(err)));
  }, [overlaySessionIds, overlayTicEnabled, pol]);

  useEffect(() => {
    const ids = overlaySessionIds.filter((sid) => sid !== activeSid);
    if (!overlayUvEnabled || ids.length === 0) {
      setUvOverlay([]);
      return;
    }
    let cancelled = false;
    Promise.all(
      ids.map(async (sid) => {
        const session = sessions.find((item) => item.session_id === sid);
        try {
          const payload = await api.lcms.uv(sid, {
            top_n: UV_PEAK_FETCH_LIMIT,
            min_rel: uvProminence,
            min_distance_min: uvMinDistance,
          });
          if (payload.available !== true) return null;
          return {
            session_id: sid,
            display_name: session?.display_name ?? sid,
            uv: payload,
          };
        } catch {
          return null;
        }
      }),
    ).then((items) => {
      if (cancelled) return;
      setUvOverlay(items.filter((item): item is LCMSUVOverlayTrace => item !== null));
    });
    return () => {
      cancelled = true;
    };
  }, [activeSid, overlaySessionIds, overlayUvEnabled, sessions, uvMinDistance, uvProminence]);

  const uvOverlayWithLabels = useMemo<LCMSUVOverlayChartTrace[]>(
    () =>
      uvOverlay.map((trace) => ({
        ...trace,
        labels: uvLabelsBySessionId[trace.session_id] ?? [],
      })),
    [uvLabelsBySessionId, uvOverlay],
  );

  useEffect(() => {
    const ids = overlaySessionIds.filter((sid) => sid !== activeSid);
    if (!overlaySpectrumEnabled || selectedRt == null || ids.length === 0) {
      setSpectrumOverlay([]);
      return;
    }
    let cancelled = false;
    Promise.all(
      ids.map(async (sid) => {
        const session = sessions.find((item) => item.session_id === sid);
        try {
          const payload = await api.lcms.spectrum(sid, {
            rt_min: selectedRt,
            polarity: pol,
            top_n: spectrumTopN,
            min_rel: spectrumMinRel,
            polymer: activePolymerSettings,
          });
          return {
            session_id: sid,
            display_name: session?.display_name ?? sid,
            spectrum: payload,
          };
        } catch {
          return null;
        }
      }),
    ).then((items) => {
      if (cancelled) return;
      setSpectrumOverlay(
        items.filter((item): item is LCMSSpectrumOverlayTrace => item !== null),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [
    activePolymerSettings,
    activeSid,
    overlaySessionIds,
    overlaySpectrumEnabled,
    pol,
    selectedRt,
    sessions,
    spectrumMinRel,
    spectrumTopN,
  ]);

  // --- callbacks ------------------------------------------------------------

  const snapUvRtToNearestPeak = useCallback((rtMin: number): UVLabelAnchor | null => {
    if (!uv || uv.available !== true) return null;
    if (uv.peaks.length > 0) {
      let bestIndex = 0;
      for (let i = 1; i < uv.peaks.length; i += 1) {
        if (
          Math.abs(uv.peaks[i].rt_min - rtMin) <
          Math.abs(uv.peaks[bestIndex].rt_min - rtMin)
        ) {
          bestIndex = i;
        }
      }
      const peak = uv.peaks[bestIndex];
      return {
        uv_rt_min: peak.rt_min,
        signal: peak.signal,
        source_peak_index: bestIndex,
      };
    }
    const uvIndex = nearestIndex(uv.rt_min, rtMin);
    if (uvIndex < 0) return null;
    return {
      uv_rt_min: uv.rt_min[uvIndex],
      signal: uv.signal[uvIndex],
      source_peak_index: uvIndex,
    };
  }, [uv]);

  const uvAnchorAtRt = useCallback(
    (rtMin: number, snap: boolean): UVLabelAnchor | null => {
      if (!uv || uv.available !== true) return null;
      if (snap) return snapUvRtToNearestPeak(rtMin);
      const uvIndex = nearestIndex(uv.rt_min, rtMin);
      if (uvIndex < 0) return null;
      return {
        uv_rt_min: uv.rt_min[uvIndex],
        signal: uv.signal[uvIndex],
        source_peak_index: uvIndex,
      };
    },
    [snapUvRtToNearestPeak, uv],
  );

  const addSpectrumLabelsToUv = useCallback((sp: SpectrumData, anchors: UVLabelAnchor[], sessionIdOverride?: string) => {
    if (!sessionIdOverride && (!uv || uv.available !== true)) return 0;
    if (anchors.length === 0) return 0;
    const topLabels = [...spectrumLabelsForUv(sp)]
      .sort((a, b) => b.intensity - a.intensity)
      .slice(0, Math.max(1, uvTransferCount));
    if (topLabels.length === 0) return 0;
    const nextLabels = anchors.flatMap((anchor) =>
      topLabels.map((label, index) => ({
        id: makeUvLabelId(
          sp.meta.rt_min,
          anchor.uv_rt_min,
          label.text,
          index,
        ),
        kind: label.source === "polymer" ? "polymer" as const : "custom" as const,
        uv_rt_min: anchor.uv_rt_min,
        signal: anchor.signal,
        text: label.text,
        source_ms_rt_min: sp.meta.rt_min,
        source_peak_index: anchor.source_peak_index,
        ax:
          (anchor.uv_rt_min +
            uvOffset +
            index * UV_LABEL_STAIR_X_STEP_MIN) *
          (rtUnit === "seconds" ? 60 : 1),
        axRef: "x" as const,
        ayRef: "pixel" as const,
        ay: uvLabelOrientation === "vertical" ? -72 - index * 26 : -42 - index * 22,
      })),
    );
    const updater = (prev: UVTextLabel[]) => [
      ...prev.filter(
        (label) =>
          label.kind === "custom" ||
          !anchors.some((anchor) => Math.abs(label.uv_rt_min - anchor.uv_rt_min) < 1e-6),
      ),
      ...nextLabels,
    ];
    if (sessionIdOverride) {
      setUvTextLabelsForSession(sessionIdOverride, updater);
    } else {
      setUvTextLabels(updater);
    }
    return nextLabels.length;
  }, [rtUnit, setUvTextLabels, setUvTextLabelsForSession, uv, uvLabelOrientation, uvOffset, uvTransferCount]);

  const storeUvLabelsFromSpectrum = useCallback(
    (sp: SpectrumData, uvRtMin: number, options?: { snap?: boolean }) => {
      const anchor = uvAnchorAtRt(uvRtMin, options?.snap ?? snapUvLabels);
      if (!anchor) {
        setInfo("No UV point is available for the selected RT.");
        return 0;
      }
      const count = addSpectrumLabelsToUv(sp, [anchor]);
      if (count === 0) setInfo("No MS/polymer labels are available to transfer.");
      return count;
    },
    [addSpectrumLabelsToUv, snapUvLabels, uvAnchorAtRt],
  );

  const loadSpectrum = useCallback(
    (rtMin: number, options?: { uvRtMin?: number; forceUvTransfer?: boolean }) => {
      if (!activeSid) return;
      setBusy(true);
      setSelectedRt(rtMin);
      setSelectedUvRt(options?.uvRtMin ?? null);
      api.lcms
        .spectrum(activeSid, {
          rt_min: rtMin,
          polarity: pol,
          top_n: Math.max(1, spectrumTopN),
          min_rel: Math.max(0, spectrumMinRel),
          polymer: activePolymerSettings,
        })
        .then((sp) => {
          setSpectrum(sp);
          if (transferMsToUv || options?.forceUvTransfer) {
            storeUvLabelsFromSpectrum(sp, options?.uvRtMin ?? rtMin - uvOffset, {
              snap: snapUvLabels,
            });
          }
        })
        .catch((err) => setError(String(err)))
        .finally(() => setBusy(false));
    },
    [
      activeSid,
      pol,
      spectrumTopN,
      spectrumMinRel,
      activePolymerSettings,
      transferMsToUv,
      uvOffset,
      snapUvLabels,
      storeUvLabelsFromSpectrum,
    ],
  );

  const transferSelectedSpectrumToUv = useCallback(() => {
    if (selectedRt == null) {
      setInfo("Click a point on the TIC or UV chromatogram to select an RT first.");
      return;
    }
    const uvRtMin = selectedUvRt ?? selectedRt - uvOffset;
    if (spectrum && Math.abs(spectrum.meta.rt_min - selectedRt) < 0.02) {
      storeUvLabelsFromSpectrum(spectrum, uvRtMin, { snap: snapUvLabels });
      return;
    }
    loadSpectrum(selectedRt, { uvRtMin, forceUvTransfer: true });
  }, [
    loadSpectrum,
    selectedRt,
    selectedUvRt,
    snapUvLabels,
    spectrum,
    storeUvLabelsFromSpectrum,
    uvOffset,
  ]);

  const setTransferMsToUvAndMaybeApply = useCallback(
    (enabled: boolean) => {
      setTransferMsToUv(enabled);
      if (enabled && selectedRt != null) {
        window.setTimeout(() => transferSelectedSpectrumToUv(), 0);
      }
    },
    [selectedRt, transferSelectedSpectrumToUv],
  );

  const moveUvLabel = useCallback((id: string, patch: Partial<UVTextLabel>) => {
    setUvTextLabels((prev) =>
      prev.map((label) => (label.id === id ? { ...label, ...patch } : label)),
    );
  }, [setUvTextLabels]);

  const deleteUvLabel = useCallback((id: string) => {
    setUvTextLabels((prev) => prev.filter((label) => label.id !== id));
  }, [setUvTextLabels]);

  const openCustomUvLabel = useCallback(() => {
    const rtMin = selectedUvRt ?? (selectedRt != null ? selectedRt - uvOffset : null);
    if (rtMin == null) {
      setInfo("Click a point on the UV chromatogram or TIC before adding a custom UV label.");
      return;
    }
    setCustomUvLabelDraft({
      text: "",
      rtText: rtMin.toFixed(4),
      snap: snapUvLabels,
    });
  }, [selectedRt, selectedUvRt, snapUvLabels, uvOffset]);

  const editUvLabel = useCallback((label: UVTextLabel) => {
    setCustomUvLabelDraft({
      id: label.id,
      text: label.text,
      rtText: label.uv_rt_min.toFixed(4),
      snap: snapUvLabels,
    });
  }, [snapUvLabels]);

  const saveCustomUvLabel = useCallback(
    (draft: CustomUvLabelDraft) => {
      const text = draft.text.trim();
      const rtMin = parseFloat(draft.rtText);
      if (!text) {
        setInfo("Enter label text before saving.");
        return;
      }
      if (!Number.isFinite(rtMin)) {
        setInfo("Enter a valid UV RT before saving the custom label.");
        return;
      }
      const anchor = uvAnchorAtRt(rtMin, draft.snap);
      if (!anchor) {
        setInfo("No UV chromatogram point is available for that RT.");
        return;
      }
      const existing = draft.id
        ? uvTextLabels.find((label) => label.id === draft.id)
        : undefined;
      const next: UVTextLabel = {
        id: draft.id ?? makeCustomUvLabelId(anchor.uv_rt_min, text),
        kind: existing?.kind ?? "custom",
        uv_rt_min: anchor.uv_rt_min,
        signal: anchor.signal,
        text,
        source_ms_rt_min: existing?.source_ms_rt_min ?? selectedRt ?? undefined,
        source_peak_index: anchor.source_peak_index,
        ax: existing?.ax ?? 0,
        axRef: existing?.axRef ?? "pixel",
        ayRef: existing?.ayRef ?? "pixel",
        ay: existing?.ay ?? -36,
      };
      setUvTextLabels((prev) =>
        draft.id
          ? prev.map((label) => (label.id === draft.id ? { ...label, ...next } : label))
          : [...prev, next],
      );
      setCustomUvLabelDraft(null);
    },
    [selectedRt, setUvTextLabels, uvAnchorAtRt, uvTextLabels],
  );

  const autoLabelUvPeaks = useCallback(async (
    sessionIdOverride?: string,
    polymerSettingsOverride?: PolymerSettings,
  ) => {
    const sid = sessionIdOverride ?? activeSid;
    if (!sid) return;
    if (!sessionIdOverride && (!uv || uv.available !== true)) {
      setInfo("Attach a UV chromatogram before auto-labeling UV peaks.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const freshUv = await api.lcms.uv(sid, {
        top_n: UV_PEAK_FETCH_LIMIT,
        min_rel: uvProminence,
        min_distance_min: uvMinDistance,
      });
      if (!sessionIdOverride) setUv(freshUv);
      const peaks = freshUv.available === true ? freshUv.peaks : [];
      if (peaks.length === 0) {
        setInfo("No UV peaks were detected with the current UV peak settings.");
        return;
      }
      let labeledPeaks = 0;
      let labelCount = 0;
      for (let peakIndex = 0; peakIndex < peaks.length; peakIndex += 1) {
        const peak = peaks[peakIndex];
        const sp = await api.lcms.spectrum(sid, {
          rt_min: peak.rt_min + uvOffset,
          polarity: pol,
          top_n: Math.max(1, spectrumTopN),
          min_rel: Math.max(0, spectrumMinRel),
          polymer: polymerSettingsOverride ?? activePolymerSettings,
        });
        const count = addSpectrumLabelsToUv(sp, [
          {
            uv_rt_min: peak.rt_min,
            signal: peak.signal,
            source_peak_index: peakIndex,
          },
        ], sessionIdOverride);
        if (count > 0) {
          labeledPeaks += 1;
          labelCount += count;
        }
      }
      setInfo(
        `Auto-labeled ${labelCount} label${labelCount === 1 ? "" : "s"} on ${labeledPeaks} UV peak${labeledPeaks === 1 ? "" : "s"}.`,
      );
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }, [
    activePolymerSettings,
    activeSid,
    addSpectrumLabelsToUv,
    pol,
    spectrumMinRel,
    spectrumTopN,
    uv,
    uvMinDistance,
    uvOffset,
    uvProminence,
  ]);

  const autoArrangeUvLabels = useCallback(() => {
    if (uvTextLabels.length === 0) {
      setInfo("There are no UV labels to arrange.");
      return;
    }
    const uvRtMin = uv?.available === true ? uv.rt_min : uvTextLabels.map((label) => label.uv_rt_min);
    const uvSignals = uv?.available === true ? uv.signal : uvTextLabels.map((label) => label.signal);
    const finiteSignals = uvSignals.filter((value) => Number.isFinite(value));
    const signalMin = finiteSignals.length > 0 ? Math.min(...finiteSignals) : 0;
    const signalMax = finiteSignals.length > 0 ? Math.max(...finiteSignals) : 1;
    const yMin = graphSettings.uv.axis.yMin ?? Math.min(signalMin, 0);
    const yMax = graphSettings.uv.axis.yMax ?? Math.max(signalMax, 1);
    const yRange = Math.max(Number.EPSILON, yMax - yMin);
    const plotAreaHeightPx = Math.max(80, graphSettings.uv.height - 50);
    const yUnitsPerPx = yRange / plotAreaHeightPx;
    const hydroxyAbbreviations = new Set(
      polymerSettings.monomers
        .filter((monomer) => monomer.category === "hydroxy")
        .flatMap((monomer) => [monomer.abbr, monomer.name])
        .map((value) => value.trim().toUpperCase())
        .filter(Boolean),
    );
    const rtScale = rtUnit === "seconds" ? 60 : 1;
    const signalRange = Math.max(1, signalMax - signalMin);

    if (uvBunchLabels) {
      // Build one synthetic label per group (keyed by normalized text).
      // Multi-peak groups use a hub position as the arrow tail; single-peak
      // groups are treated as regular labels whose ax/ay update on uvTextLabels.
      const groups = new Map<string, UVTextLabel[]>();
      for (const label of uvTextLabels) {
        const key = normalizeUvBunchText(label.text);
        if (!key) continue;
        groups.set(key, [...(groups.get(key) ?? []), label]);
      }
      const bunchedSynthetic: UVTextLabel[] = [];
      const singleLabels: UVTextLabel[] = [];
      groups.forEach((group, key) => {
        if (group.length > 1) {
          const avgRt = group.reduce((s, l) => s + l.uv_rt_min, 0) / group.length;
          const peakY = Math.max(...group.map((l) => l.signal));
          const convY = peakY + signalRange * uvBunchHubOffset;
          bunchedSynthetic.push({
            id: key,
            kind: group[0].kind,
            uv_rt_min: avgRt,
            signal: convY,
            text: group[0].text,
          });
        } else {
          singleLabels.push(group[0]);
        }
      });
      const allSynthetic = [...bunchedSynthetic, ...singleLabels];
      const arranged = new Map<string, UVLabelLayoutOffset>();
      arrangeUvLabelsAsSeriesStairs(
        allSynthetic,
        uvOffset,
        rtScale,
        Math.max(0, uvLabelStairXStep),
        Math.max(0, uvLabelStairYStep),
        yUnitsPerPx,
        uvRtMin,
        uvSignals,
        hydroxyAbbreviations,
      ).forEach((offset) => arranged.set(offset.id, offset));

      // Multi-peak groups → update bunchOffsets; single-peak → update uvTextLabels.
      const nextBunchOffsets: Record<string, { ax: number; ay: number }> = { ...uvBunchOffsets };
      bunchedSynthetic.forEach(({ id }) => {
        const o = arranged.get(id);
        if (o) nextBunchOffsets[id] = { ax: o.ax, ay: o.ay };
      });
      setUvBunchOffsets(nextBunchOffsets);
      if (singleLabels.length > 0) {
        setUvTextLabels((prev) =>
          prev.map((label) => {
            const o = arranged.get(label.id);
            return o ? { ...label, ...o } : label;
          }),
        );
      }
      setInfo(`Arranged ${groups.size} bunched UV label group${groups.size !== 1 ? "s" : ""}.`);
      return;
    }

    const sortedIds = [...uvTextLabels]
      .sort((a, b) => a.uv_rt_min - b.uv_rt_min)
      .map((label) => label.id);
    const arranged = new Map<string, UVLabelLayoutOffset>();
    arrangeUvLabelsAsSeriesStairs(
      uvTextLabels,
      uvOffset,
      rtScale,
      Math.max(0, uvLabelStairXStep),
      Math.max(0, uvLabelStairYStep),
      yUnitsPerPx,
      uvRtMin,
      uvSignals,
      hydroxyAbbreviations,
    ).forEach((offset) => {
      arranged.set(offset.id, offset);
    });
    setUvTextLabels((prev) =>
      prev
        .map((label) => ({ ...label, ...(arranged.get(label.id) ?? {}) }))
        .sort((a, b) => sortedIds.indexOf(a.id) - sortedIds.indexOf(b.id)),
    );
    setInfo(`Arranged ${uvTextLabels.length} UV labels in local series stairs.`);
  }, [
    graphSettings.uv.axis.yMax,
    graphSettings.uv.axis.yMin,
    graphSettings.uv.height,
    polymerSettings.monomers,
    rtUnit,
    setUvTextLabels,
    uv,
    uvBunchHubOffset,
    uvBunchLabels,
    uvBunchOffsets,
    uvLabelStairXStep,
    uvLabelStairYStep,
    uvOffset,
    uvTextLabels,
  ]);

  // Keep a ref to the latest autoArrangeUvLabels so the effect below never
  // captures a stale closure while also avoiding it as an effect dependency.
  const autoArrangeUvLabelsRef = useRef(autoArrangeUvLabels);
  useEffect(() => { autoArrangeUvLabelsRef.current = autoArrangeUvLabels; });

  const prevUvBunchLabelsRef = useRef(uvBunchLabels);
  useEffect(() => {
    if (prevUvBunchLabelsRef.current && !uvBunchLabels) {
      // Switched bunch OFF — re-arrange labels individually so they don't stack.
      autoArrangeUvLabelsRef.current();
    }
    prevUvBunchLabelsRef.current = uvBunchLabels;
  }, [uvBunchLabels]);

  const onUpload = async (files: File[]) => {
    if (files.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      setSpectrum(null);
      setSelectedRt(null);
      setSelectedUvRt(null);
      const uploaded: LCMSSessionSummary[] = [];
      for (const file of files) {
        const s = await api.lcms.upload(file);
        uploaded.push(s);
      }
      if (uploaded.length > 0) {
        setSessions((prev) => [...prev, ...uploaded]);
        setSessionProjectById((prev) => {
          const next = { ...prev };
          uploaded.forEach((session) => {
            next[session.session_id] = null;
          });
          return next;
        });
        if (activeProjectId !== "__all" && activeProjectId !== "__unassigned") {
          setActiveProjectId("__unassigned");
        }
        setActiveSid(uploaded[uploaded.length - 1].session_id);
      }
      if (uploaded.length > 1) {
        setInfo(`Loaded ${uploaded.length} mzML files.`);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const onRemove = async (sid: string) => {
    await api.lcms.remove(sid).catch((err) => setError(String(err)));
    setSessions((prev) => prev.filter((s) => s.session_id !== sid));
    setSessionProjectById((prev) => {
      if (!(sid in prev)) return prev;
      const next = { ...prev };
      delete next[sid];
      return next;
    });
    clearUvLabelsForSession(sid);
    setFeatureRows((prev) => prev.filter((row) => row.session_id !== sid));
    setEicPlots((prev) => prev.filter((plot) => eicSourceSessionId(plot) !== sid));
    if (activeSid === sid) {
      setActiveSid(null);
      setSpectrum(null);
      setTic(null);
      setSelectedRt(null);
      setSelectedUvRt(null);
    }
  };

  const onUploadUV = async (file: File) => {
    if (!activeSid) return;
    setUvBusy(true);
    setError(null);
    try {
      const summary = await api.lcms.uploadUV(activeSid, file);
      setSessions((prev) =>
        prev.map((s) => (s.session_id === summary.session_id ? summary : s)),
      );
      const data = await api.lcms.uv(activeSid, {
        top_n: UV_PEAK_FETCH_LIMIT,
        min_rel: uvProminence,
        min_distance_min: uvMinDistance,
      });
      setUv(data);
    } catch (err) {
      setError(String(err));
    } finally {
      setUvBusy(false);
    }
  };

  const onUploadUVFiles = async (files: File[]) => {
    if (files.length === 0 || sessions.length === 0) return;
    if (files.length === 1) {
      await onUploadUV(files[0]);
      return;
    }

    setUvBusy(true);
    setError(null);
    try {
      const matches = matchUvFilesToSessions(files, sessions, activeSid);
      const matchedFiles = new Set(matches.map((match) => match.file));
      const summaries: LCMSSessionSummary[] = [];
      for (const match of matches) {
        summaries.push(await api.lcms.uploadUV(match.session.session_id, match.file));
      }
      setSessions((prev) =>
        prev.map((session) =>
          summaries.find((summary) => summary.session_id === session.session_id) ?? session,
        ),
      );
      if (activeSid && summaries.some((summary) => summary.session_id === activeSid)) {
        setUv(
          await api.lcms.uv(activeSid, {
            top_n: UV_PEAK_FETCH_LIMIT,
            min_rel: uvProminence,
            min_distance_min: uvMinDistance,
          }),
        );
      }
      const skipped = files.length - matchedFiles.size;
      setInfo(
        `Attached ${matches.length} UV CSV file${matches.length === 1 ? "" : "s"}${skipped ? `; ${skipped} unmatched` : ""}.`,
      );
    } catch (err) {
      setError(String(err));
    } finally {
      setUvBusy(false);
    }
  };

  const onRemoveUV = async () => {
    if (!activeSid) return;
    setUvBusy(true);
    try {
      await api.lcms.removeUV(activeSid);
      setUv({
        available: false,
        reason: "No UV chromatogram attached to this dataset.",
      });
      clearUvLabelsForSession(activeSid);
      setSessions((prev) =>
        prev.map((s) =>
          s.session_id === activeSid ? { ...s, uv: { available: false } } : s,
        ),
      );
    } catch (err) {
      setError(String(err));
    } finally {
      setUvBusy(false);
    }
  };

  // Navigation helpers
  const rtList = tic?.rt_min ?? [];

  const goToIndex = (i: number) => {
    if (i < 0 || i >= rtList.length) return;
    loadSpectrum(rtList[i]);
  };
  const goFirst = () => goToIndex(0);
  const goLast = () => goToIndex(rtList.length - 1);
  const goPrev = () => {
    if (rtList.length === 0) return;
    if (selectedRt == null) return goLast();
    const i = nearestIndex(rtList, selectedRt);
    goToIndex(Math.max(0, i - 1));
  };
  const goNext = () => {
    if (rtList.length === 0) return;
    if (selectedRt == null) return goFirst();
    const i = nearestIndex(rtList, selectedRt);
    goToIndex(Math.min(rtList.length - 1, i + 1));
  };
  // Find m/z: scan every MS1 at current filter for the most intense near m/z
  const [findMzInput, setFindMzInput] = useState("");
  const [findMzTol, setFindMzTol] = useState(0.01);
  const [eicInput, setEicInput] = useState("");
  const [eicTol, setEicTol] = useState(0.01);
  const findMz = async () => {
    if (!activeSid) return;
    const target = parseFloat(findMzInput);
    if (!Number.isFinite(target)) return;
    setBusy(true);
    setError(null);
    try {
      const result = await actionDispatch("lcms.find_mz", {
        session_id: activeSid,
        mz: target,
        tolerance: findMzTol,
        polarity: pol,
      }) as unknown as LCMSFindMzResponse;
      const bestRt = result.best.rt_min;
      if (bestRt == null) {
        setInfo(`No match found for m/z ${target.toFixed(4)} within ${findMzTol.toFixed(3)} Da.`);
        return;
      }
      setFindMzOpen(false);
      loadSpectrum(bestRt);
      setInfo(
        `Strongest match for m/z ${target.toFixed(4)} ± ${findMzTol.toFixed(3)}: RT ${bestRt.toFixed(3)} min`,
      );
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  // Auto-align UV↔MS: peak-correlation between UV signal and TIC
  const createEICForMz = useCallback(
    async (
      target: number,
      source: "dialog" | "spectrum" | "expected" = "dialog",
      toleranceOverride?: number,
      metadata?: Partial<LCMSEICMetadata>,
    ) => {
      if (!activeSid) return;
      if (!Number.isFinite(target)) {
        setInfo("Enter a valid m/z before generating an EIC.");
        return;
      }
      const tolerance = Math.max(0.000001, toleranceOverride ?? eicTol);
      const sourceSid = activeSid;
      const sourceFile = active?.display_name ?? "LCMS session";
      setBusy(true);
      setError(null);
      try {
        await actionDispatch("lcms.create_eic_and_show", {
          session_id: sourceSid,
          mz: target,
          tolerance,
          polarity: pol,
          source,
          source_file: sourceFile,
          metadata: {
            label: metadata?.label,
            expectedProduct: metadata?.expectedProduct,
            annotation: metadata?.annotation,
          },
        });
        if (source === "dialog") setEicOpen(false);
        setInfo(
          `Generated EIC for ${sourceFile}: m/z ${target.toFixed(4)} +/- ${tolerance.toFixed(4)}.`,
        );
      } catch (err) {
        setError(String(err));
      } finally {
        setBusy(false);
      }
    },
    [actionDispatch, active?.display_name, activeSid, eicTol, pol],
  );

  const runEIC = async () => {
    await createEICForMz(parseFloat(eicInput), "dialog");
  };

  const onSpectrumPeakClick = useCallback(
    (mz: number) => {
      setEicInput(mz.toFixed(4));
      void createEICForMz(mz, "spectrum", undefined, {
        label: `MS1 peak ${mz.toFixed(4)}`,
      });
    },
    [createEICForMz],
  );

  const integrateEicPlot = useCallback(
    (plot: LCMSEICPlot) => {
      const integrated = integrateEICPeak(plot.eic, selectedRt);
      if (!integrated) {
        setInfo("No valid EIC points were available to integrate.");
        return;
      }
      const sourceSid = eicSourceSessionId(plot) ?? activeSid;
      const sourceFile = eicSourceFile(plot);
      const row: LCMSFeatureRow = {
        id: `feature-${plot.id}`,
        eicPlotId: plot.id,
        session_id: sourceSid,
        sourceFile,
        mz: plot.eic.target_mz,
        tolerance: plot.eic.tolerance,
        polarity: plot.eic.best.polarity ?? pol ?? null,
        ...integrated,
        source: plot.metadata?.source ?? "manual",
        label: plot.metadata?.label,
        expectedProduct: plot.metadata?.expectedProduct,
        annotation: plot.metadata?.annotation,
        createdAt: new Date().toISOString(),
      };
      let wasUpdate = false;
      setFeatureRows((prev) => {
        wasUpdate = prev.some((item) => item.eicPlotId === plot.id);
        const withoutExisting = prev.filter((item) => item.eicPlotId !== plot.id);
        return [...withoutExisting, row].sort((a, b) => a.rtApex - b.rtApex || a.mz - b.mz);
      });
      setInfo(
        `${wasUpdate ? "Updated existing" : "Added new"} feature for ${sourceFile}: m/z ${row.mz.toFixed(4)} at RT ${row.rtApex.toFixed(3)} min; area ${row.area.toExponential(3)}.`,
      );
    },
    [activeSid, pol, selectedRt],
  );

  const autoAlignNow = () => {
    if (!tic || !uv || !uv.available) {
      setInfo(
        "Auto-align needs both a loaded MS and an attached UV chromatogram.",
      );
      return;
    }
    const maxLagMin = 1.0;
    const tRt = tic.rt_min;
    const tY = tic.tic;
    const uRt = (uv as Extract<UVChromatogramResponse, { available: true }>).rt_min;
    const uY = (uv as Extract<UVChromatogramResponse, { available: true }>).signal;
    if (tRt.length < 10 || uRt.length < 10) return;
    // Normalize
    const norm = (a: number[]) => {
      const mx = Math.max(...a);
      return mx > 0 ? a.map((v) => v / mx) : a;
    };
    const tN = norm(tY);
    // Resample UV onto TIC grid by nearest-neighbour
    const resampled = tRt.map((t) => {
      const i = nearestIndex(uRt, t);
      return i >= 0 ? uY[i] : 0;
    });
    const uN = norm(resampled);
    // Scan offsets in minutes on tRt step
    const step = tRt.length > 1 ? Math.abs(tRt[1] - tRt[0]) : 0.01;
    const maxLag = Math.max(1, Math.round(maxLagMin / Math.max(step, 1e-6)));
    let bestScore = -Infinity;
    let bestLag = 0;
    for (let lag = -maxLag; lag <= maxLag; lag += 1) {
      let s = 0;
      for (let i = 0; i < tN.length; i += 1) {
        const j = i + lag;
        if (j >= 0 && j < uN.length) s += tN[i] * uN[j];
      }
      if (s > bestScore) {
        bestScore = s;
        bestLag = lag;
      }
    }
    // Positive offset means UV elutes first and is shifted forward onto MS time.
    const offset = -bestLag * step;
    setUvOffset(offset);
    setUvOffsetText(offset.toFixed(3));
    setInfo(`Auto-aligned UV to MS: offset ${offset.toFixed(3)} min`);
  };

  useEffect(() => {
    if (autoAlignUv) autoAlignNow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoAlignUv, tic, uv]);

  // Export labels: CSV of top-N m/z per MS1 scan at current filter
  const exportLabels = async () => {
    if (!activeSid || rtList.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const blob = await api.lcms.exportLabels(activeSid, {
        polarity: pol,
        top_n: Math.max(1, spectrumTopN),
        min_rel: Math.max(0, spectrumMinRel),
      });
      downloadBlob(blob, `${active?.display_name ?? "lcms"}.labels.csv`);
      setInfo("Exported labels across all indexed MS1 scans.");
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const exportSpectrum = async () => {
    if (!activeSid || selectedRt == null) {
      setInfo("Select an RT before exporting a spectrum CSV.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const blob = await api.lcms.exportSpectrum(activeSid, {
        rt_min: selectedRt,
        polarity: pol,
      });
      downloadBlob(blob, `${active?.display_name ?? "lcms"}.spectrum.csv`);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const exportUV = async () => {
    if (!activeSid) return;
    setBusy(true);
    setError(null);
    try {
      const blob = await api.lcms.exportUV(activeSid);
      downloadBlob(blob, `${active?.display_name ?? "lcms"}.uv.csv`);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const exportTICOverlay = async () => {
    const ids = overlaySessionIds.length > 0 ? overlaySessionIds : sessions.map((s) => s.session_id);
    if (ids.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const blob = await api.lcms.exportTICOverlay({ session_ids: ids, polarity: pol });
      downloadBlob(blob, "lcms_tic_overlay.csv");
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const spectrumFromRegionData = useCallback(
    (data: LCMSRegionSpectrumData, rtMin: number, rtMax: number): SpectrumData => {
      const lo = Math.min(rtMin, rtMax);
      const hi = Math.max(rtMin, rtMax);
      const polymerLabels = data.polymer_labels ?? [];
      const filtered = filterIgnoredRegionSpectrum(
        data.mz,
        data.intensity,
        [],
        polymerLabels,
        regionIgnoredMasses,
      );
      const maxIntensity = Math.max(...filtered.intensity, 0);
      const labels = filtered.mz
        .map((mz, index) => ({ mz, intensity: filtered.intensity[index] }))
        .filter((point) => maxIntensity > 0 && point.intensity >= spectrumMinRel * maxIntensity)
        .sort((a, b) => b.intensity - a.intensity)
        .slice(0, Math.max(1, spectrumTopN));
      return {
        meta: {
          spectrum_id: `summed:${lo.toFixed(4)}-${hi.toFixed(4)}`,
          rt_min: (lo + hi) / 2,
          rt_max: hi,
          rt_start: lo,
          rt_end: hi,
          tic: filtered.intensity.reduce((sum, value) => sum + value, 0),
          polarity: pol ?? null,
          n_peaks: filtered.mz.length,
          n_scans: data.n_scans,
          bin_width: data.bin_width,
          merge_mode: "sum",
          ignored_mz: regionIgnoredMasses.map((item) => item.mz),
          ignored_tolerance: regionIgnoredMasses.length ? regionIgnoredMzTolerance : undefined,
          ignored_peak_count: filtered.ignoredPeakCount,
        },
        mz: filtered.mz,
        intensity: filtered.intensity,
        labels: [...labels, ...filtered.polymerLabels],
        polymer_labels: filtered.polymerLabels,
      };
    },
    [pol, regionIgnoredMasses, regionIgnoredMzTolerance, spectrumMinRel, spectrumTopN],
  );

  const applyRegionIgnoredMassesToSpectrum = useCallback(
    (sp: SpectrumData): SpectrumData => {
      if (!sp.meta.spectrum_id.startsWith("summed:") || regionIgnoredMasses.length === 0) return sp;
      const filtered = filterIgnoredRegionSpectrum(
        sp.mz,
        sp.intensity,
        sp.labels ?? [],
        sp.polymer_labels ?? [],
        regionIgnoredMasses,
      );
      return {
        ...sp,
        meta: {
          ...sp.meta,
          tic: filtered.intensity.reduce((sum, value) => sum + value, 0),
          n_peaks: filtered.mz.length,
          ignored_mz: regionIgnoredMasses.map((item) => item.mz),
          ignored_tolerance: regionIgnoredMzTolerance,
          ignored_peak_count: filtered.ignoredPeakCount,
        },
        mz: filtered.mz,
        intensity: filtered.intensity,
        labels: filtered.labels,
        polymer_labels: filtered.polymerLabels,
      };
    },
    [regionIgnoredMasses, regionIgnoredMzTolerance],
  );

  const loadSummedRegionSpectrum = async () => {
    if (!activeSid || selectedRegion == null) {
      setInfo("Enable Region Select and drag an RT region on the TIC first.");
      return;
    }
    const rtMin = Math.min(selectedRegion.rtMin, selectedRegion.rtMax);
    const rtMax = Math.max(selectedRegion.rtMin, selectedRegion.rtMax);
    setBusy(true);
    setError(null);
    try {
      await actionDispatch("lcms.show_summed_region_spectrum", {
        session_id: activeSid,
        rt_min: rtMin,
        rt_max: rtMax,
        polarity: pol,
        bin_width: 0.01,
        min_rel: 0.0,
      });
      setShowSpectrum(true);
      setInfo(`Loaded summed MS1 for ${rtMin.toFixed(3)}-${rtMax.toFixed(3)} min.`);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleSetRegionSelect = useCallback((v: boolean) => {
    setRegionSelect(v);
    setSelectedRegion(null);
  }, []);

  const onRegionSelected = useCallback(
    async (rtMin: number, rtMax: number) => {
      if (!activeSid) return;
      const lo = Math.min(rtMin, rtMax);
      const hi = Math.max(rtMin, rtMax);
      if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return;
      setSelectedRegion({ rtMin: lo, rtMax: hi });
      setSelectedRt((lo + hi) / 2);
      setBusy(true);
      setError(null);
      try {
        const data = await api.lcms.regionSpectrum(activeSid, {
          rt_min: lo,
          rt_max: hi,
          polarity: pol,
          bin_width: 0.01,
          min_rel: 0.0,
          polymer: activePolymerSettings,
        });
        setSpectrum(spectrumFromRegionData(data, lo, hi));
        setShowSpectrum(true);
        setInfo(
          data.n_scans > 0
            ? `Loaded summed MS1 from ${data.n_scans} scans (${lo.toFixed(3)}-${hi.toFixed(3)} min).`
            : `No MS1 scans found in ${lo.toFixed(3)}-${hi.toFixed(3)} min.`,
        );
      } catch (err) {
        setError(String(err));
      } finally {
        setBusy(false);
      }
    },
    [activeSid, pol, activePolymerSettings, spectrumFromRegionData],
  );

  const saveWorkspace = () => {
    const uvTextLabelsBySessionId = Object.fromEntries(
      sessions.map((session) => [
        session.session_id,
        uvLabelsBySessionId[session.session_id] ?? [],
      ]),
    );
    const workspace: LCMSWorkspaceEnvelope = {
      version: 2,
      module: "LCMS",
      createdAt: new Date().toISOString(),
      sessions: sessions.map((session) => ({
        session_id: session.session_id,
        display_name: session.display_name,
        path: session.path,
        uv: session.uv
          ? { available: Boolean(session.uv.available), filename: session.uv.filename, path: session.uv.path }
          : { available: false },
      })),
      activeSessionId: activeSid,
      projects,
      sessionProjectById,
      activeProjectId,
      viewState: {
        polarity,
        rtUnit,
        activeTab,
        showTIC,
        showSpectrum,
        showUV,
        selectedRt,
        selectedUvRt,
        uvOffset,
        uvOffsetText,
        graphSettings,
        overlayTicEnabled,
        overlayUvEnabled,
        overlaySpectrumEnabled,
        overlayEicEnabled,
        overlaySessionIds,
      },
      analysisState: {
        annotateSpectrum,
        spectrumTopN,
        spectrumMinRel,
        transferMsToUv,
        uvTransferCount,
        uvProminence,
        uvMinDistance,
        snapUvLabels,
        uvBunchLabels,
        uvBunchOffsets,
        uvBunchHubOffset,
        uvLabelOrientation,
        uvLabelStairXStep,
        uvLabelStairYStep,
        uvTextLabels,
        uvTextLabelsBySessionId,
        polymerSettings,
        eic: eicPlots.at(-1)?.eic ?? null,
        eics: eicPlots,
        features: featureRows,
      },
    };
    downloadJson(workspace, "lcms.workspace.json");
  };

  const loadWorkspaceFile = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const workspace = await readJsonFile<LCMSWorkspaceEnvelope>(file);
      if (workspace.module !== "LCMS") {
        throw new Error("This is not an LCMS workspace file.");
      }

      const availableIds = new Set(sessions.map((s) => s.session_id));

      // old session_id → new session_id mapping (for restored sessions)
      const idMap = new Map<string, string>();
      let restored = 0;
      let failed = 0;

      for (const wsSession of workspace.sessions) {
        if (availableIds.has(wsSession.session_id)) {
          idMap.set(wsSession.session_id, wsSession.session_id);
          continue;
        }
        if (!wsSession.path) {
          failed++;
          continue;
        }
        try {
          const newSession = await api.lcms.loadFromPath(wsSession.path, wsSession.display_name, "minutes");
          idMap.set(wsSession.session_id, newSession.session_id);
          if (wsSession.uv?.available && wsSession.uv.path) {
            try {
              await api.lcms.attachUVFromPath(newSession.session_id, wsSession.uv.path);
            } catch {
              // UV file gone — mzML still loaded
            }
          }
          restored++;
        } catch {
          failed++;
        }
      }

      // Refresh sessions list after restoring
      const updatedSessions = await api.lcms.list();
      setSessions(updatedSessions);
      setSessionsHydrated(true);
      const newAvailableIds = new Set(updatedSessions.map((s) => s.session_id));

      const remapId = (oldId: string | null): string | null => {
        if (!oldId) return null;
        const newId = idMap.get(oldId);
        return newId && newAvailableIds.has(newId) ? newId : null;
      };
      const remapIds = (ids: string[]) =>
        ids.map((id) => idMap.get(id) ?? id).filter((id) => newAvailableIds.has(id));

      const view = workspace.viewState;
      const analysis = workspace.analysisState;
      const restoredProjects = Array.isArray(workspace.projects) ? workspace.projects : [];
      const restoredProjectIds = new Set(restoredProjects.map((project) => project.id));
      const nextSessionProjectById: Record<string, string | null> = {};
      for (const session of updatedSessions) nextSessionProjectById[session.session_id] = null;
      for (const [oldSid, projectId] of Object.entries(workspace.sessionProjectById ?? {})) {
        const newSid = idMap.get(oldSid) ?? oldSid;
        if (!newAvailableIds.has(newSid)) continue;
        nextSessionProjectById[newSid] = projectId && restoredProjectIds.has(projectId) ? projectId : null;
      }

      const nextUvLabelsBySessionId: Record<string, UVTextLabel[]> = {};
      if (analysis.uvTextLabelsBySessionId) {
        for (const [sid, labels] of Object.entries(analysis.uvTextLabelsBySessionId)) {
          const newSid = idMap.get(sid) ?? sid;
          if (newAvailableIds.has(newSid) && Array.isArray(labels)) {
            nextUvLabelsBySessionId[newSid] = labels;
          }
        }
      } else if (workspace.activeSessionId && Array.isArray(analysis.uvTextLabels)) {
        const newActiveSid = remapId(workspace.activeSessionId);
        if (newActiveSid) {
          nextUvLabelsBySessionId[newActiveSid] = analysis.uvTextLabels;
        }
      }

      setPolarity(view.polarity ?? "all");
      setRtUnit(view.rtUnit ?? "minutes");
      setActiveTab(view.activeTab ?? "navigate");
      setShowTIC(Boolean(view.showTIC));
      setShowSpectrum(Boolean(view.showSpectrum));
      setShowUV(Boolean(view.showUV));
      setSelectedRt(view.selectedRt ?? null);
      setSelectedUvRt(view.selectedUvRt ?? null);
      setUvOffset(Number.isFinite(view.uvOffset) ? view.uvOffset : 0);
      setUvOffsetText(view.uvOffsetText ?? "0.000");
      setGraphSettings(mergeGraphSettings(view.graphSettings));
      setOverlayTicEnabled(Boolean(view.overlayTicEnabled));
      setOverlayUvEnabled(Boolean(view.overlayUvEnabled));
      setOverlaySpectrumEnabled(Boolean(view.overlaySpectrumEnabled));
      setOverlayEicEnabled(Boolean(view.overlayEicEnabled));
      setOverlaySessionIds(remapIds(view.overlaySessionIds ?? []));
      setAnnotateSpectrum(Boolean(analysis.annotateSpectrum));
      setSpectrumTopN(analysis.spectrumTopN ?? 10);
      setSpectrumMinRel(analysis.spectrumMinRel ?? 0.05);
      setTransferMsToUv(Boolean(analysis.transferMsToUv));
      setUvTransferCount(analysis.uvTransferCount ?? 3);
      setUvProminence(analysis.uvProminence ?? 0.05);
      setUvMinDistance(analysis.uvMinDistance ?? 0.2);
      setSnapUvLabels(Boolean(analysis.snapUvLabels));
      setUvBunchLabels(Boolean(analysis.uvBunchLabels));
      setUvBunchOffsets(analysis.uvBunchOffsets ?? {});
      setUvBunchHubOffset(analysis.uvBunchHubOffset ?? 0.1);
      setUvLabelOrientation(analysis.uvLabelOrientation ?? "vertical");
      setUvLabelStairXStep(analysis.uvLabelStairXStep ?? UV_LABEL_STAIR_X_STEP_MIN);
      setUvLabelStairYStep(analysis.uvLabelStairYStep ?? UV_LABEL_STAIR_Y_STEP_PX);
      setUvLabelsBySessionId(nextUvLabelsBySessionId);
      if (analysis.polymerSettings) setPolymerSettings(analysis.polymerSettings);
      setEicPlots(
        Array.isArray(analysis.eics)
          ? analysis.eics.map((plot) => ({
              ...plot,
              metadata: plot.metadata
                ? {
                    ...plot.metadata,
                    sourceSessionId: remapId(plot.metadata.sourceSessionId ?? null),
                  }
                : plot.metadata,
            }))
          : analysis.eic
            ? [{ id: `workspace-${Date.now()}`, eic: analysis.eic }]
            : [],
      );
      setFeatureRows(
        Array.isArray(analysis.features)
          ? analysis.features.map((row) => ({
              ...row,
              session_id: remapId(row.session_id),
            }))
          : [],
      );
      setProjects(restoredProjects);
      setSessionProjectById(nextSessionProjectById);
      setActiveProjectId(
        workspace.activeProjectId === "__unassigned" ||
          workspace.activeProjectId === "__all" ||
          (workspace.activeProjectId && restoredProjectIds.has(workspace.activeProjectId))
          ? workspace.activeProjectId
          : "__all",
      );
      const newActiveSid = remapId(workspace.activeSessionId);
      if (newActiveSid) setActiveSid(newActiveSid);

      let infoMsg = "Loaded LCMS workspace.";
      if (restored > 0) infoMsg += ` Restored ${restored} session(s) from disk.`;
      if (failed > 0) infoMsg += ` ${failed} session(s) could not be found on disk.`;
      setInfo(infoMsg);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const unregister: Array<() => void> = [];
    const on = (actionId: string, handler: (args: Record<string, unknown>) => Record<string, unknown> | Promise<Record<string, unknown>>) => {
      unregister.push(browserAutomation.register(actionId, handler));
    };
    const obj = (value: unknown): Record<string, unknown> =>
      value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
    const num = (value: unknown): number | null =>
      typeof value === "number" && Number.isFinite(value) ? value : typeof value === "string" && Number.isFinite(Number(value)) ? Number(value) : null;
    const str = (value: unknown): string | null => (typeof value === "string" && value ? value : null);
    const stringArray = (value: unknown): string[] =>
      Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
    const sourceFileFor = (sessionId: string | null) =>
      sessions.find((session) => session.session_id === sessionId)?.display_name ?? active?.display_name ?? "LCMS session";

    const showEicPayload = (args: Record<string, unknown>) => {
      const eic = obj(args.eic) as unknown as LCMSEICData;
      if (!Array.isArray(eic.rt_min) || !Array.isArray(eic.intensity)) {
        throw new Error("EIC payload is missing rt_min/intensity arrays.");
      }
      const metadata = obj(args.metadata) as Partial<LCMSEICMetadata>;
      const sourceSessionId = str(args.session_id) ?? str(metadata.sourceSessionId) ?? activeSid;
      const metadataSource =
        metadata.source === "spectrum" || metadata.source === "expected" || metadata.source === "manual"
          ? metadata.source
          : "manual";
      const id = `automation-${Date.now()}-${eicPlotCounterRef.current + 1}`;
      eicPlotCounterRef.current += 1;
      setEicPlots((prev) => [
        ...prev,
        {
          id,
          eic,
          metadata: {
            ...metadata,
            source: metadataSource,
            sourceSessionId,
            sourceFile: str(args.source_file) ?? sourceFileFor(sourceSessionId),
          },
        },
      ]);
      if (eic.best?.rt_min != null && typeof eic.best.rt_min === "number") {
        setSelectedRt(eic.best.rt_min);
        if (metadataSource === "manual") {
          loadSpectrum(eic.best.rt_min);
        }
      }
      setInfo(`Automation added EIC m/z ${eic.target_mz.toFixed(4)}.`);
      return { eic_plot_id: id };
    };

    const loadSpectrumFor = async (args: Record<string, unknown>) => {
      const rtMin = num(args.rt_min);
      if (rtMin == null) throw new Error("rt_min is required.");
      const sessionId = str(args.session_id) ?? activeSid;
      if (!sessionId) throw new Error("No LCMS session is selected.");
      const requestedPolarity = args.polarity === "positive" || args.polarity === "negative" ? args.polarity : pol;
      const sp = await api.lcms.spectrum(sessionId, {
        rt_min: rtMin,
        polarity: requestedPolarity,
        top_n: Math.max(1, spectrumTopN),
        min_rel: Math.max(0, spectrumMinRel),
        polymer: activePolymerSettings,
      });
      if (sessionId !== activeSid) setActiveSid(sessionId);
      setSpectrum(sp);
      setSelectedRt(sp.meta.rt_min);
      setInfo(`Automation loaded spectrum at RT ${sp.meta.rt_min.toFixed(3)} min.`);
      return { rt_min: sp.meta.rt_min, spectrum_id: sp.meta.spectrum_id };
    };

    const integratePlots = (plots: LCMSEICPlot[], selectedRtOverride?: number | null) => {
      const rows: LCMSFeatureRow[] = [];
      plots.forEach((plot) => {
        const integrated = integrateEICPeak(plot.eic, selectedRtOverride ?? selectedRt);
        if (!integrated) return;
        const sourceSid = eicSourceSessionId(plot) ?? activeSid;
        rows.push({
          id: `feature-${plot.id}`,
          eicPlotId: plot.id,
          session_id: sourceSid,
          sourceFile: eicSourceFile(plot),
          mz: plot.eic.target_mz,
          tolerance: plot.eic.tolerance,
          polarity: plot.eic.best.polarity ?? pol ?? null,
          ...integrated,
          source: plot.metadata?.source ?? "manual",
          label: plot.metadata?.label,
          expectedProduct: plot.metadata?.expectedProduct,
          annotation: plot.metadata?.annotation,
          createdAt: new Date().toISOString(),
        });
      });
      if (rows.length === 0) return { count: 0 };
      setFeatureRows((prev) => {
        const rowIds = new Set(rows.map((row) => row.id));
        return [...prev.filter((row) => !rowIds.has(row.id)), ...rows].sort((a, b) => a.rtApex - b.rtApex || a.mz - b.mz);
      });
      setInfo(`Automation integrated ${rows.length} EIC${rows.length === 1 ? "" : "s"}.`);
      return { count: rows.length, feature_row_ids: rows.map((row) => row.id) };
    };

    on("lcms.push_eic_to_ui", showEicPayload);
    on("lcms.get_polymer_settings", () => {
      return { settings: polymerSettingsRef.current };
    });
    on("lcms.set_polymer_settings", (args) => {
      setPolymerSettings(obj(args.settings) as unknown as PolymerUiSettings);
      return { ok: true };
    });
    on("lcms.add_feature_row", (args) => {
      const row = obj(args.row) as unknown as LCMSFeatureRow;
      setFeatureRows((prev) => [...prev.filter((item) => item.id !== row.id), row].sort((a, b) => a.rtApex - b.rtApex || a.mz - b.mz));
      return { feature_row_id: row.id };
    });
    on("lcms.update_feature_row", (args) => {
      const id = str(args.id);
      if (!id) throw new Error("id is required.");
      const patch = obj(args.patch);
      setFeatureRows((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)));
      return { feature_row_id: id };
    });
    on("lcms.remove_feature_row", (args) => {
      const id = str(args.id);
      if (!id) throw new Error("id is required.");
      setFeatureRows((prev) => prev.filter((row) => row.id !== id));
      return { feature_row_id: id };
    });
    on("lcms.clear_features", () => {
      const count = featureRows.length;
      setFeatureRows([]);
      return { count };
    });
    on("lcms.clear_eics", () => {
      const cleared = visibleEicPlots.length;
      setEicPlots((prev) =>
        prev.filter((plot) => {
          const sourceSid = eicSourceSessionId(plot);
          return sourceSid != null && sourceSid !== activeSid;
        }),
      );
      return { count: cleared };
    });
    on("lcms.export_labels_csv", async () => {
      await exportLabels();
      return { ok: true };
    });
    on("lcms.export_spectrum_csv", async () => {
      await exportSpectrum();
      return { ok: true };
    });
    on("lcms.export_uv_csv", async () => {
      await exportUV();
      return { ok: true };
    });
    on("lcms.export_tic_overlay_csv", async () => {
      await exportTICOverlay();
      return { ok: true };
    });
    on("lcms.open_uv_file_picker", () => {
      uvFileRef.current?.click();
      return { ok: true };
    });
    on("lcms.clear_uv", async () => {
      await onRemoveUV();
      return { ok: true };
    });
    on("lcms.auto_align_uv", () => {
      autoAlignNow();
      return { ok: true };
    });
    on("lcms.auto_label_uv", async (args) => {
      const sid = str(args.session_id) ?? undefined;
      let polymerOverride: PolymerSettings | undefined;
      if (args.polymer_settings != null && pol != null) {
        polymerOverride = toApiPolymerSettings(
          args.polymer_settings as unknown as PolymerUiSettings,
          pol,
        );
      }
      await autoLabelUvPeaks(sid, polymerOverride);
      return { ok: true };
    });
    on("lcms.open_custom_uv_label", () => {
      openCustomUvLabel();
      return { ok: true };
    });
    on("lcms.clear_uv_labels", () => {
      const count = uvTextLabels.length;
      setUvTextLabels([]);
      return { count };
    });
    on("lcms.set_uv_label_settings", (args) => {
      const applied: string[] = [];
      if (args.prominence != null) { setUvProminence(Number(args.prominence)); applied.push("prominence"); }
      if (args.min_distance != null) { setUvMinDistance(Number(args.min_distance)); applied.push("min_distance"); }
      if (args.orientation === "vertical" || args.orientation === "horizontal") { setUvLabelOrientation(args.orientation); applied.push("orientation"); }
      if (args.stair_x_step != null) { setUvLabelStairXStep(Number(args.stair_x_step)); applied.push("stair_x_step"); }
      if (args.stair_y_step != null) { setUvLabelStairYStep(Number(args.stair_y_step)); applied.push("stair_y_step"); }
      if (args.bunch_labels != null) { setUvBunchLabels(Boolean(args.bunch_labels)); applied.push("bunch_labels"); }
      if (args.bunch_hub_offset != null) { setUvBunchHubOffset(Number(args.bunch_hub_offset)); applied.push("bunch_hub_offset"); }
      if (args.snap_labels != null) { setSnapUvLabels(Boolean(args.snap_labels)); applied.push("snap_labels"); }
      return { ok: true, applied };
    });
    on("lcms.auto_arrange_uv_labels", () => {
      autoArrangeUvLabels();
      return { ok: true };
    });
    on("lcms.create_project", (args) => {
      const project = createProject(str(args.name) ?? undefined);
      return project ? { project_id: project.id } : { cancelled: true };
    });
    on("lcms.delete_project", (args) => {
      const projectId = str(args.project_id);
      if (!projectId) throw new Error("project_id is required.");
      deleteProject(projectId);
      return { project_id: projectId };
    });
    on("lcms.move_session_to_project", (args) => {
      const sessionId = str(args.session_id);
      if (!sessionId) throw new Error("session_id is required.");
      const projectId = str(args.project_id);
      moveSessionToProject(sessionId, projectId);
      return { session_id: sessionId, project_id: projectId };
    });
    on("lcms.select_project", (args) => {
      const projectId = str(args.project_id);
      if (!projectId) throw new Error("project_id is required.");
      setActiveProjectId(projectId);
      return { project_id: projectId };
    });
    on("lcms.open_dialog", (args) => {
      const dialog = str(args.dialog);
      if (dialog === "kendrick") setKendrickOpen(true);
      else if (dialog === "expected_products") setExpectedProductsOpen(true);
      else if (dialog === "comparison_matrix") setComparisonMatrixOpen(true);
      else if (dialog === "feature_table") setFeatureTableOpen(true);
      else if (dialog === "polymer") setPolymerDialogOpen(true);
      else if (dialog === "find_mz") setFindMzOpen(true);
      else if (dialog === "eic") setEicOpen(true);
      else if (dialog === "graph_settings") setGraphSettingsOpen(true);
      else throw new Error("Unknown dialog.");
      return { dialog };
    });
    on("lcms.scroll_to_eic", (args) => {
      const id = str(args.eic_plot_id);
      if (!id) throw new Error("eic_plot_id is required.");
      const el = eicPlotRefs.current[id];
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
      setHighlightedEicPlotId(id);
      window.setTimeout(() => setHighlightedEicPlotId((curr) => (curr === id ? null : curr)), 2200);
      return { eic_plot_id: id };
    });
    on("lcms.highlight_feature_row", (args) => {
      const eicPlotId = str(args.eic_plot_id) ?? featureRows.find((row) => row.id === str(args.feature_row_id))?.eicPlotId ?? null;
      if (!eicPlotId) throw new Error("No feature/eic target found.");
      setHighlightedEicPlotId(eicPlotId);
      window.setTimeout(() => setHighlightedEicPlotId((curr) => (curr === eicPlotId ? null : curr)), 2200);
      return { eic_plot_id: eicPlotId };
    });
    on("lcms.load_spectrum_at_rt", loadSpectrumFor);
    on("lcms.jump_to_rt", loadSpectrumFor);
    on("lcms.next_scan", () => {
      goNext();
      return { ok: true };
    });
    on("lcms.previous_scan", () => {
      goPrev();
      return { ok: true };
    });
    on("lcms.first_scan", () => {
      goFirst();
      return { ok: true };
    });
    on("lcms.last_scan", () => {
      goLast();
      return { ok: true };
    });
    on("lcms.select_session", (args) => {
      const sessionId = str(args.session_id);
      if (!sessionId) throw new Error("session_id is required.");
      if (!sessions.some((session) => session.session_id === sessionId)) {
        throw new Error(`Unknown session_id: ${sessionId}`);
      }
      setActiveSid(sessionId);
      return { session_id: sessionId };
    });
    on("lcms.set_polarity", (args) => {
      if (!isPolarity(args.polarity)) throw new Error("Invalid polarity.");
      setPolarity(args.polarity);
      return { polarity: args.polarity };
    });
    on("lcms.set_rt_unit", (args) => {
      const rt = str(args.rt_unit);
      if (!isRtUnit(rt)) throw new Error("Invalid RT unit.");
      setRtUnit(rt);
      return { rt_unit: rt };
    });
    on("lcms.set_overlay_sessions", (args) => {
      const ids = stringArray(args.session_ids);
      setOverlaySessionIds(ids);
      return { session_ids: ids };
    });
    on("lcms.toggle_overlay_spectrum", (args) => {
      const enabled = typeof args.enabled === "boolean" ? args.enabled : !overlaySpectrumEnabled;
      setOverlaySpectrumEnabled(enabled);
      return { enabled };
    });
    on("lcms.set_eic_overlay_settings", (args) => {
      const settings = obj(args.settings);
      setGraphSettings((prev) => ({ ...prev, eicOverlay: { ...prev.eicOverlay, ...settings } }));
      if (typeof args.enabled === "boolean") setOverlayEicEnabled(args.enabled);
      return { settings, enabled: typeof args.enabled === "boolean" ? args.enabled : overlayEicEnabled };
    });
    on("lcms.toggle_eic_overlay_mode", (args) => {
      const enabled = typeof args.enabled === "boolean" ? args.enabled : !overlayEicEnabled;
      setOverlayEicEnabled(enabled);
      return { enabled };
    });
    on("lcms.show_summed_region_spectrum", (args) => {
      const rawSpectrum = obj(args.spectrum) as unknown as SpectrumData;
      if (!Array.isArray(rawSpectrum.mz) || !Array.isArray(rawSpectrum.intensity)) {
        throw new Error("Spectrum payload is missing mz/intensity arrays.");
      }
      const sp = applyRegionIgnoredMassesToSpectrum(rawSpectrum);
      const sessionId = str(args.session_id);
      if (sessionId && sessionId !== activeSid) setActiveSid(sessionId);
      setSpectrum(sp);
      setSelectedRt(sp.meta.rt_min);
      if (sp.meta.rt_start != null && sp.meta.rt_end != null) {
        setSelectedRegion({ rtMin: sp.meta.rt_start, rtMax: sp.meta.rt_end });
      }
      return { spectrum_id: sp.meta.spectrum_id };
    });
    on("lcms.integrate_visible_eics", (args) => integratePlots(visibleEicPlots, num(args.selected_rt)));

    return () => unregister.forEach((fn) => fn());
  }, [
    active,
    activePolymerSettings,
    activeSid,
    applyRegionIgnoredMassesToSpectrum,
    browserAutomation,
    eicPlots.length,
    featureRows,
    goFirst,
    goLast,
    goNext,
    goPrev,
    overlayEicEnabled,
    overlaySpectrumEnabled,
    pol,
    selectedRt,
    sessions,
    setActiveSid,
    setOverlayEicEnabled,
    setOverlaySessionIds,
    setOverlaySpectrumEnabled,
    setPolarity,
    setRtUnit,
    spectrumMinRel,
    spectrumTopN,
    visibleEicPlots,
  ]);

  const rtFromPlotClick = (ev: Readonly<PlotMouseEvent>) => {
    const p = ev.points?.[0];
    if (!p || typeof p.x !== "number") return null;
    return rtUnit === "seconds" ? p.x / 60 : p.x;
  };

  const onTICClick = (ev: Readonly<PlotMouseEvent>) => {
    const rtMin = rtFromPlotClick(ev);
    if (rtMin != null) loadSpectrum(rtMin);
  };

  const onUVClick = (ev: Readonly<PlotMouseEvent>) => {
    const displayedRtMin = rtFromPlotClick(ev);
    if (displayedRtMin != null) {
      const uvRtMin = displayedRtMin - uvOffset;
      loadSpectrum(displayedRtMin, { uvRtMin });
    }
  };

  // --- header ---------------------------------------------------------------

  usePageHeader(
    <PageHeaderContent
      title="LCMS"
      subtitle="mzML viewer — TIC, UV, spectrum at click, top-peak annotation"
      actions={
        <>
          <HelpOpenButton onClick={() => setHelpOpen(true)} />
          <input
            ref={fileRef}
            type="file"
            accept=".mzML,.mzml"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = e.target.files ? Array.from(e.target.files) : [];
              if (files.length > 0) onUpload(files);
              e.target.value = "";
            }}
          />
          <input
            ref={workspaceFileRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void loadWorkspaceFile(file);
              e.target.value = "";
            }}
          />
          <Tooltip content="Load a saved workspace (.json)">
            <button
              className="rounded-md border border-ink-200 bg-surface px-3 py-2 text-sm text-ink-700 transition-colors hover:bg-ink-100"
              disabled={busy}
              onClick={() => workspaceFileRef.current?.click()}
            >
              Load workspace
            </button>
          </Tooltip>
          <Tooltip content={sessions.length === 0 ? "Open a file first" : "Save current workspace"}>
            <span>
              <button
                className="rounded-md border border-ink-200 bg-surface px-3 py-2 text-sm text-ink-700 transition-colors hover:bg-ink-100 disabled:cursor-not-allowed disabled:text-ink-400"
                disabled={busy || sessions.length === 0}
                onClick={saveWorkspace}
              >
                Save workspace
              </button>
            </span>
          </Tooltip>
          <button
            className="btn-primary"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            {busy ? "Loading…" : "Open mzML…"}
          </button>
        </>
      }
    />,
  );

  const statusText = useMemo(() => {
    const name = active?.display_name ?? "";
    const truncName = name.length > 32 ? name.slice(0, 30) + "…" : name;
    const ms1Count = active?.ms1_count ?? 0;
    const rtMin = active?.rt_min != null ? active.rt_min.toFixed(2) : null;
    const rtMax = active?.rt_max != null ? active.rt_max.toFixed(2) : null;
    const rtRange = rtMin != null && rtMax != null ? `${rtMin}–${rtMax} min` : null;
    const polLabel = polarity === "all" ? "all polarities" : polarity;
    const uvAttached = !!(active?.uv?.available && active.uv.filename);
    return { truncName, ms1Count, rtRange, polLabel, uvAttached, offset: uvOffset };
  }, [active, polarity, uvOffset]);

  // --- render ---------------------------------------------------------------

  return (
    <div className="flex h-full flex-col">
      {error && (
        <AlertBanner
          kind="error"
          message={error}
          onDismiss={() => setError(null)}
          className="border-b"
        />
      )}
      {info && (
        <AlertBanner
          kind="info"
          message={info}
          onDismiss={() => setInfo(null)}
          className="border-b"
        />
      )}

      <div className="flex min-h-0 flex-1">
        <SessionsSidebar
          sessions={sessions}
          activeSid={activeSid}
          projects={projects}
          sessionProjectById={sessionProjectById}
          activeProjectId={activeProjectId}
          onSelect={setActiveSid}
          onRemove={onRemove}
          onCreateProject={() => dispatchUiAction("lcms.create_project")}
          onDeleteProject={(projectId) => dispatchUiAction("lcms.delete_project", { project_id: projectId })}
          onMoveSession={(sessionId, projectId) =>
            dispatchUiAction("lcms.move_session_to_project", { session_id: sessionId, project_id: projectId })
          }
          onSelectProject={(projectId) => dispatchUiAction("lcms.select_project", { project_id: projectId })}
        />

        <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-auto p-6">
          <DatasetRibbon active={active} />

          {!active && <EmptyState onPick={() => fileRef.current?.click()} />}

          {active && (
            <>
              {showTIC && (
                <TICChart
                  tic={tic}
                  overlayTraces={ticOverlay}
                  onClick={onTICClick}
                  onRegionSelected={onRegionSelected}
                  selectedRt={selectedRt}
                  selectedRegion={selectedRegion}
                  selectedScanId={
                    spectrum?.meta.spectrum_id && !spectrum.meta.spectrum_id.startsWith("summed:")
                      ? spectrum.meta.spectrum_id
                      : null
                  }
                  rtUnit={rtUnit}
                  regionSelect={regionSelect}
                  settings={graphSettings.tic}
                />
              )}
              {visibleEicPlots.length > 0 && overlayEicEnabled ? (
                <EICChart
                  eics={visibleEicPlots}
                  selectedRt={selectedRt}
                  rtUnit={rtUnit}
                  onClick={onTICClick}
                  onClear={() =>
                    dispatchUiAction("lcms.clear_eics")
                  }
                  onIntegrate={integrateEicPlot}
                  onIntegrateAll={() =>
                    dispatchUiAction("lcms.integrate_visible_eics", {
                      selected_rt: selectedRt,
                    })
                  }
                  clearLabel="Clear file"
                  settings={graphSettings.eic}
                  overlaySettings={graphSettings.eicOverlay}
                />
              ) : (
                visibleEicPlots.map((plot) => (
                  <div
                    key={plot.id}
                    ref={(el) => {
                      eicPlotRefs.current[plot.id] = el;
                    }}
                    className={clsx(
                      "transition-shadow",
                      highlightedEicPlotId === plot.id &&
                        "rounded-md ring-2 ring-brand-500 ring-offset-2 ring-offset-canvas",
                    )}
                  >
                    <EICChart
                      eics={[plot]}
                      selectedRt={selectedRt}
                      rtUnit={rtUnit}
                      onClick={onTICClick}
                      onClear={() =>
                        setEicPlots((prev) => prev.filter((item) => item.id !== plot.id))
                      }
                      onIntegrate={integrateEicPlot}
                      settings={graphSettings.eic}
                      overlaySettings={graphSettings.eicOverlay}
                    />
                  </div>
                ))
              )}
              {showUV && (
                <UVChromatogramChart
                  uv={uv}
                  overlayTraces={uvOverlayWithLabels}
                  busy={uvBusy}
                  xOffset={uvOffset}
                  selectedUvRt={
                    selectedUvRt ?? (selectedRt != null ? selectedRt - uvOffset : null)
                  }
                  selectedScanId={
                    spectrum?.meta.spectrum_id && !spectrum.meta.spectrum_id.startsWith("summed:")
                      ? spectrum.meta.spectrum_id
                      : null
                  }
                  labels={uvTextLabels}
                  rtUnit={rtUnit}
                  onPickFile={() => dispatchUiAction("lcms.open_uv_file_picker")}
                  onRemove={() => dispatchUiAction("lcms.clear_uv")}
                  onClick={onUVClick}
                  onClearLabels={() => dispatchUiAction("lcms.clear_uv_labels")}
                  onDeleteLabel={deleteUvLabel}
                  onEditLabel={editUvLabel}
                  onMoveLabel={moveUvLabel}
                  bunchLabels={uvBunchLabels}
                  bunchOffsets={uvBunchOffsets}
                  bunchHubOffset={uvBunchHubOffset}
                  labelOrientation={uvLabelOrientation}
                  settings={graphSettings.uv}
                />
              )}
              {showSpectrum && (
                <SpectrumChart
                  spectrum={spectrum}
                  overlayTraces={spectrumOverlay}
                  annotate={annotateSpectrum}
                  showOverlayLabels={showOverlayLabels}
                  showDragHint={enableDragLabels}
                  selectedRt={selectedRt}
                  rtUnit={rtUnit}
                  settings={graphSettings.spectrum}
                  polymerEnabled={Boolean(activePolymerSettings)}
                  onPeakClick={onSpectrumPeakClick}
                />
              )}
            </>
          )}

          <input
            ref={uvFileRef}
            type="file"
            multiple
            accept=".csv,.tsv,.txt,text/csv"
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              if (files.length > 0) void onUploadUVFiles(files);
              e.target.value = "";
            }}
          />
        </div>

        <ToolsPanel
          // Primary actions
          onEIC={() => dispatchUiAction("lcms.open_dialog", { dialog: "eic" })}
          onJumpMz={() => dispatchUiAction("lcms.open_dialog", { dialog: "find_mz" })}
          onExportLabels={() => dispatchUiAction("lcms.export_labels_csv")}
          onExportSpectrum={() => dispatchUiAction("lcms.export_spectrum_csv")}
          onExportUV={() => dispatchUiAction("lcms.export_uv_csv")}
          onExportTICOverlay={() => dispatchUiAction("lcms.export_tic_overlay_csv")}
          onSumRegionSpectrum={loadSummedRegionSpectrum}
          onFeatureTable={() => dispatchUiAction("lcms.open_dialog", { dialog: "feature_table" })}
          onComparisonMatrix={() => void openComparisonMatrix()}
          featureCount={featureRows.length}
          busy={busy}
          activeLoaded={!!active}
          // Workflow chrome
          workflowHidden={workflowHidden}
          setWorkflowHidden={setWorkflowHidden}
          showPolymerControls={showPolymerControls}
          setShowPolymerControls={setShowPolymerControls}
          showConfidenceControls={showConfidenceControls}
          setShowConfidenceControls={setShowConfidenceControls}
          showAlignmentDiagnostics={showAlignmentDiagnostics}
          setShowAlignmentDiagnostics={setShowAlignmentDiagnostics}
          // Tabs
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          // Navigate
          onPrev={() => dispatchUiAction("lcms.previous_scan")}
          onNext={() => dispatchUiAction("lcms.next_scan")}
          onFirst={() => dispatchUiAction("lcms.first_scan")}
          onLast={() => dispatchUiAction("lcms.last_scan")}
          onFindMz={() => dispatchUiAction("lcms.open_dialog", { dialog: "find_mz" })}
          onAutoAlignUV={() => dispatchUiAction("lcms.auto_align_uv")}
          onEICDialog={() => dispatchUiAction("lcms.open_dialog", { dialog: "eic" })}
          rtJumpText={rtJumpText}
          setRtJumpText={setRtJumpText}
          onRtJump={() => {
            const t = parseFloat(rtJumpText);
            if (!Number.isFinite(t)) return;
            dispatchUiAction("lcms.jump_to_rt", {
              rt_min: rtUnit === "seconds" ? t / 60.0 : t,
              polarity: pol,
            });
          }}
          rtUnit={rtUnit}
          // View
          polarity={polarity}
          setPolarity={setPolarity}
          setRtUnit={setRtUnit}
          uvOffsetText={uvOffsetText}
          setUvOffsetText={setUvOffsetText}
          onApplyOffset={() => {
            const v = parseFloat(uvOffsetText);
            setUvOffset(Number.isFinite(v) ? v : 0);
          }}
          autoAlignUv={autoAlignUv}
          setAutoAlignUv={setAutoAlignUv}
          onGraphSettings={() => dispatchUiAction("lcms.open_dialog", { dialog: "graph_settings" })}
          showTIC={showTIC}
          setShowTIC={setShowTIC}
          showSpectrum={showSpectrum}
          setShowSpectrum={setShowSpectrum}
          showUV={showUV}
          setShowUV={setShowUV}
          regionSelect={regionSelect}
          setRegionSelect={handleSetRegionSelect}
          regionIgnoredMzText={regionIgnoredMzText}
          setRegionIgnoredMzText={setRegionIgnoredMzText}
          regionIgnoredMzTolerance={regionIgnoredMzTolerance}
          setRegionIgnoredMzTolerance={setRegionIgnoredMzTolerance}
          regionIgnoredCount={regionIgnoredMasses.length}
          overlayTicEnabled={overlayTicEnabled}
          setOverlayTicEnabled={setOverlayTicEnabled}
          overlayUvEnabled={overlayUvEnabled}
          setOverlayUvEnabled={setOverlayUvEnabled}
          overlaySpectrumEnabled={overlaySpectrumEnabled}
          setOverlaySpectrumEnabled={setOverlaySpectrumEnabled}
          overlayEicEnabled={overlayEicEnabled}
          setOverlayEicEnabled={setOverlayEicEnabled}
          overlaySessionIds={overlaySessionIds}
          setOverlaySessionIds={setOverlaySessionIds}
          sessions={projectSessions}
          // Annotate – spectrum
          annotateSpectrum={annotateSpectrum}
          setAnnotateSpectrum={setAnnotateSpectrum}
          spectrumTopN={spectrumTopN}
          setSpectrumTopN={setSpectrumTopN}
          spectrumMinRel={spectrumMinRel}
          setSpectrumMinRel={setSpectrumMinRel}
          enableDragLabels={enableDragLabels}
          setEnableDragLabels={setEnableDragLabels}
          // Annotate – UV
          transferMsToUv={transferMsToUv}
          setTransferMsToUv={setTransferMsToUvAndMaybeApply}
          uvTransferCount={uvTransferCount}
          setUvTransferCount={setUvTransferCount}
          uvProminence={uvProminence}
          setUvProminence={setUvProminence}
          uvMinDistance={uvMinDistance}
          setUvMinDistance={setUvMinDistance}
          snapUvLabels={snapUvLabels}
          setSnapUvLabels={setSnapUvLabels}
          uvBunchLabels={uvBunchLabels}
          setUvBunchLabels={setUvBunchLabels}
          uvBunchHubOffset={uvBunchHubOffset}
          setUvBunchHubOffset={setUvBunchHubOffset}
          uvLabelOrientation={uvLabelOrientation}
          setUvLabelOrientation={setUvLabelOrientation}
          uvLabelStairXStep={uvLabelStairXStep}
          setUvLabelStairXStep={setUvLabelStairXStep}
          uvLabelStairYStep={uvLabelStairYStep}
          setUvLabelStairYStep={setUvLabelStairYStep}
          onLabelSelectedRT={transferSelectedSpectrumToUv}
          onAutoLabelUV={() => dispatchUiAction("lcms.auto_label_uv")}
          onCustomUvLabel={() => dispatchUiAction("lcms.open_custom_uv_label")}
          onAutoArrangeLabels={autoArrangeUvLabels}
          canAddCustomUvLabel={uv?.available === true && (selectedUvRt != null || selectedRt != null)}
          uvLabelCount={uvTextLabels.length}
          // Annotate – overlay
          showOverlayLabels={showOverlayLabels}
          setShowOverlayLabels={setShowOverlayLabels}
          multiDragOverlay={multiDragOverlay}
          setMultiDragOverlay={setMultiDragOverlay}
          // Polymer
          polymerSettings={polymerSettings}
          setPolymerSettings={setPolymerSettings}
          onPolymerDialog={() => void openPolymerDialogWithMatch()}
          onExpectedProducts={() => void openExpectedProductsWithCompute()}
          onKendrick={() => void openKendrickWithCompute()}
          canOpenExpectedProducts={Boolean(spectrum && polarity !== "all" && polymerMonomerText(polymerSettings))}
          canOpenKendrick={Boolean(spectrum)}
          onSavePolymerDefaults={savePolymerDefaults}
        />
      </div>

      <StatusBar {...statusText} />

      {findMzOpen && (
        <FindMzDialog
          input={findMzInput}
          setInput={setFindMzInput}
          tol={findMzTol}
          setTol={setFindMzTol}
          busy={busy}
          onClose={() => setFindMzOpen(false)}
          onRun={findMz}
        />
      )}
      {eicOpen && (
        <EICDialog
          input={eicInput}
          setInput={setEicInput}
          tol={eicTol}
          setTol={setEicTol}
          busy={busy}
          onClose={() => setEicOpen(false)}
          onRun={runEIC}
        />
      )}
      {graphSettingsOpen && (
        <GraphSettingsDialog
          settings={graphSettings}
          onChange={setGraphSettings}
          overlayEicEnabled={overlayEicEnabled}
          setOverlayEicEnabled={setOverlayEicEnabled}
          onSetDefault={() => {
            saveGraphSettingsDefault(graphSettings);
            setInfo("Saved current graph settings as the default.");
          }}
          onReset={() => setGraphSettings(loadGraphSettingsDefault())}
          onClose={() => setGraphSettingsOpen(false)}
        />
      )}
      {polymerDialogOpen && (
        <PolymerDialog
          polarity={polarity}
          settings={polymerSettings}
          onChange={setPolymerSettings}
          onClose={() => setPolymerDialogOpen(false)}
        />
      )}
      {expectedProductsOpen && polarity !== "all" && (
        <ExpectedProductsDialog
          polarity={polarity}
          settings={polymerSettings}
          spectrum={spectrum}
          tic={tic}
          activeSid={activeSid}
          onCreateEic={(mz, tolerance, metadata) => void createEICForMz(mz, "expected", tolerance, metadata)}
          onClose={() => setExpectedProductsOpen(false)}
        />
      )}
      {kendrickOpen && (
        <KendrickDialog
          spectrum={spectrum}
          settings={polymerSettings}
          onCreateEic={(mz, tolerance) => void createEICForMz(mz, "spectrum", tolerance)}
          onClose={() => setKendrickOpen(false)}
        />
      )}
      {featureTableOpen && (
        <FeatureTableDialog
          rows={featureRows}
          onDelete={(id) => setFeatureRows((prev) => prev.filter((row) => row.id !== id))}
          onClear={() => setFeatureRows([])}
          onExportCsv={() => void exportFeatureTableCsv(featureRows)}
          onClose={() => setFeatureTableOpen(false)}
          onUpdate={(id, patch) =>
            setFeatureRows((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)))
          }
          onLocate={(eicPlotId) => {
            setFeatureTableOpen(false);
            const el = eicPlotRefs.current[eicPlotId];
            if (el) {
              el.scrollIntoView({ behavior: "smooth", block: "center" });
              setHighlightedEicPlotId(eicPlotId);
              window.setTimeout(() => setHighlightedEicPlotId((curr) => (curr === eicPlotId ? null : curr)), 2200);
            }
          }}
        />
      )}
      {comparisonMatrixOpen && (
        <ComparisonMatrixDialog
          rows={featureRows}
          sessions={sessions}
          onExportCsv={exportComparisonMatrixCsv}
          onClose={() => setComparisonMatrixOpen(false)}
        />
      )}
      {customUvLabelDraft && (
        <CustomUvLabelDialog
          draft={customUvLabelDraft}
          onChange={setCustomUvLabelDraft}
          onClose={() => setCustomUvLabelDraft(null)}
          onSave={saveCustomUvLabel}
        />
      )}
      {helpModule ? (
        <HelpShell open={helpOpen} module={helpModule} onClose={() => setHelpOpen(false)} />
      ) : null}
    </div>
  );
}

// --- Left: sessions list -----------------------------------------------------

const SESSIONS_PIN_STORAGE_KEY = "mfp.lcms.sessions.pinned";

function SessionsSidebar(props: {
  sessions: LCMSSessionSummary[];
  activeSid: string | null;
  projects: LCMSProject[];
  sessionProjectById: Record<string, string | null>;
  activeProjectId: LCMSActiveProjectId;
  onSelect: (sid: string) => void;
  onRemove: (sid: string) => void;
  onCreateProject: () => void;
  onDeleteProject: (projectId: string) => void;
  onMoveSession: (sessionId: string, projectId: string | null) => void;
  onSelectProject: (projectId: LCMSActiveProjectId) => void;
}) {
  const [pinned, setPinned] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    const stored = window.localStorage.getItem(SESSIONS_PIN_STORAGE_KEY);
    return stored === "1";
  });
  const [hovered, setHovered] = useState(false);
  const [openProjectId, setOpenProjectId] = useState<LCMSActiveProjectId>("__unassigned");
  const hideTimer = useRef<number | null>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        SESSIONS_PIN_STORAGE_KEY,
        pinned ? "1" : "0",
      );
    } catch {
      /* ignore (private mode / SSR) */
    }
  }, [pinned]);

  const expanded = pinned || hovered || openProjectId !== "__all";
  const unassignedSessions = props.sessions.filter((session) => !props.sessionProjectById[session.session_id]);
  const sessionsByProject = useMemo(() => {
    const grouped = new Map<string, LCMSSessionSummary[]>();
    props.projects.forEach((project) => grouped.set(project.id, []));
    props.sessions.forEach((session) => {
      const projectId = props.sessionProjectById[session.session_id];
      if (projectId) grouped.get(projectId)?.push(session);
    });
    return grouped;
  }, [props.projects, props.sessionProjectById, props.sessions]);

  const toggleProjectOpen = (key: string) => {
    setOpenProjectId((prev) => (prev === key ? "__all" : key));
  };

  const handleDropSession = (event: DragEvent, projectId: string | null) => {
    event.preventDefault();
    const sessionId = event.dataTransfer.getData("text/plain");
    if (sessionId) props.onMoveSession(sessionId, projectId);
  };

  // Debounce mouse-leave slightly so flicking across a scrollbar or
  // trailing-edge padding doesn't collapse the panel mid-click.
  const onEnter = () => {
    if (hideTimer.current !== null) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
    setHovered(true);
  };
  const onLeave = () => {
    if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setHovered(false), 120);
  };
  useEffect(() => () => {
    if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
  }, []);
  useEffect(() => {
    const available = new Set(["__all", "__unassigned", ...props.projects.map((project) => project.id)]);
    if (!available.has(openProjectId)) setOpenProjectId("__unassigned");
  }, [openProjectId, props.projects]);

  return (
    <aside
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      aria-expanded={expanded}
      className={clsx(
        "flex shrink-0 flex-col overflow-hidden border-r border-ink-200 bg-ink-50/50",
        "transition-[width] duration-200 ease-out",
        expanded ? "w-60" : "w-12",
      )}
    >
      <header
        className={clsx(
          "flex shrink-0 items-center gap-2 border-b border-ink-200/60 py-2",
          expanded ? "px-3" : "justify-center px-0",
        )}
      >
        {expanded ? (
          <>
            <span className="label flex-1 truncate">Sessions</span>
            <button
              type="button"
              onClick={props.onCreateProject}
              title="Create project"
              className="rounded-md border border-ink-200 bg-surface px-1.5 py-0.5 text-[11px] font-medium text-ink-700 hover:bg-ink-100"
            >
              + Project
            </button>
            <button
              type="button"
              onClick={() => setPinned((p) => !p)}
              title={
                pinned
                  ? "Unpin sessions panel (collapse when not hovered)"
                  : "Pin sessions panel (always open)"
              }
              aria-label={pinned ? "Unpin sessions panel" : "Pin sessions panel"}
              aria-pressed={pinned}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink-500 transition-colors hover:bg-ink-200/60 hover:text-ink-800"
            >
              <IconPin pinned={pinned} className="h-3.5 w-3.5" />
            </button>
          </>
        ) : (
          // Collapsed affordance: a stack icon that hints the panel holds a list
          // of items. Hovering the whole aside already expands it, so this is
          // purely a visual cue.
          <div
            className="flex h-7 w-7 items-center justify-center rounded-md text-ink-500"
            title="Sessions (hover to expand, click to pin)"
            aria-hidden="true"
          >
            <IconStack className="h-4 w-4" />
          </div>
        )}
      </header>

      <div
        className={clsx(
          "flex flex-1 flex-col overflow-auto",
          expanded ? "gap-1 p-2" : "items-center gap-1 py-2",
        )}
      >
        {expanded && props.sessions.length === 0 && (
          <div className="px-2 text-xs text-ink-500">No files loaded.</div>
        )}

        {!expanded &&
          props.sessions.map((s, idx) => {
            const isActive = s.session_id === props.activeSid;
            return (
              <button
                key={s.session_id}
                type="button"
                onClick={() => props.onSelect(s.session_id)}
                title={s.display_name}
                className={clsx(
                  "flex h-7 w-8 shrink-0 items-center justify-center rounded-md border text-[10px] font-semibold transition-colors",
                  isActive
                    ? "border-brand-500 bg-surface text-brand-600 shadow-card"
                    : "border-transparent text-ink-500 hover:border-ink-200 hover:bg-surface",
                )}
              >
                {idx + 1}
              </button>
            );
          })}

        {expanded && props.sessions.length > 0 && (
          <>
            <button
              type="button"
              className={clsx(
                "rounded-md px-2 py-1 text-left text-xs font-semibold",
                props.activeProjectId === "__all"
                  ? "bg-brand-500/10 text-brand-700"
                  : "text-ink-600 hover:bg-ink-100",
              )}
              onClick={() => props.onSelectProject("__all")}
            >
              All <span className="font-mono text-[10px] text-ink-400">{props.sessions.length}</span>
            </button>
            <ProjectHeaderRow
              id="__unassigned"
              title="Unassigned"
              count={unassignedSessions.length}
              activeProjectId={props.activeProjectId}
              expanded={openProjectId === "__unassigned"}
              targetProjectId={null}
              builtin
              onToggle={() => toggleProjectOpen("__unassigned")}
              onSelectProject={() => props.onSelectProject("__unassigned")}
              onDropSession={handleDropSession}
            />
            {props.projects.map((project) => (
              <ProjectHeaderRow
                key={project.id}
                id={project.id}
                title={project.name}
                count={sessionsByProject.get(project.id)?.length ?? 0}
                activeProjectId={props.activeProjectId}
                expanded={openProjectId === project.id}
                targetProjectId={project.id}
                onToggle={() => toggleProjectOpen(project.id)}
                onSelectProject={() => props.onSelectProject(project.id)}
                onDeleteProject={() => props.onDeleteProject(project.id)}
                onDropSession={handleDropSession}
              />
            ))}
            <div className="mt-1 flex flex-col gap-1 border-t border-ink-200/70 pt-1">
              {openProjectId === "__unassigned" && (
                <ProjectSessionRows
                  sessions={unassignedSessions}
                  activeSid={props.activeSid}
                  projects={props.projects}
                  sessionProjectById={props.sessionProjectById}
                  onSelectSession={props.onSelect}
                  onRemoveSession={props.onRemove}
                  onMoveSession={props.onMoveSession}
                />
              )}
              {props.projects.map((project) =>
                openProjectId === project.id ? (
                  <ProjectSessionRows
                    key={project.id}
                    sessions={sessionsByProject.get(project.id) ?? []}
                    activeSid={props.activeSid}
                    projects={props.projects}
                    sessionProjectById={props.sessionProjectById}
                    onSelectSession={props.onSelect}
                    onRemoveSession={props.onRemove}
                    onMoveSession={props.onMoveSession}
                  />
                ) : null,
              )}
            </div>
          </>
        )}

        {false && props.sessions.map((s, idx) => {
          const isActive = s.session_id === props.activeSid;
          if (!expanded) {
            // Compact rail: small active-aware chip per session.
            return (
              <button
                key={s.session_id}
                type="button"
                onClick={() => props.onSelect(s.session_id)}
                title={s.display_name}
                className={clsx(
                  "flex h-7 w-8 shrink-0 items-center justify-center rounded-md border text-[10px] font-semibold transition-colors",
                  isActive
                    ? "border-brand-500 bg-surface text-brand-600 shadow-card"
                    : "border-transparent text-ink-500 hover:border-ink-200 hover:bg-surface",
                )}
              >
                {idx + 1}
              </button>
            );
          }
          return (
            <div
              key={s.session_id}
              className={clsx(
                "group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm",
                isActive ? "bg-surface shadow-card" : "hover:bg-ink-100",
              )}
              onClick={() => props.onSelect(s.session_id)}
            >
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{s.display_name}</div>
                <div className="text-[11px] text-ink-500">
                  {s.ms1_count} MS1 • {formatRange(s.rt_min, s.rt_max)} min
                  {s.uv?.available && " • UV"}
                </div>
              </div>
              <button
                className="invisible rounded px-1 text-xs text-ink-500 hover:bg-ink-200 hover:text-ink-900 group-hover:visible"
                onClick={(e) => {
                  e.stopPropagation();
                  props.onRemove(s.session_id);
                }}
                title="Remove"
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

function ProjectHeaderRow(props: {
  id: LCMSActiveProjectId;
  title: string;
  count: number;
  activeProjectId: LCMSActiveProjectId;
  expanded: boolean;
  targetProjectId: string | null;
  builtin?: boolean;
  onToggle: () => void;
  onSelectProject: () => void;
  onDeleteProject?: () => void;
  onDropSession: (event: DragEvent, projectId: string | null) => void;
}) {
  const isActiveProject = props.activeProjectId === props.id;
  return (
    <section
      className="rounded-md"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => props.onDropSession(event, props.targetProjectId)}
    >
      <div
        className={clsx(
          "flex items-center gap-1 rounded-md px-2 py-1 text-xs",
          isActiveProject ? "bg-brand-500/10 text-brand-700" : "text-ink-600 hover:bg-ink-100",
        )}
      >
        <button
          type="button"
          className="h-5 w-5 rounded text-[10px] hover:bg-ink-200/70"
          onClick={props.onToggle}
          aria-label={props.expanded ? "Collapse project" : "Expand project"}
        >
          {props.expanded ? "v" : ">"}
        </button>
        <button
          type="button"
          className="min-w-0 flex-1 truncate text-left font-semibold"
          onClick={props.onSelectProject}
          title={props.title}
        >
          {props.title}
        </button>
        <span className="font-mono text-[10px] text-ink-400">{props.count}</span>
        {!props.builtin && props.onDeleteProject && (
          <button
            type="button"
            className="rounded px-1 text-[10px] text-ink-400 hover:bg-ink-200 hover:text-ink-800"
            onClick={props.onDeleteProject}
            title="Delete project"
          >
            x
          </button>
        )}
      </div>
    </section>
  );
}

function ProjectSessionRows(props: {
  sessions: LCMSSessionSummary[];
  activeSid: string | null;
  projects: LCMSProject[];
  sessionProjectById: Record<string, string | null>;
  onSelectSession: (sid: string) => void;
  onRemoveSession: (sid: string) => void;
  onMoveSession: (sessionId: string, projectId: string | null) => void;
}) {
  if (props.sessions.length === 0) {
    return <div className="px-2 py-1 text-[11px] text-ink-400">No files</div>;
  }

  return (
    <>
      {props.sessions.map((session) => {
        const isActive = session.session_id === props.activeSid;
        const currentProject = props.sessionProjectById[session.session_id] ?? "__unassigned";
        return (
          <div
            key={session.session_id}
            draggable
            onDragStart={(event) => {
              event.dataTransfer.setData("text/plain", session.session_id);
              event.dataTransfer.effectAllowed = "move";
            }}
            className={clsx(
              "group ml-3 flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm",
              isActive ? "bg-surface shadow-card" : "hover:bg-ink-100",
            )}
            onClick={() => props.onSelectSession(session.session_id)}
          >
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{session.display_name}</div>
              <div className="text-[11px] text-ink-500">
                {session.ms1_count} MS1 - {formatRange(session.rt_min, session.rt_max)} min
                {session.uv?.available && " - UV"}
              </div>
            </div>
            <select
              className="max-w-[5.5rem] rounded border border-ink-200 bg-surface px-1 py-0.5 text-[10px] text-ink-600 opacity-0 transition-opacity group-hover:opacity-100"
              value={currentProject}
              title="Move to project"
              onClick={(event) => event.stopPropagation()}
              onChange={(event) => {
                event.stopPropagation();
                props.onMoveSession(
                  session.session_id,
                  event.target.value === "__unassigned" ? null : event.target.value,
                );
              }}
            >
              <option value="__unassigned">Unassigned</option>
              {props.projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
            <button
              className="invisible rounded px-1 text-xs text-ink-500 hover:bg-ink-200 hover:text-ink-900 group-hover:visible"
              onClick={(event) => {
                event.stopPropagation();
                props.onRemoveSession(session.session_id);
              }}
              title="Remove"
            >
              x
            </button>
          </div>
        );
      })}
    </>
  );
}

function ProjectSessionSection(props: {
  id: LCMSActiveProjectId;
  title: string;
  sessions: LCMSSessionSummary[];
  activeSid: string | null;
  activeProjectId: LCMSActiveProjectId;
  projects: LCMSProject[];
  sessionProjectById: Record<string, string | null>;
  expanded: boolean;
  targetProjectId: string | null;
  builtin?: boolean;
  onToggle: () => void;
  onSelectProject: () => void;
  onDeleteProject?: () => void;
  onSelectSession: (sid: string) => void;
  onRemoveSession: (sid: string) => void;
  onMoveSession: (sessionId: string, projectId: string | null) => void;
  onDropSession: (event: DragEvent, projectId: string | null) => void;
}) {
  const isActiveProject = props.activeProjectId === props.id;
  return (
    <section
      className="rounded-md"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => props.onDropSession(event, props.targetProjectId)}
    >
      <div
        className={clsx(
          "flex items-center gap-1 rounded-md px-2 py-1 text-xs",
          isActiveProject ? "bg-brand-500/10 text-brand-700" : "text-ink-600 hover:bg-ink-100",
        )}
      >
        <button
          type="button"
          className="h-5 w-5 rounded text-[10px] hover:bg-ink-200/70"
          onClick={props.onToggle}
          aria-label={props.expanded ? "Collapse project" : "Expand project"}
        >
          {props.expanded ? "v" : ">"}
        </button>
        <button
          type="button"
          className="min-w-0 flex-1 truncate text-left font-semibold"
          onClick={props.onSelectProject}
          title={props.title}
        >
          {props.title}
        </button>
        <span className="font-mono text-[10px] text-ink-400">{props.sessions.length}</span>
        {!props.builtin && props.onDeleteProject && (
          <button
            type="button"
            className="rounded px-1 text-[10px] text-ink-400 hover:bg-ink-200 hover:text-ink-800"
            onClick={props.onDeleteProject}
            title="Delete project"
          >
            x
          </button>
        )}
      </div>
      {props.expanded && (
        <div className="mt-1 flex flex-col gap-1 pl-3">
          {props.sessions.length === 0 ? (
            <div className="px-2 py-1 text-[11px] text-ink-400">No files</div>
          ) : (
            props.sessions.map((session) => {
              const isActive = session.session_id === props.activeSid;
              const currentProject = props.sessionProjectById[session.session_id] ?? "__unassigned";
              return (
                <div
                  key={session.session_id}
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.setData("text/plain", session.session_id);
                    event.dataTransfer.effectAllowed = "move";
                  }}
                  className={clsx(
                    "group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm",
                    isActive ? "bg-surface shadow-card" : "hover:bg-ink-100",
                  )}
                  onClick={() => props.onSelectSession(session.session_id)}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{session.display_name}</div>
                    <div className="text-[11px] text-ink-500">
                      {session.ms1_count} MS1 - {formatRange(session.rt_min, session.rt_max)} min
                      {session.uv?.available && " - UV"}
                    </div>
                  </div>
                  <select
                    className="max-w-[5.5rem] rounded border border-ink-200 bg-surface px-1 py-0.5 text-[10px] text-ink-600 opacity-0 transition-opacity group-hover:opacity-100"
                    value={currentProject}
                    title="Move to project"
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => {
                      event.stopPropagation();
                      props.onMoveSession(
                        session.session_id,
                        event.target.value === "__unassigned" ? null : event.target.value,
                      );
                    }}
                  >
                    <option value="__unassigned">Unassigned</option>
                    {props.projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                  </select>
                  <button
                    className="invisible rounded px-1 text-xs text-ink-500 hover:bg-ink-200 hover:text-ink-900 group-hover:visible"
                    onClick={(event) => {
                      event.stopPropagation();
                      props.onRemoveSession(session.session_id);
                    }}
                    title="Remove"
                  >
                    x
                  </button>
                </div>
              );
            })
          )}
        </div>
      )}
    </section>
  );
}

function IconStack({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M4 6h16" />
      <path d="M4 12h16" />
      <path d="M4 18h16" />
    </svg>
  );
}

function IconPin({
  pinned,
  className,
}: {
  pinned: boolean;
  className?: string;
}) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className,
  };
  if (pinned) {
    return (
      <svg {...common}>
        <path d="M12 17v5" />
        <path
          d="M9 10.76a2 2 0 0 1 -1.11 1.79l-1.78 .9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1 -1v-.76a2 2 0 0 0 -1.11 -1.79l-1.78 -.9A2 2 0 0 1 15 10.76V5a1 1 0 0 1 1 -1a2 2 0 0 0 0 -4H8a2 2 0 0 0 0 4a1 1 0 0 1 1 1z"
          fill="currentColor"
          fillOpacity={0.18}
        />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M12 17v5" />
      <path d="M15 9.34V7a1 1 0 0 1 1 -1a2 2 0 0 0 0 -4H7.89" />
      <path d="M9 9v1.76a2 2 0 0 1 -1.11 1.79l-1.78 .9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h9" />
      <path d="m2 2 20 20" />
    </svg>
  );
}

function IconChevronLeft({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M15 6l-6 6 6 6" />
    </svg>
  );
}

function IconChevronRight({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

// --- Centre: dataset ribbon --------------------------------------------------

function DatasetRibbon(props: { active: LCMSSessionSummary | null }) {
  const a = props.active;
  return (
    <div className="card flex flex-wrap items-center gap-6 px-4 py-3">
      <Field label="Dataset" value={a?.display_name ?? "—"} strong />
      <Field label="MS1 scans" value={a?.ms1_count ?? "—"} />
      <Field
        label="RT range (min)"
        value={formatRange(a?.rt_min ?? null, a?.rt_max ?? null)}
      />
      <Field
        label="Polarities in file"
        value={a?.polarities?.length ? a.polarities.join(", ") : "—"}
      />
      <Field
        label="UV"
        value={a?.uv?.available ? a.uv.filename ?? "attached" : "—"}
      />
    </div>
  );
}

function Field({
  label,
  value,
  strong,
}: {
  label: string;
  value: ReactNode;
  strong?: boolean;
}) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className={clsx("text-sm", strong && "font-medium")}>{value}</div>
    </div>
  );
}

// --- Right: tools panel ------------------------------------------------------

interface ToolsPanelProps {
  // primary
  onEIC: () => void;
  onJumpMz: () => void;
  onExportLabels: () => void;
  onExportSpectrum: () => void;
  onExportUV: () => void;
  onExportTICOverlay: () => void;
  onSumRegionSpectrum: () => void;
  onFeatureTable: () => void;
  onComparisonMatrix: () => void;
  featureCount: number;
  busy: boolean;
  activeLoaded: boolean;
  // chrome
  workflowHidden: boolean;
  setWorkflowHidden: (v: boolean) => void;
  showPolymerControls: boolean;
  setShowPolymerControls: (v: boolean) => void;
  showConfidenceControls: boolean;
  setShowConfidenceControls: (v: boolean) => void;
  showAlignmentDiagnostics: boolean;
  setShowAlignmentDiagnostics: (v: boolean) => void;
  // tabs
  activeTab: TabId;
  setActiveTab: (t: TabId) => void;
  // nav
  onPrev: () => void;
  onNext: () => void;
  onFirst: () => void;
  onLast: () => void;
  onFindMz: () => void;
  onAutoAlignUV: () => void;
  onEICDialog: () => void;
  rtJumpText: string;
  setRtJumpText: (v: string) => void;
  onRtJump: () => void;
  rtUnit: RtUnit;
  // view
  polarity: Polarity;
  setPolarity: (p: Polarity) => void;
  setRtUnit: (u: RtUnit) => void;
  uvOffsetText: string;
  setUvOffsetText: (v: string) => void;
  onApplyOffset: () => void;
  autoAlignUv: boolean;
  setAutoAlignUv: (v: boolean) => void;
  onGraphSettings: () => void;
  showTIC: boolean;
  setShowTIC: (v: boolean) => void;
  showSpectrum: boolean;
  setShowSpectrum: (v: boolean) => void;
  showUV: boolean;
  setShowUV: (v: boolean) => void;
  regionSelect: boolean;
  setRegionSelect: (v: boolean) => void;
  regionIgnoredMzText: string;
  setRegionIgnoredMzText: (v: string) => void;
  regionIgnoredMzTolerance: number;
  setRegionIgnoredMzTolerance: (v: number) => void;
  regionIgnoredCount: number;
  overlayTicEnabled: boolean;
  setOverlayTicEnabled: (v: boolean) => void;
  overlayUvEnabled: boolean;
  setOverlayUvEnabled: (v: boolean) => void;
  overlaySpectrumEnabled: boolean;
  setOverlaySpectrumEnabled: (v: boolean) => void;
  overlayEicEnabled: boolean;
  setOverlayEicEnabled: (v: boolean) => void;
  overlaySessionIds: string[];
  setOverlaySessionIds: (ids: string[]) => void;
  sessions: LCMSSessionSummary[];
  // annotate – spectrum
  annotateSpectrum: boolean;
  setAnnotateSpectrum: (v: boolean) => void;
  spectrumTopN: number;
  setSpectrumTopN: (v: number) => void;
  spectrumMinRel: number;
  setSpectrumMinRel: (v: number) => void;
  enableDragLabels: boolean;
  setEnableDragLabels: (v: boolean) => void;
  // annotate – uv
  transferMsToUv: boolean;
  setTransferMsToUv: (v: boolean) => void;
  uvTransferCount: number;
  setUvTransferCount: (v: number) => void;
  uvProminence: number;
  setUvProminence: (v: number) => void;
  uvMinDistance: number;
  setUvMinDistance: (v: number) => void;
  snapUvLabels: boolean;
  setSnapUvLabels: (v: boolean) => void;
  uvBunchLabels: boolean;
  setUvBunchLabels: (v: boolean) => void;
  uvBunchHubOffset: number;
  setUvBunchHubOffset: (v: number) => void;
  uvLabelOrientation: UVLabelOrientation;
  setUvLabelOrientation: (v: UVLabelOrientation) => void;
  uvLabelStairXStep: number;
  setUvLabelStairXStep: (v: number) => void;
  uvLabelStairYStep: number;
  setUvLabelStairYStep: (v: number) => void;
  onLabelSelectedRT: () => void;
  onAutoLabelUV: () => void;
  onCustomUvLabel: () => void;
  onAutoArrangeLabels: () => void;
  canAddCustomUvLabel: boolean;
  uvLabelCount: number;
  // annotate – overlay
  showOverlayLabels: boolean;
  setShowOverlayLabels: (v: boolean) => void;
  multiDragOverlay: boolean;
  setMultiDragOverlay: (v: boolean) => void;
  // polymer
  polymerSettings: PolymerUiSettings;
  setPolymerSettings: (v: PolymerUiSettings) => void;
  onPolymerDialog: () => void;
  onExpectedProducts: () => void;
  onKendrick: () => void;
  canOpenExpectedProducts: boolean;
  canOpenKendrick: boolean;
  onSavePolymerDefaults: () => void;
}

function ToolsPanel(p: ToolsPanelProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      aria-expanded={!collapsed}
      className={clsx(
        "flex shrink-0 flex-col border-l border-ink-200 bg-ink-50/40",
        "transition-[width] duration-200 ease-out",
        collapsed ? "w-10 overflow-hidden" : "w-80 overflow-auto",
      )}
    >
      {collapsed ? (
        <div className="flex flex-col items-center py-2">
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            title="Expand tools panel"
            aria-label="Expand tools panel"
            className="flex h-7 w-7 items-center justify-center rounded-md text-ink-500 transition-colors hover:bg-ink-200/60 hover:text-ink-800"
          >
            <IconChevronLeft className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <>
          <PrimaryActions
            onEIC={p.onEIC}
            onJumpMz={p.onJumpMz}
            onExportLabels={p.onExportLabels}
            onExportSpectrum={p.onExportSpectrum}
            onExportUV={p.onExportUV}
            onExportTICOverlay={p.onExportTICOverlay}
            onSumRegionSpectrum={p.onSumRegionSpectrum}
            onFeatureTable={p.onFeatureTable}
            onComparisonMatrix={p.onComparisonMatrix}
            featureCount={p.featureCount}
            busy={p.busy}
            activeLoaded={p.activeLoaded}
            onCollapse={() => setCollapsed(true)}
          />

          <WorkflowTools
            hidden={p.workflowHidden}
            setHidden={p.setWorkflowHidden}
            showPolymerControls={p.showPolymerControls}
            setShowPolymerControls={p.setShowPolymerControls}
            showConfidenceControls={p.showConfidenceControls}
            setShowConfidenceControls={p.setShowConfidenceControls}
            showAlignmentDiagnostics={p.showAlignmentDiagnostics}
            setShowAlignmentDiagnostics={p.setShowAlignmentDiagnostics}
            activeTab={p.activeTab}
            setActiveTab={p.setActiveTab}
          >
            {p.activeTab === "navigate" && <NavigateTab {...p} />}
            {p.activeTab === "view" && <ViewTab {...p} />}
            {p.activeTab === "annotate" && <AnnotateTab {...p} />}
            {p.activeTab === "polymer" && (
              <PolymerTab
                polarity={p.polarity}
                settings={p.polymerSettings}
                onChange={p.setPolymerSettings}
                onOpen={p.onPolymerDialog}
                onExpectedProducts={p.onExpectedProducts}
                onKendrick={p.onKendrick}
                canOpenExpectedProducts={p.canOpenExpectedProducts}
                canOpenKendrick={p.canOpenKendrick}
                onSaveDefaults={p.onSavePolymerDefaults}
              />
            )}
          </WorkflowTools>
        </>
      )}
    </aside>
  );
}

function PrimaryActions({
  onEIC,
  onJumpMz,
  onExportLabels,
  onExportSpectrum,
  onExportUV,
  onExportTICOverlay,
  onSumRegionSpectrum,
  onFeatureTable,
  onComparisonMatrix,
  featureCount,
  busy,
  activeLoaded,
  onCollapse,
}: {
  onEIC: () => void;
  onJumpMz: () => void;
  onExportLabels: () => void;
  onExportSpectrum: () => void;
  onExportUV: () => void;
  onExportTICOverlay: () => void;
  onSumRegionSpectrum: () => void;
  onFeatureTable: () => void;
  onComparisonMatrix: () => void;
  featureCount: number;
  busy: boolean;
  activeLoaded: boolean;
  onCollapse?: () => void;
}) {
  return (
    <section className="border-b border-ink-200 bg-surface p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">Primary Actions</h3>
          <p className="mt-0.5 text-xs text-ink-500">
            The highest-value actions stay visible here at all times.
          </p>
        </div>
        {onCollapse && (
          <button
            type="button"
            onClick={onCollapse}
            title="Collapse tools panel"
            aria-label="Collapse tools panel"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-800"
          >
            <IconChevronRight className="h-4 w-4" />
          </button>
        )}
      </div>
      <div className="mt-3 flex flex-col gap-2">
        <button
          className="rounded-md border border-brand-500 bg-brand-500 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:cursor-not-allowed disabled:border-ink-200 disabled:bg-ink-100 disabled:text-ink-400"
          disabled={!activeLoaded || busy}
          onClick={onEIC}
        >
          EIC (new chromatogram)…
        </button>
        <div className="grid grid-cols-2 gap-2">
          <button
            className="rounded-md border border-ink-200 bg-surface px-3 py-2 text-sm text-ink-700 transition-colors hover:bg-ink-100 disabled:cursor-not-allowed disabled:text-ink-400"
            disabled={!activeLoaded || busy}
            onClick={onJumpMz}
          >
            Jump to m/z…
          </button>
          <button
            className="rounded-md border border-ink-200 bg-surface px-3 py-2 text-sm text-ink-700 transition-colors hover:bg-ink-100 disabled:cursor-not-allowed disabled:text-ink-400"
            disabled={!activeLoaded}
            onClick={onFeatureTable}
          >
            Feature table{featureCount > 0 ? ` (${featureCount})` : ""}...
          </button>
          <button
            className="rounded-md border border-ink-200 bg-surface px-3 py-2 text-sm text-ink-700 transition-colors hover:bg-ink-100 disabled:cursor-not-allowed disabled:text-ink-400"
            disabled={!activeLoaded}
            onClick={onComparisonMatrix}
          >
            Comparison matrix...
          </button>
          <button
            className="rounded-md border border-ink-200 bg-surface px-3 py-2 text-sm text-ink-700 transition-colors hover:bg-ink-100 disabled:cursor-not-allowed disabled:text-ink-400"
            disabled={!activeLoaded || busy}
            onClick={onExportLabels}
          >
            Export labels (all scans)…
          </button>
        </div>
      </div>
    </section>
  );
}

function WorkflowTools({
  hidden,
  setHidden,
  showPolymerControls,
  setShowPolymerControls,
  showConfidenceControls,
  setShowConfidenceControls,
  showAlignmentDiagnostics,
  setShowAlignmentDiagnostics,
  activeTab,
  setActiveTab,
  children,
}: {
  hidden: boolean;
  setHidden: (v: boolean) => void;
  showPolymerControls: boolean;
  setShowPolymerControls: (v: boolean) => void;
  showConfidenceControls: boolean;
  setShowConfidenceControls: (v: boolean) => void;
  showAlignmentDiagnostics: boolean;
  setShowAlignmentDiagnostics: (v: boolean) => void;
  activeTab: TabId;
  setActiveTab: (t: TabId) => void;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-1 flex-col">
      <header className="flex items-start justify-between gap-2 bg-surface p-4 pb-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">Workflow &amp; Tools</h3>
          <p className="mt-0.5 text-xs text-ink-500">
            Fine-tune visibility and advanced LCMS controls
          </p>
        </div>
        <button
          className="flex h-7 shrink-0 items-center gap-1 rounded-md border border-dashed border-ink-300 bg-surface px-2 text-xs text-ink-700 hover:bg-ink-100"
          onClick={() => setHidden(!hidden)}
        >
          {hidden ? "Show ▼" : "Hide ▲"}
        </button>
      </header>

      {!hidden && (
        <>
          <div className="flex flex-col gap-1 bg-surface/70px-4 pb-2">
            <Check
              label="Show polymer matching controls"
              checked={showPolymerControls}
              onChange={setShowPolymerControls}
            />
            <Check
              label="Show confidence controls"
              checked={showConfidenceControls}
              onChange={setShowConfidenceControls}
            />
            <Check
              label="Show alignment diagnostics controls"
              checked={showAlignmentDiagnostics}
              onChange={setShowAlignmentDiagnostics}
            />
          </div>

          <div className="flex items-center gap-1 border-b border-ink-200 bg-surface/70px-3 pt-2">
            {(
              [
                { id: "navigate", label: "Browse" },
                { id: "view", label: "Display" },
                { id: "annotate", label: "Labels" },
                ...(showPolymerControls
                  ? [{ id: "polymer" as const, label: "Polymer Match" }]
                  : []),
              ] as { id: TabId; label: string }[]
            ).map((t) => (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className={clsx(
                  "-mb-px border-b-2 px-3 py-1.5 text-xs font-medium transition-colors",
                  activeTab === t.id
                    ? "border-brand-500 text-ink-900"
                    : "border-transparent text-ink-500 hover:text-ink-800",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="flex-1 p-4">{children}</div>
        </>
      )}
    </section>
  );
}

// --- Tabs --------------------------------------------------------------------

function NavigateTab(p: ToolsPanelProps) {
  return (
    <div className="flex flex-col gap-4">
      <GroupBox title="Spectrum">
        <div className="grid grid-cols-4 gap-2">
          <NavyButton onClick={p.onPrev} disabled={!p.activeLoaded}>
            ◄ Prev
          </NavyButton>
          <NavyButton onClick={p.onNext} disabled={!p.activeLoaded}>
            Next ►
          </NavyButton>
          <NavyButton onClick={p.onFirst} disabled={!p.activeLoaded}>
            First
          </NavyButton>
          <NavyButton onClick={p.onLast} disabled={!p.activeLoaded}>
            Last
          </NavyButton>
        </div>
        <NavyButton className="mt-2 w-full" onClick={p.onFindMz} disabled={!p.activeLoaded}>
          Find m/z…
        </NavyButton>
        <NavyButton className="mt-2 w-full" onClick={p.onAutoAlignUV} disabled={!p.activeLoaded}>
          Auto-align UV↔MS
        </NavyButton>
        <NavyButton className="mt-2 w-full" onClick={p.onEICDialog} disabled={!p.activeLoaded}>
          EIC…
        </NavyButton>
      </GroupBox>

      <GroupBox title="Jump">
        <div className="flex items-center gap-2">
          <label className="text-xs text-ink-700">
            RT ({p.rtUnit === "seconds" ? "s" : "min"}):
          </label>
          <input
            type="number"
            className="input flex-1"
            placeholder="e.g. 2.45"
            value={p.rtJumpText}
            onChange={(e) => p.setRtJumpText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") p.onRtJump();
            }}
            disabled={!p.activeLoaded}
          />
          <NavyButton onClick={p.onRtJump} disabled={!p.activeLoaded}>
            Go
          </NavyButton>
        </div>
      </GroupBox>
    </div>
  );
}

function ViewTab(p: ToolsPanelProps) {
  return (
    <div className="flex flex-col gap-4">
      <GroupBox title="Filters">
        <Row label="RT unit">
          <select
            className="input"
            value={p.rtUnit}
            onChange={(e) => p.setRtUnit(e.target.value as RtUnit)}
          >
            <option value="minutes">minutes</option>
            <option value="seconds">seconds</option>
          </select>
        </Row>
      </GroupBox>

      <GroupBox title="Polarity">
        <div className="flex items-center gap-4">
          {(["all", "positive", "negative"] as Polarity[]).map((v) => (
            <label key={v} className="flex items-center gap-1.5 text-sm capitalize">
              <input
                type="radio"
                name="polarity"
                checked={p.polarity === v}
                onChange={() => p.setPolarity(v)}
              />
              {v === "all" ? "All" : v.charAt(0).toUpperCase() + v.slice(1)}
            </label>
          ))}
        </div>
      </GroupBox>

      <GroupBox title="UV↔MS alignment">
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <div className="label">Offset (min)</div>
            <input
              type="number"
              step="0.001"
              className="input mt-1 w-full"
              value={p.uvOffsetText}
              onChange={(e) => p.setUvOffsetText(e.target.value)}
            />
          </div>
          <button className="btn-primary" onClick={p.onApplyOffset}>
            Apply
          </button>
        </div>
        <Check
          className="mt-2"
          label="Enable auto-align"
          checked={p.autoAlignUv}
          onChange={p.setAutoAlignUv}
        />
      </GroupBox>

      <NavyButton className="w-full" onClick={p.onGraphSettings}>
        Graph Settings…
      </NavyButton>

      <GroupBox title="Overlays and exports">
        <Check
          label="Overlay loaded TICs"
          checked={p.overlayTicEnabled}
          onChange={p.setOverlayTicEnabled}
        />
        <Check
          label="Overlay attached UV traces"
          checked={p.overlayUvEnabled}
          onChange={p.setOverlayUvEnabled}
        />
        <Check
          label="Overlay spectra at selected RT"
          checked={p.overlaySpectrumEnabled}
          onChange={p.setOverlaySpectrumEnabled}
        />
        <Check
          label="Overlay generated EICs"
          checked={p.overlayEicEnabled}
          onChange={p.setOverlayEicEnabled}
        />
        <div>
          <button
            type="button"
            className="w-full rounded-md border border-ink-200 bg-surface px-2 py-1 text-xs font-medium text-ink-700 transition-colors hover:bg-ink-50 disabled:cursor-not-allowed disabled:text-ink-400"
            disabled={p.overlaySessionIds.length === 0}
            onClick={() => p.setOverlaySessionIds([])}
          >
            Clear TIC/UV selection
          </button>
        </div>
        <div className="max-h-28 overflow-auto rounded-md border border-ink-200 bg-surface p-2">
          {p.sessions.map((session) => (
            <label key={session.session_id} className="flex items-center gap-2 py-0.5 text-xs">
              <input
                type="checkbox"
                checked={p.overlaySessionIds.includes(session.session_id)}
                onChange={(event) => {
                  const checked = event.target.checked;
                  p.setOverlaySessionIds(
                    checked
                      ? [...p.overlaySessionIds, session.session_id]
                      : p.overlaySessionIds.filter((sid) => sid !== session.session_id),
                  );
                }}
              />
              <span className="truncate">{session.display_name}</span>
            </label>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <NavyButton onClick={p.onExportSpectrum} disabled={!p.activeLoaded}>
            Spectrum CSV
          </NavyButton>
          <NavyButton onClick={p.onExportUV} disabled={!p.activeLoaded}>
            UV CSV
          </NavyButton>
          <NavyButton onClick={p.onExportTICOverlay} disabled={!p.activeLoaded}>
            TIC overlay CSV
          </NavyButton>
          <NavyButton onClick={p.onSumRegionSpectrum} disabled={!p.activeLoaded}>
            Sum RT window
          </NavyButton>
        </div>
      </GroupBox>

      <GroupBox title="Panels">
        <Check label="Show TIC" checked={p.showTIC} onChange={p.setShowTIC} />
        <Check
          label="Show Spectrum"
          checked={p.showSpectrum}
          onChange={p.setShowSpectrum}
        />
        <Check label="Show UV" checked={p.showUV} onChange={p.setShowUV} />
      </GroupBox>

      <GroupBox title="TIC region">
        <Check
          label="Region Select (drag on TIC)"
          checked={p.regionSelect}
          onChange={p.setRegionSelect}
        />
        <Row label="Ignore m/z">
          <input
            className="input w-full"
            value={p.regionIgnoredMzText}
            onChange={(e) => p.setRegionIgnoredMzText(e.target.value)}
            placeholder="91.1, 113.0"
            spellCheck={false}
          />
        </Row>
        <Row label="± m/z">
          <input
            type="number"
            min={0.001}
            step="0.01"
            className="input w-24"
            value={p.regionIgnoredMzTolerance}
            onChange={(e) => {
              const value = parseFloat(e.target.value);
              p.setRegionIgnoredMzTolerance(Number.isFinite(value) && value > 0 ? value : 0.01);
            }}
          />
        </Row>
        <p className="text-[11px] text-ink-500">
          {p.regionIgnoredCount > 0
            ? `${p.regionIgnoredCount} mass${p.regionIgnoredCount === 1 ? "" : "es"} hidden from summed region MS1 scaling.`
            : "Hide dominant contaminants from summed region MS1 scaling."}
        </p>
        <button
          className="mt-2 rounded-md border border-ink-200 bg-surface px-3 py-1.5 text-xs text-ink-700 hover:bg-ink-100 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={!p.regionSelect}
          onClick={() => p.setRegionSelect(false)}
        >
          Clear Region
        </button>
      </GroupBox>
    </div>
  );
}

function AnnotateTab(p: ToolsPanelProps) {
  return (
    <div className="flex flex-col gap-4">
      <GroupBox title="Spectrum labels">
        <Check
          label="Annotate spectrum peaks with m/z"
          checked={p.annotateSpectrum}
          onChange={p.setAnnotateSpectrum}
        />
        <Row label="Top N">
          <input
            type="number"
            min={1}
            className="input w-24"
            value={p.spectrumTopN}
            onChange={(e) =>
              p.setSpectrumTopN(Math.max(1, parseInt(e.target.value || "0", 10) || 0))
            }
          />
        </Row>
        <Row label="Min rel">
          <input
            type="number"
            step="0.01"
            min={0}
            className="input w-24"
            value={p.spectrumMinRel}
            onChange={(e) =>
              p.setSpectrumMinRel(Math.max(0, parseFloat(e.target.value || "0") || 0))
            }
          />
        </Row>
        <Check
          label="Enable dragging labels with mouse"
          checked={p.enableDragLabels}
          onChange={p.setEnableDragLabels}
        />
      </GroupBox>

      <GroupBox title="UV labels">
        <Check
          label="Transfer top MS peaks to UV labels at selected RT"
          checked={p.transferMsToUv}
          onChange={p.setTransferMsToUv}
        />
        <Row label="How many peaks">
          <select
            className="input w-24"
            value={p.uvTransferCount}
            onChange={(e) => p.setUvTransferCount(parseInt(e.target.value, 10))}
          >
            {[1, 2, 3, 5, 8, 10].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </Row>
        <Row label="Auto UV prominence">
          <input
            type="number"
            step="0.01"
            min={0}
            className="input w-24"
            value={p.uvProminence}
            onChange={(e) =>
              p.setUvProminence(Math.max(0, parseFloat(e.target.value || "0") || 0))
            }
          />
        </Row>
        <Row label="Auto UV min distance (min)">
          <input
            type="number"
            step="0.05"
            min={0}
            className="input w-24"
            value={p.uvMinDistance}
            onChange={(e) =>
              p.setUvMinDistance(Math.max(0, parseFloat(e.target.value || "0") || 0))
            }
          />
        </Row>
        <Check
          label="Snap labels to nearest UV peak"
          checked={p.snapUvLabels}
          onChange={p.setSnapUvLabels}
        />
        <Row label="Label orientation">
          <select
            className="input w-32"
            value={p.uvLabelOrientation}
            onChange={(e) => p.setUvLabelOrientation(e.target.value as UVLabelOrientation)}
          >
            <option value="vertical">vertical</option>
            <option value="horizontal">horizontal</option>
          </select>
        </Row>
        <div className="rounded-md border border-ink-200 bg-ink-50/60 px-3 py-2 text-xs text-ink-600">
          Auto arrange splits labels into local RT clusters and places each
          cluster in a descending series stair near its own UV peak group.
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <div className="mb-1 text-xs font-medium text-ink-600">Stair x spacing</div>
            <input
              type="number"
              step="0.05"
              min={0}
              className="input w-full"
              value={p.uvLabelStairXStep}
              onChange={(e) =>
                p.setUvLabelStairXStep(Math.max(0, parseFloat(e.target.value || "0") || 0))
              }
            />
            <div className="mt-0.5 text-[11px] text-ink-500">minutes</div>
          </label>
          <label className="block">
            <div className="mb-1 text-xs font-medium text-ink-600">Stair y spacing</div>
            <input
              type="number"
              step="1"
              min={0}
              className="input w-full"
              value={p.uvLabelStairYStep}
              onChange={(e) =>
                p.setUvLabelStairYStep(Math.max(0, parseFloat(e.target.value || "0") || 0))
              }
            />
            <div className="mt-0.5 text-[11px] text-ink-500">pixels</div>
          </label>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <button
            className="rounded-md border border-ink-200 bg-surface px-3 py-1.5 text-xs text-ink-700 hover:bg-ink-100 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={!p.activeLoaded}
            onClick={p.onLabelSelectedRT}
          >
            Label selected RT
          </button>
          <button
            className="rounded-md border border-ink-200 bg-surface px-3 py-1.5 text-xs text-ink-700 hover:bg-ink-100"
            onClick={p.onAutoLabelUV}
            disabled={!p.activeLoaded}
          >
            Auto Label UV Peaks
          </button>
        </div>
      </GroupBox>

      <div className="grid grid-cols-2 gap-2">
        <button
          className="rounded-md border border-ink-200 bg-surface px-2 py-1.5 text-xs text-ink-700 hover:bg-ink-100 disabled:cursor-not-allowed disabled:opacity-60"
          disabled
          title="Coming soon"
        >
          Annotate Peaks…
        </button>
        <button
          className="rounded-md border border-ink-200 bg-surface px-2 py-1.5 text-xs text-ink-700 hover:bg-ink-100"
          onClick={p.onAutoArrangeLabels}
          disabled={p.uvLabelCount === 0}
        >
          Auto Arrange Labels
        </button>
        <button
          className={clsx(
            "rounded-md border px-2 py-1.5 text-xs transition-colors",
            p.uvBunchLabels
              ? "border-brand-500 bg-brand-500/10 text-brand-700 hover:bg-brand-500/15"
              : "border-ink-200 bg-surface text-ink-700 hover:bg-ink-100",
          )}
          onClick={() => p.setUvBunchLabels(!p.uvBunchLabels)}
          aria-pressed={p.uvBunchLabels}
          title="Collapse repeated UV label text into one branched label"
        >
          Bunch same labels
        </button>
        {p.uvBunchLabels && (
          <label className="col-span-2 flex items-center gap-2 text-xs text-ink-600">
            <span className="shrink-0">Hub height</span>
            <input
              type="number"
              step="0.01"
              min={0}
              max={1}
              className="input w-20"
              value={p.uvBunchHubOffset}
              onChange={(e) =>
                p.setUvBunchHubOffset(Math.max(0, parseFloat(e.target.value || "0") || 0))
              }
            />
            <span className="text-ink-400">× signal range</span>
          </label>
        )}
        <button
          className="rounded-md border border-ink-200 bg-surface px-2 py-1.5 text-xs text-ink-700 hover:bg-ink-100 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={!p.canAddCustomUvLabel}
          title={
            p.canAddCustomUvLabel
              ? "Add a custom UV label at the selected RT"
              : "Select an RT on the UV chromatogram first"
          }
          onClick={p.onCustomUvLabel}
        >
          Custom Labels…
        </button>
      </div>

      <GroupBox title="Overlay labels">
        <Check
          label="Show labels for all overlayed spectra"
          checked={p.showOverlayLabels}
          onChange={p.setShowOverlayLabels}
        />
        <Check
          label="Multi-drag labels across overlay"
          checked={p.multiDragOverlay}
          onChange={p.setMultiDragOverlay}
        />
      </GroupBox>
    </div>
  );
}

function PolymerTab({
  polarity,
  settings,
  onChange,
  onOpen,
  onExpectedProducts,
  onKendrick,
  canOpenExpectedProducts,
  canOpenKendrick,
  onSaveDefaults,
}: {
  polarity: Polarity;
  settings: PolymerUiSettings;
  onChange: (settings: PolymerUiSettings) => void;
  onOpen: () => void;
  onExpectedProducts: () => void;
  onKendrick: () => void;
  canOpenExpectedProducts: boolean;
  canOpenKendrick: boolean;
  onSaveDefaults: () => void;
}) {
  const disabled = polarity === "all";
  const status =
    polarity === "positive"
      ? "Positive mode: +H, optional +Na/+K."
      : polarity === "negative"
        ? "Negative mode: -H, optional +Cl/+HCOO/+Ac."
        : "Choose Positive or Negative polarity to enable polymer matching.";
  return (
    <div className="flex flex-col gap-3">
      <GroupBox title="Polymer matching">
        <label
          className={clsx(
            "flex items-center gap-2 text-sm text-ink-800",
            disabled && "opacity-60",
          )}
        >
          <input
            type="checkbox"
            checked={settings.shared.enabled && !disabled}
            disabled={disabled}
            onChange={(e) =>
              onChange({
                ...settings,
                shared: { ...settings.shared, enabled: e.target.checked },
              })
            }
          />
          <span>Enable polymer/reaction matching</span>
        </label>
        <p className="mt-1 text-xs text-ink-500">{status}</p>
        <NavyButton className="mt-2 w-full" onClick={onOpen}>
          Polymer Match…
        </NavyButton>
        <button
          type="button"
          className="w-full rounded-md border border-ink-200 bg-surface px-3 py-1.5 text-sm text-ink-700 hover:bg-ink-100 disabled:cursor-not-allowed disabled:text-ink-400"
          onClick={onExpectedProducts}
          disabled={!canOpenExpectedProducts}
          title={
            canOpenExpectedProducts
              ? "Match expected monomer/dimer/trimer products against the current MS1 spectrum"
              : "Select polarity, monomers, and load an MS1 spectrum first"
          }
        >
          Expected Products...
        </button>
        <button
          type="button"
          className="w-full rounded-md border border-ink-200 bg-surface px-3 py-1.5 text-sm text-ink-700 hover:bg-ink-100 disabled:cursor-not-allowed disabled:text-ink-400"
          onClick={onKendrick}
          disabled={!canOpenKendrick}
          title={
            canOpenKendrick
              ? "Open a Kendrick mass defect plot for the current MS1 spectrum"
              : "Load an MS1 spectrum first"
          }
        >
          Kendrick Plot...
        </button>
        <button
          type="button"
          className="w-full rounded-md border border-ink-200 bg-surface px-3 py-1.5 text-sm text-ink-700 hover:bg-ink-100"
          onClick={onSaveDefaults}
        >
          Save current as defaults
        </button>
      </GroupBox>
    </div>
  );
}

// --- Small layout primitives -------------------------------------------------

function GroupBox({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="rounded-md border border-ink-200 bg-surface p-3">
      <legend className="px-1 text-[11px] font-semibold uppercase tracking-wider text-ink-500">
        {title}
      </legend>
      <div className="flex flex-col gap-2">{children}</div>
    </fieldset>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <label className="text-sm text-ink-700">{label}</label>
      {children}
    </div>
  );
}

function Check({
  label,
  checked,
  onChange,
  className,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  className?: string;
}) {
  return (
    <label className={clsx("flex items-center gap-2 text-sm text-ink-800", className)}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

function NavyButton({
  children,
  onClick,
  disabled,
  className,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        "rounded-md bg-[rgb(85,115,185)] px-3 py-1.5 text-xs font-medium text-white transition-colors",
        "hover:bg-ink-900",
        "disabled:cursor-not-allowed disabled:bg-ink-300 disabled:text-ink-500",
        className,
      )}
    >
      {children}
    </button>
  );
}

// --- Charts ------------------------------------------------------------------

function TICChart(props: {
  tic: TICData | null;
  overlayTraces: LCMSTICOverlayTrace[];
  onClick: (e: Readonly<PlotMouseEvent>) => void;
  onRegionSelected?: (rtMin: number, rtMax: number) => void;
  selectedRt: number | null;
  selectedRegion?: { rtMin: number; rtMax: number } | null;
  selectedScanId?: string | null;
  rtUnit: RtUnit;
  regionSelect: boolean;
  settings: ChartSettings;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<PlotlyHTMLElement | null>(null);
  const plotSize = useContainerSize(containerRef, props.settings.height);
  usePlotResizePulses([
    props.regionSelect,
    props.selectedRt,
    props.selectedRegion?.rtMin,
    props.selectedRegion?.rtMax,
    props.settings.axis.xMax,
    props.settings.axis.xMin,
    props.settings.axis.yMax,
    props.settings.axis.yMin,
    props.settings.color,
    props.settings.height,
    props.settings.lineWidth,
    props.settings.showGrid,
    props.settings.tickSize,
    props.settings.title,
    props.settings.xTitle,
    props.settings.yTitle,
    props.tic?.rt_min.length,
    props.tic?.tic.length,
    props.overlayTraces.length,
    props.rtUnit,
  ], plotRef);
  const pt = usePlotlyTheme();
  const scale = props.rtUnit === "seconds" ? 60 : 1;
  const unit = props.rtUnit === "seconds" ? "s" : "min";
  const xs = useMemo(
    () => (props.tic ? props.tic.rt_min.map((v) => v * scale) : []),
    [props.tic, scale],
  );
  const overlayData = useMemo(
    () =>
      props.overlayTraces.map((trace) => ({
        type: "scattergl" as const,
        mode: "lines" as const,
        x: trace.rt_min.map((v) => v * scale),
        y: trace.tic,
        line: { width: Math.max(1, props.settings.lineWidth * 0.9) },
        hovertemplate: `${trace.display_name}<br>RT: %{x:.3f} ${unit}<br>TIC: %{y:.3e}<extra></extra>`,
        name: trace.display_name,
      })),
    [props.overlayTraces, props.settings.lineWidth, scale, unit],
  );

  const emitSelectedRtRegion = useCallback(
    (x0: unknown, x1: unknown) => {
      if (!props.onRegionSelected) return;
      const start = Number(x0);
      const end = Number(x1);
      if (!Number.isFinite(start) || !Number.isFinite(end) || start === end) return;
      const toMin = 1 / scale;
      props.onRegionSelected(Math.min(start, end) * toMin, Math.max(start, end) * toMin);
    },
    [props.onRegionSelected, scale],
  );

  const handleSelected = (event: Readonly<PlotSelectionEvent>) => {
    const xRange = event.range?.x;
    if (xRange && xRange.length >= 2) {
      emitSelectedRtRegion(xRange[0], xRange[1]);
      return;
    }
    const pointXs = event.points
      ?.map((point) => Number(point.x))
      .filter((value) => Number.isFinite(value));
    if (pointXs && pointXs.length >= 2) {
      emitSelectedRtRegion(Math.min(...pointXs), Math.max(...pointXs));
    }
  };

  const handleRelayout = (event: Readonly<Record<string, unknown>>) => {
    if (!props.regionSelect) return;
    const selections = event.selections;
    const lastSelection =
      Array.isArray(selections) && selections.length > 0
        ? (selections[selections.length - 1] as Record<string, unknown>)
        : null;
    emitSelectedRtRegion(
      lastSelection?.x0 ?? event["selections[0].x0"],
      lastSelection?.x1 ?? event["selections[0].x1"],
    );
  };
  const shapes: object[] = [];
  if (props.selectedRt != null) {
    shapes.push({
      type: "line",
      xref: "x",
      yref: "paper",
      x0: props.selectedRt * scale,
      x1: props.selectedRt * scale,
      y0: 0,
      y1: 1,
      line: { color: "#5573b9", width: 1, dash: "dot" },
    });
  }
  if (props.regionSelect && props.selectedRegion != null) {
    shapes.push({
      type: "rect",
      xref: "x",
      yref: "paper",
      x0: props.selectedRegion.rtMin * scale,
      x1: props.selectedRegion.rtMax * scale,
      y0: 0,
      y1: 1,
      fillcolor: "rgba(85,115,185,0.12)",
      line: { color: "rgba(85,115,185,0.45)", width: 1 },
    });
  }
  const savePublication = useCallback(
    (format: PublicationExportFormat, exportSettings: PublicationExportSettings) => {
      if (!plotRef.current || !props.tic) return;
      const base = sanitizeFilenamePart(props.settings.title || "lcms_tic", "lcms_tic");
      void exportPlotlyPublicationImage(plotRef.current, {
        format,
        filename: `${base}_tic_${publicationFilenameSuffix(exportSettings, format)}`,
        ...exportSettings,
      }, {
        layoutOverrides: {
          font: { family: "Arial, Helvetica, sans-serif", size: 9, color: "#111827" },
          margin: { l: 58, r: 18, t: props.settings.title ? 28 : 12, b: 46 },
        },
      });
    },
    [props.settings.title, props.tic],
  );
  return (
    <div className="card flex min-w-0 shrink-0 flex-col overflow-hidden p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-1 pb-1">
        <h3 className="text-sm font-semibold">Total Ion Chromatogram</h3>
        <div className="flex items-center gap-2 text-xs text-ink-500">
          {props.regionSelect && props.selectedRegion != null ? (
            <span className="rounded-full bg-brand-50 px-2 py-0.5 font-medium text-brand-700">
              Region {formatRt(props.selectedRegion.rtMin, props.rtUnit)} - {formatRt(props.selectedRegion.rtMax, props.rtUnit)}
            </span>
          ) : props.selectedRt != null ? (
            <span className="rounded-full bg-brand-50 px-2 py-0.5 font-medium text-brand-700">
              RT {formatRt(props.selectedRt, props.rtUnit)}
              {props.selectedScanId ? ` · Scan ${formatScanId(props.selectedScanId)}` : ""}
            </span>
          ) : null}
          <span>
            {props.regionSelect
              ? "Drag on the plot to select an RT region"
              : "Click a point to load the spectrum at that RT"}
          </span>
          <PaperFigureExportToolbar
            disabled={!props.tic}
            storageKey="mfp-publication-plot-export-lcms-tic"
            onExport={savePublication}
          />
        </div>
      </div>
      {!props.tic ? (
        <div className="flex h-72 items-center justify-center text-sm text-ink-500">
          Loading TIC…
        </div>
      ) : (
        <div
          ref={containerRef}
          className="min-w-0 overflow-hidden"
          style={{ height: props.settings.height }}
        >
          <Plot
            revision={plotSize.revision}
            data={[
              {
                type: props.regionSelect ? "scatter" : "scattergl",
                mode: "lines",
                x: xs,
                y: props.tic.tic,
                line: { color: props.settings.color, width: props.settings.lineWidth },
                hovertemplate: `RT: %{x:.3f} ${unit}<br>TIC: %{y:.3e}<extra></extra>`,
                name: "TIC",
              },
              ...overlayData,
            ]}
            layout={{
              height: plotSize.height,
              width: plotSize.width,
              margin: { l: 60, r: 20, t: 10, b: 40 },
              title: props.settings.title
                ? { text: props.settings.title, font: { size: props.settings.titleSize } }
                : undefined,
              font: { size: props.settings.tickSize },
              xaxis: {
                title: axisTitle(`${props.settings.xTitle} (${unit})`, props.settings.axisTitleSize),
                zeroline: false,
                showgrid: props.settings.showGrid,
                range: axisRange(props.settings.axis.xMin, props.settings.axis.xMax),
                tickfont: { size: props.settings.tickSize },
                ...axisFrame(props.settings),
              },
              yaxis: {
                title: axisTitle(props.settings.yTitle, props.settings.axisTitleSize),
                zeroline: false,
                exponentformat: "e",
                showgrid: props.settings.showGrid,
                range: axisRange(props.settings.axis.yMin, props.settings.axis.yMax),
                tickfont: { size: props.settings.tickSize },
                ...axisFrame(props.settings),
              },
              hovermode: "x",
              colorway: pt.colorway,
              plot_bgcolor: pt.plot_bgcolor,
              paper_bgcolor: pt.paper_bgcolor,
              showlegend: overlayData.length > 0,
              shapes,
              dragmode: props.regionSelect ? "select" : "zoom",
              selectdirection: props.regionSelect ? "h" : undefined,
            }}
            config={{ responsive: true, displaylogo: false }}
            style={{ width: "100%", height: "100%", minWidth: 0 }}
            useResizeHandler
            onClick={props.regionSelect ? undefined : props.onClick}
            onSelected={handleSelected}
            onRelayout={(event) => handleRelayout(event as Readonly<Record<string, unknown>>)}
            onInitialized={(_figure, graphDiv) => {
              plotRef.current = graphDiv as PlotlyHTMLElement;
              schedulePlotResize();
              queuePlotlyElementResize(plotRef.current);
            }}
            onUpdate={(_figure, graphDiv) => {
              plotRef.current = graphDiv as PlotlyHTMLElement;
            }}
          />
        </div>
      )}
    </div>
  );
}

function EICChart(props: {
  eics: LCMSEICPlot[];
  onClick: (e: Readonly<PlotMouseEvent>) => void;
  onClear: () => void;
  onIntegrate: (plot: LCMSEICPlot) => void;
  onIntegrateAll?: () => void;
  clearLabel?: string;
  selectedRt: number | null;
  rtUnit: RtUnit;
  settings: ChartSettings;
  overlaySettings: EICOverlaySettings;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<PlotlyHTMLElement | null>(null);
  const plotSize = useContainerSize(containerRef, Math.max(240, props.settings.height * 0.75));
  const pt = usePlotlyTheme();
  const scale = props.rtUnit === "seconds" ? 60 : 1;
  const unit = props.rtUnit === "seconds" ? "s" : "min";
  const isOverlay = props.eics.length > 1;
  const sourceFiles = Array.from(new Set(props.eics.map(eicSourceFile)));
  const sourceLabel = sourceFiles.length === 1 ? sourceFiles[0] : `${sourceFiles.length} files`;
  const eicRevisionKey = props.eics
    .map((plot) => `${plot.id}:${plot.eic.rt_min.length}:${plot.eic.intensity.length}`)
    .join("|");
  const traces = useMemo(
    () => {
      const globalMax = props.eics.reduce(
        (max, plot) => Math.max(max, maxFinite(plot.eic.intensity, 0)),
        0,
      );
      const stackStep =
        props.overlaySettings.normalize || globalMax <= 0
          ? props.overlaySettings.stackGap
          : (globalMax * props.overlaySettings.stackGap) / 100;
      return props.eics.map((plot, index) => {
        const localMax = maxFinite(plot.eic.intensity, 0);
        const baseY =
          props.overlaySettings.normalize && localMax > 0
            ? plot.eic.intensity.map((value) => (value / localMax) * 100)
            : plot.eic.intensity;
        const stackOffset = isOverlay && props.overlaySettings.stack ? index * stackStep : 0;
        const y = stackOffset === 0 ? baseY : baseY.map((value) => value + stackOffset);
        return {
        type: "scattergl" as const,
        mode: "lines" as const,
        x: plot.eic.rt_min.map((v) => v * scale),
        y,
        customdata: plot.eic.intensity,
        opacity: isOverlay ? props.overlaySettings.opacity : 1,
        line: {
          color: isOverlay ? (pt.colorway[index % pt.colorway.length] ?? props.settings.color) : props.settings.color,
          width: props.settings.lineWidth,
        },
        hovertemplate: `${eicSourceFile(plot)}<br>m/z ${plot.eic.target_mz.toFixed(4)}<br>RT: %{x:.3f} ${unit}<br>Intensity: %{customdata:.3e}<extra></extra>`,
        name: `${isOverlay ? `${eicSourceFile(plot)} ` : ""}m/z ${plot.eic.target_mz.toFixed(4)}`,
      };
      });
    },
    [isOverlay, props.eics, props.overlaySettings, props.settings.lineWidth, pt.colorway, scale, unit],
  );
  const primary = props.eics[0]?.eic ?? null;
  usePlotResizePulses([
    eicRevisionKey,
    props.eics.length,
    props.overlaySettings.normalize,
    props.overlaySettings.opacity,
    props.overlaySettings.showLegend,
    props.overlaySettings.stack,
    props.overlaySettings.stackGap,
    props.selectedRt,
    props.rtUnit,
    props.settings.axis.xMax,
    props.settings.axis.xMin,
    props.settings.axis.yMax,
    props.settings.axis.yMin,
    props.settings.color,
    props.settings.height,
    props.settings.lineWidth,
    props.settings.showGrid,
    props.settings.tickSize,
    props.settings.title,
    props.settings.xTitle,
    props.settings.yTitle,
  ], plotRef);
  const shapes =
    props.selectedRt != null
      ? [
          {
            type: "line" as const,
            xref: "x" as const,
            yref: "paper" as const,
            x0: props.selectedRt * scale,
            x1: props.selectedRt * scale,
            y0: 0,
            y1: 1,
            line: { color: "#5573b9", width: 1, dash: "dot" as const },
          },
        ]
      : [];
  const savePublication = useCallback(
    (format: PublicationExportFormat, exportSettings: PublicationExportSettings) => {
      if (!plotRef.current || props.eics.length === 0) return;
      const mzPart = primary ? `mz_${primary.target_mz.toFixed(4)}` : "overlay";
      const base = sanitizeFilenamePart(props.settings.title || `lcms_eic_${mzPart}`, "lcms_eic");
      void exportPlotlyPublicationImage(plotRef.current, {
        format,
        filename: `${base}_${publicationFilenameSuffix(exportSettings, format)}`,
        ...exportSettings,
      }, {
        layoutOverrides: {
          font: { family: "Arial, Helvetica, sans-serif", size: 9, color: "#111827" },
          margin: { l: 58, r: 18, t: props.settings.title ? 28 : 12, b: 46 },
        },
      });
    },
    [primary, props.eics.length, props.settings.title],
  );
  return (
    <div className="card flex min-w-0 shrink-0 flex-col overflow-hidden p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-1 pb-1">
        <h3 className="text-sm font-semibold">
          {props.eics.length === 1 && primary
            ? `EIC m/z ${primary.target_mz.toFixed(4)} +/- ${primary.tolerance.toFixed(4)}`
            : `EIC overlay (${props.eics.length} traces)`}
        </h3>
        <div className="flex items-center gap-2 text-xs text-ink-500">
          <span className="max-w-[220px] truncate rounded-full bg-ink-50 px-2 py-0.5 font-medium text-ink-700" title={sourceFiles.join(", ")}>
            {sourceLabel}
          </span>
          {primary && (
            <span>
              {props.eics.length === 1
                ? `${primary.n_scans} scans`
                : `${props.eics.length} EICs${props.overlaySettings.normalize ? ", normalized" : ""}${props.overlaySettings.stack ? ", stacked" : ""}`}
            </span>
          )}
          <button
            className="rounded-md border border-ink-200 bg-surface px-2 py-1 text-ink-700 transition-colors hover:bg-ink-50"
            onClick={() =>
              props.onIntegrateAll && props.eics.length > 1
                ? props.onIntegrateAll()
                : props.eics.forEach((plot) => props.onIntegrate(plot))
            }
          >
            {props.eics.length > 1 ? "Integrate all" : "Integrate"}
          </button>
          <button
            className="rounded-md border border-ink-200 bg-surface px-2 py-1 text-ink-700 transition-colors hover:bg-ink-50"
            onClick={props.onClear}
          >
            {props.clearLabel ?? "Clear"}
          </button>
          <PaperFigureExportToolbar
            disabled={props.eics.length === 0}
            storageKey="mfp-publication-plot-export-lcms-eic"
            onExport={savePublication}
          />
        </div>
      </div>
      <div
        ref={containerRef}
        className="min-w-0 overflow-hidden"
        style={{ height: Math.max(240, props.settings.height * 0.75) }}
      >
        <Plot
          revision={plotSize.revision}
          data={traces}
          layout={{
            height: plotSize.height,
            width: plotSize.width,
            margin: { l: 60, r: 20, t: 10, b: 40 },
            title: props.settings.title
              ? { text: props.settings.title, font: { size: props.settings.titleSize } }
              : undefined,
            font: { size: props.settings.tickSize },
            xaxis: {
              title: axisTitle(`${props.settings.xTitle} (${unit})`, props.settings.axisTitleSize),
              zeroline: false,
              showgrid: props.settings.showGrid,
              range: axisRange(props.settings.axis.xMin, props.settings.axis.xMax),
              tickfont: { size: props.settings.tickSize },
              ...axisFrame(props.settings),
            },
            yaxis: {
              title: axisTitle(
                props.overlaySettings.normalize ? "Normalized EIC (%)" : props.settings.yTitle,
                props.settings.axisTitleSize,
              ),
              zeroline: false,
              exponentformat: "e",
              showgrid: props.settings.showGrid,
              range: axisRange(props.settings.axis.yMin, props.settings.axis.yMax),
              tickfont: { size: props.settings.tickSize },
              ...axisFrame(props.settings),
            },
            hovermode: "x",
            colorway: pt.colorway,
            plot_bgcolor: pt.plot_bgcolor,
            paper_bgcolor: pt.paper_bgcolor,
            showlegend: isOverlay && props.overlaySettings.showLegend,
            shapes,
          }}
          config={{ responsive: true, displaylogo: false }}
          style={{ width: "100%", height: "100%", minWidth: 0 }}
          useResizeHandler
          onClick={props.onClick}
          onInitialized={(_figure, graphDiv) => {
            plotRef.current = graphDiv as PlotlyHTMLElement;
            queuePlotlyElementResize(plotRef.current);
          }}
          onUpdate={(_figure, graphDiv) => {
            plotRef.current = graphDiv as PlotlyHTMLElement;
          }}
        />
      </div>
    </div>
  );
}

function UVChromatogramChart(props: {
  uv: UVChromatogramResponse | null;
  overlayTraces: LCMSUVOverlayChartTrace[];
  busy: boolean;
  xOffset: number;
  selectedUvRt: number | null;
  selectedScanId?: string | null;
  labels: UVTextLabel[];
  rtUnit: RtUnit;
  onPickFile: () => void;
  onRemove: () => void;
  onClick: (e: Readonly<PlotMouseEvent>) => void;
  onClearLabels: () => void;
  onDeleteLabel: (id: string) => void;
  onEditLabel: (label: UVTextLabel) => void;
  onMoveLabel: (id: string, patch: Partial<UVTextLabel>) => void;
  bunchLabels: boolean;
  bunchOffsets: Record<string, { ax: number; ay: number }>;
  bunchHubOffset: number;
  labelOrientation: UVLabelOrientation;
  settings: ChartSettings;
}) {
  const {
    uv,
    overlayTraces,
    busy,
    xOffset,
    selectedUvRt,
    labels,
    rtUnit,
    onPickFile,
    onRemove,
    onClick,
    onClearLabels,
    onDeleteLabel,
    onEditLabel,
    onMoveLabel,
    bunchLabels,
    bunchOffsets,
    bunchHubOffset,
    labelOrientation,
    settings,
  } = props;
  const pt = usePlotlyTheme();
  const available = uv?.available === true;
  const canPlot = available || overlayTraces.length > 0;
  const meta = available ? uv.meta : null;
  const scale = rtUnit === "seconds" ? 60 : 1;
  const unit = rtUnit === "seconds" ? "s" : "min";
  const uvContainerRef = useRef<HTMLDivElement>(null);
  const uvPlotRef = useRef<PlotlyHTMLElement | null>(null);
  const uvPlotSize = useContainerSize(uvContainerRef, settings.height);
  const connectorColor = settings.annotationConnectorColor ?? "#334155";
  const connectorOpacity = Math.min(1, Math.max(0, settings.annotationConnectorOpacity ?? 0.7));
  const connectorArrowColor = withAlpha(connectorColor, connectorOpacity);

  const xs = available ? uv.rt_min.map((v) => (v + xOffset) * scale) : [];
  const overlayData = useMemo(
    () =>
      overlayTraces.map((trace, index) => ({
        type: "scattergl" as const,
        mode: "lines" as const,
        x: trace.uv.rt_min.map((v) => (v + xOffset) * scale),
        y: trace.uv.signal,
        line: {
          color: OVERLAY_PALETTE[index % OVERLAY_PALETTE.length],
          width: Math.max(1, settings.lineWidth * 0.9),
        },
        hovertemplate: `${trace.display_name}<br>RT: %{x:.3f} ${unit}<br>Signal: %{y:.3e}<extra></extra>`,
        name: trace.display_name,
      })),
    [overlayTraces, scale, settings.lineWidth, unit, xOffset],
  );
  const overlayLabelCount = useMemo(
    () => overlayTraces.reduce((count, trace) => count + trace.labels.length, 0),
    [overlayTraces],
  );
  const overlayAnnotations = useMemo(
    () =>
      overlayTraces.flatMap((trace, traceIndex) =>
        trace.labels.map((label, labelIndex) => {
          const stackShift = -14 * (traceIndex + 1);
          const fallbackAy =
            labelOrientation === "vertical" ? -78 - labelIndex * 26 : -42 - labelIndex * 22;
          const ay = label.ay ?? fallbackAy;
          return {
            x: (label.uv_rt_min + xOffset) * scale,
            y: label.signal,
            text: cleanLabelText(label.text),
            textangle: labelOrientation === "vertical" ? ("-90" as const) : ("0" as const),
            showarrow: true,
            arrowhead: 0,
            arrowcolor: connectorArrowColor,
            ax: label.ax ?? 0,
            axref: label.axRef === "x" ? ("x" as const) : ("pixel" as const),
            ayref: label.ayRef === "y" ? ("y" as const) : ("pixel" as const),
            ay: label.ayRef === "y" ? ay : ay + stackShift,
            editable: false,
            font: {
              size: Math.max(8, settings.labels.fontSize - 1),
              color: OVERLAY_PALETTE[traceIndex % OVERLAY_PALETTE.length],
            },
          };
        }),
      ),
    [connectorArrowColor, labelOrientation, overlayTraces, scale, settings.labels.fontSize, xOffset],
  );
  const primaryLabelLayer = useMemo(() => {
    const signalValues =
      uv?.available === true && uv.signal.length > 0
        ? uv.signal
        : labels.map((label) => label.signal);
    const signalMin = signalValues.length > 0 ? Math.min(...signalValues) : 0;
    const signalMax = signalValues.length > 0 ? Math.max(...signalValues) : 1;
    if (bunchLabels) {
      return buildBunchedAnnotations(labels, {
        xOffset,
        scale,
        labelOrientation,
        connectorColor,
        connectorArrowColor,
        fontSize: settings.labels.fontSize,
        fontColor: settings.labels.color,
        signalMin,
        signalMax,
        hubOffset: bunchHubOffset,
        bunchOffsets,
      });
    }
    return {
      annotations: labels.map((label, index) => ({
        x: (label.uv_rt_min + xOffset) * scale,
        y: label.signal,
        text: cleanLabelText(label.text),
        textangle: labelOrientation === "vertical" ? ("-90" as const) : ("0" as const),
        showarrow: true,
        arrowhead: 0,
        arrowcolor: connectorArrowColor,
        ax: label.ax ?? 0,
        axref: label.axRef === "x" ? ("x" as const) : ("pixel" as const),
        ayref: label.ayRef === "y" ? ("y" as const) : ("pixel" as const),
        ay:
          label.ay ??
          (labelOrientation === "vertical" ? -78 - index * 26 : -42 - index * 22),
        font: {
          size: settings.labels.fontSize,
          color: settings.labels.color,
        },
      })),
      shapes: [] as UvPlotShape[],
    };
  }, [
    available,
    bunchHubOffset,
    bunchLabels,
    bunchOffsets,
    connectorArrowColor,
    connectorColor,
    labelOrientation,
    labels,
    scale,
    settings.labels.color,
    settings.labels.fontSize,
    uv,
    xOffset,
  ]);
  usePlotResizePulses([
    available,
    bunchLabels,
    labelOrientation,
    labels.length,
    overlayLabelCount,
    overlayTraces.length,
    rtUnit,
    selectedUvRt,
    settings.axis.xMax,
    settings.axis.xMin,
    settings.axis.yMax,
    settings.axis.yMin,
    settings.color,
    settings.height,
    settings.labels.color,
    settings.labels.fontSize,
    settings.lineWidth,
    settings.showGrid,
    settings.tickSize,
    settings.title,
    settings.xTitle,
    settings.yTitle,
    uv?.available === true ? uv.rt_min.length : 0,
    ...overlayTraces.map((trace) => trace.uv.rt_min.length),
    xOffset,
  ], uvPlotRef);
  useEffect(() => {
    schedulePlotResize();
    const frame = window.requestAnimationFrame(() => {
      if (!uvPlotRef.current) return;
      void import("plotly.js-dist-min").then((plotlyModule) => {
        if (uvPlotRef.current) void plotlyModule.default.Plots.resize(uvPlotRef.current);
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [
    bunchLabels,
    labelOrientation,
    labels.length,
    overlayLabelCount,
    settings.axis.xMax,
    settings.axis.xMin,
    settings.axis.yMax,
    settings.axis.yMin,
    settings.color,
    settings.height,
    settings.labels.color,
    settings.labels.fontSize,
    settings.lineWidth,
    settings.showGrid,
    settings.tickSize,
    settings.title,
    settings.xTitle,
    settings.yTitle,
  ]);

  const saveSvg = async () => {
    if (!uvPlotRef.current) return;
    const plotlyModule = await import("plotly.js-dist-min");
    const plotly = plotlyModule.default;
    const baseName = (meta?.filename ?? "uv_chromatogram")
      .replace(/\.[^.]+$/, "")
      .replace(/[^A-Za-z0-9_-]+/g, "_");
    await plotly.downloadImage(uvPlotRef.current, {
      format: "svg",
      filename: `${baseName}_uv_chromatogram`,
      width: uvPlotSize.width,
      height: uvPlotSize.height,
      scale: 1,
    });
  };

  const saveUvPaper = async (format: PublicationExportFormat, exportSettings: PublicationExportSettings) => {
    if (!uvPlotRef.current) return;
    const baseName = sanitizeFilenamePart(meta?.filename ?? "uv_chromatogram", "uv_chromatogram");
    await exportPlotlyPublicationImage(uvPlotRef.current, {
      format,
      filename: `${baseName}_uv_chromatogram_${publicationFilenameSuffix(exportSettings, format)}`,
      ...exportSettings,
    }, {
      layoutOverrides: {
        font: { family: "Arial, Helvetica, sans-serif", size: 9, color: "#111827" },
        margin: { l: 58, r: 18, t: settings.title ? 28 : 12, b: 46 },
      },
    });
  };
  const handleRelayout = (event: Readonly<Record<string, unknown>>) => {
    if (bunchLabels) return;
    labels.forEach((label, index) => {
      const patch: Partial<UVTextLabel> = {};
      const ax = event[`annotations[${index}].ax`];
      const ay = event[`annotations[${index}].ay`];
      if (typeof ax === "number" && Number.isFinite(ax)) patch.ax = ax;
      if (typeof ay === "number" && Number.isFinite(ay)) patch.ay = ay;
      if (Object.keys(patch).length > 0) onMoveLabel(label.id, patch);
    });
  };
  const shapes: UvPlotShape[] =
    selectedUvRt != null
      ? [
          {
            type: "line" as const,
            xref: "x" as const,
            yref: "paper" as const,
            x0: (selectedUvRt + xOffset) * scale,
            x1: (selectedUvRt + xOffset) * scale,
            y0: 0,
            y1: 1,
            line: { color: "#5573b9", width: 1, dash: "dot" as const },
          },
        ]
      : [];
  const plotShapes = [...shapes, ...primaryLabelLayer.shapes];

  return (
    <div className="card flex min-w-0 shrink-0 flex-col overflow-hidden p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-1 pb-1">
        <div className="flex items-baseline gap-2">
          <h3 className="text-sm font-semibold">UV Chromatogram</h3>
          {available && meta?.filename && (
            <span className="truncate text-xs text-ink-500" title={meta.filename}>
              {meta.filename}
              {(meta.y_label || meta.y_col) ? ` · ${meta.y_label || meta.y_col}` : ""}
              {xOffset !== 0 ? ` · offset ${xOffset.toFixed(3)} min` : ""}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs">
          {selectedUvRt != null && (
            <span className="rounded-full bg-brand-50 px-2 py-0.5 font-medium text-brand-700">
              UV RT {formatRt(selectedUvRt, rtUnit)}
              {props.selectedScanId ? ` · Scan ${formatScanId(props.selectedScanId)}` : ""}
            </span>
          )}
          {available && (
            <span className="text-ink-500">Click a point to load the MS spectrum</span>
          )}
          {available && uv.peaks.length > 0 && (
            <span className="text-ink-500">
              {uv.peaks.length} peak{uv.peaks.length === 1 ? "" : "s"} annotated
            </span>
          )}
          {overlayTraces.length > 0 && (
            <span className="text-ink-500">
              {overlayTraces.length} UV overlay{overlayTraces.length === 1 ? "" : "s"}
            </span>
          )}
          {labels.length > 0 && (
            <>
              <span className="text-ink-500">
                {labels.length} transferred label{labels.length === 1 ? "" : "s"}
              </span>
              <button
                className="rounded-md border border-red-200 bg-surface px-2 py-1 text-red-600 transition-colors hover:bg-red-50"
                onClick={onClearLabels}
                title="Delete all transferred UV labels"
              >
                Clear labels
              </button>
            </>
          )}
          {available && (
            <button
              className="rounded-md border border-ink-200 bg-surface px-2 py-1 text-ink-700 transition-colors hover:bg-ink-50"
              onClick={saveSvg}
              disabled={busy}
              title="Save the UV chromatogram as an SVG file"
            >
              Save SVG
            </button>
          )}
          <PaperFigureExportToolbar
            disabled={busy || !available}
            storageKey="mfp-publication-plot-export-lcms-uv"
            onExport={saveUvPaper}
          />

          <button
            className="rounded-md border border-ink-200 bg-surface px-2 py-1 text-ink-700 transition-colors hover:bg-ink-50 disabled:cursor-not-allowed disabled:opacity-60"
            onClick={onPickFile}
            disabled={busy}
            title="Attach a UV/DAD chromatogram exported from your LC"
          >
            {busy ? "Working…" : available ? "Replace UV CSV…" : "Attach UV CSV(s)…"}
          </button>
          {available && (
            <button
              className="rounded-md border border-ink-200 bg-surface px-2 py-1 text-ink-500 transition-colors hover:bg-red-50 hover:text-red-600"
              onClick={onRemove}
              disabled={busy}
              title="Detach UV chromatogram"
            >
              Remove
            </button>
          )}
        </div>
      </div>

      {!uv ? (
        <div className="flex h-72 items-center justify-center text-sm text-ink-500">
          Loading UV…
        </div>
      ) : !canPlot ? (
        <div className="flex h-72 flex-col items-center justify-center gap-2 rounded-md border border-dashed border-ink-200 bg-ink-50/40 px-6 text-center">
          <div className="text-sm font-medium text-ink-700">
            No UV chromatogram attached
          </div>
          <div className="max-w-md text-xs text-ink-500">
            Most mzML files only contain MS scans. Export the UV/DAD trace from
            your LC software as CSV (time + signal columns) and attach it here
            to view it alongside the TIC.
          </div>
          <button className="btn-primary mt-1" onClick={onPickFile} disabled={busy}>
            Attach UV CSV(s)…
          </button>
        </div>
      ) : (
        <>
          <div
            ref={uvContainerRef}
            className="min-w-0 overflow-hidden"
            style={{ height: settings.height }}
          >
            <Plot
              revision={uvPlotSize.revision}
              data={[
                ...(available
                  ? [
                      {
                        type: "scattergl" as const,
                        mode: "lines" as const,
                        x: xs,
                        y: uv.signal,
                        line: { color: settings.color, width: settings.lineWidth },
                        hovertemplate: `RT: %{x:.3f} ${unit}<br>Signal: %{y:.3e}<extra></extra>`,
                        name: "UV",
                      },
                    ]
                  : []),
                ...overlayData,
              ]}
              layout={{
                height: uvPlotSize.height,
                width: uvPlotSize.width,
                margin: { l: 60, r: 20, t: 10, b: 40 },
                title: settings.title
                  ? { text: settings.title, font: { size: settings.titleSize } }
                  : undefined,
                font: { size: settings.tickSize },
                xaxis: {
                  title: axisTitle(`${settings.xTitle} (${unit})`, settings.axisTitleSize),
                  zeroline: false,
                  showgrid: settings.showGrid,
                  range: axisRange(settings.axis.xMin, settings.axis.xMax),
                  tickfont: { size: settings.tickSize },
                  ...axisFrame(settings),
                },
                yaxis: {
                  title: axisTitle(
                    settings.yTitle || meta?.y_label || meta?.y_col || "Signal (AU)",
                    settings.axisTitleSize,
                  ),
                  zeroline: false,
                  exponentformat: "e",
                  showgrid: settings.showGrid,
                  range: axisRange(settings.axis.yMin, settings.axis.yMax),
                  tickfont: { size: settings.tickSize },
                  ...axisFrame(settings),
                },
                hovermode: "x",
                annotations: [...primaryLabelLayer.annotations, ...overlayAnnotations],
                colorway: pt.colorway,
                plot_bgcolor: pt.plot_bgcolor,
                paper_bgcolor: pt.paper_bgcolor,
                showlegend: overlayData.length > 0,
                shapes: plotShapes,
              }}
              config={{
                responsive: true,
                displaylogo: false,
                editable: true,
                edits: {
                  annotationPosition: true,
                  annotationText: false,
                  axisTitleText: false,
                  titleText: false,
                },
              }}
              style={{ width: "100%", height: "100%", minWidth: 0 }}
              useResizeHandler
              onClick={onClick}
              onInitialized={(_figure, graphDiv) => {
                uvPlotRef.current = graphDiv as PlotlyHTMLElement;
                queuePlotlyElementResize(uvPlotRef.current);
              }}
              onUpdate={(_figure, graphDiv) => {
                uvPlotRef.current = graphDiv as PlotlyHTMLElement;
              }}
              onRelayout={handleRelayout}
            />
          </div>
          {labels.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2 px-1 text-xs">
              {labels.map((label) => (
                <span
                  key={label.id}
                  className="inline-flex max-w-full items-center gap-1 rounded-full border border-ink-200 bg-surface px-2 py-1 text-ink-700"
                  title={`UV RT ${label.uv_rt_min.toFixed(4)} min`}
                >
                  <button
                    className="truncate text-left hover:text-brand-700"
                    onClick={() => onEditLabel(label)}
                    title="Edit this UV label"
                  >
                    {cleanLabelText(label.text)}
                  </button>
                  <button
                    className="rounded-full px-1 font-semibold text-ink-400 hover:bg-red-50 hover:text-red-600"
                    onClick={() => onDeleteLabel(label.id)}
                    title="Delete this UV label"
                  >
                    x
                  </button>
                </span>
              ))}
            </div>
          )}
          {meta?.warnings && meta.warnings.length > 0 && (
            <div className="mt-1 px-1 text-[11px] text-amber-700">
              {meta.warnings.map((w, i) => (
                <div key={i}>• {w}</div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SpectrumChart(props: {
  spectrum: SpectrumData | null;
  overlayTraces: LCMSSpectrumOverlayTrace[];
  annotate: boolean;
  showOverlayLabels: boolean;
  showDragHint: boolean;
  selectedRt: number | null;
  rtUnit: RtUnit;
  settings: ChartSettings;
  polymerEnabled: boolean;
  onPeakClick?: (mz: number) => void;
}) {
  const s = props.spectrum;
  const specContainerRef = useRef<HTMLDivElement>(null);
  const specPlotRef = useRef<PlotlyHTMLElement | null>(null);
  const specPlotSize = useContainerSize(specContainerRef, props.settings.height);
  const pt = usePlotlyTheme();
  usePlotResizePulses([
    props.annotate,
    props.polymerEnabled,
    props.rtUnit,
    props.selectedRt,
    props.overlayTraces.length,
    props.showOverlayLabels,
    props.settings.axis.xMax,
    props.settings.axis.xMin,
    props.settings.axis.yMax,
    props.settings.axis.yMin,
    props.settings.barWidth,
    props.settings.color,
    props.settings.height,
    props.settings.labels.color,
    props.settings.labels.enabled,
    props.settings.labels.fontSize,
    props.settings.showGrid,
    props.settings.tickSize,
    props.settings.title,
    props.settings.xTitle,
    props.settings.yTitle,
    props.spectrum?.mz.length,
    props.spectrum?.labels.length,
    props.spectrum?.polymer_labels?.length,
    ...props.overlayTraces.map((trace) => trace.spectrum.mz.length),
  ], specPlotRef);
  const polymerLabelCount = s
    ? (s.polymer_labels ?? s.labels.filter((label) => label.source === "polymer")).length
    : 0;
  const visibleLabels = s
    ? s.labels.filter((label) => props.settings.labels.enabled || label.source === "polymer")
    : [];
  const handleSpectrumClick = (event: Readonly<PlotMouseEvent>) => {
    const point = event.points?.[0];
    const mz = Number(point?.x);
    if (!Number.isFinite(mz) || !props.onPeakClick) return;
    props.onPeakClick(mz);
  };
  const overlayData = useMemo(
    () =>
      props.overlayTraces.map((trace, index) => ({
        type: "bar" as const,
        x: trace.spectrum.mz,
        y: trace.spectrum.intensity,
        width: props.settings.barWidth,
        marker: { color: OVERLAY_PALETTE[index % OVERLAY_PALETTE.length] },
        opacity: 0.38,
        hovertemplate: `${trace.display_name}<br>m/z: %{x:.4f}<br>int: %{y:.3e}<extra></extra>`,
        name: trace.display_name,
      })),
    [props.overlayTraces, props.settings.barWidth],
  );
  const overlayAnnotations = useMemo(() => {
    if (!props.annotate || !props.showOverlayLabels) return [];
    return props.overlayTraces.flatMap((trace, traceIndex) =>
      trace.spectrum.labels
        .filter((label) => props.settings.labels.enabled || label.source === "polymer")
        .map((label, labelIndex) => ({
          x: label.mz,
          y: label.intensity,
          text: label.text ? cleanLabelText(label.text) : label.mz.toFixed(4),
          showarrow: false,
          yshift: 18 + traceIndex * 10 + labelIndex * 2,
          font: {
            size: Math.max(8, props.settings.labels.fontSize - 1),
            color: OVERLAY_PALETTE[traceIndex % OVERLAY_PALETTE.length],
          },
        })),
    );
  }, [
    props.annotate,
    props.overlayTraces,
    props.settings.labels.enabled,
    props.settings.labels.fontSize,
    props.showOverlayLabels,
  ]);
  const savePublication = useCallback(
    (format: PublicationExportFormat, exportSettings: PublicationExportSettings) => {
      if (!specPlotRef.current || !s) return;
      const rtPart = s.meta.rt_start != null
        ? `region_${s.meta.rt_start.toFixed(3)}_${s.meta.rt_end?.toFixed(3) ?? ""}`
        : `rt_${s.meta.rt_min.toFixed(3)}`;
      const base = sanitizeFilenamePart(props.settings.title || `lcms_ms1_${rtPart}`, "lcms_ms1_spectrum");
      void exportPlotlyPublicationImage(specPlotRef.current, {
        format,
        filename: `${base}_${publicationFilenameSuffix(exportSettings, format)}`,
        ...exportSettings,
      }, {
        layoutOverrides: {
          font: { family: "Arial, Helvetica, sans-serif", size: 9, color: "#111827" },
          margin: { l: 58, r: 18, t: props.settings.title ? 28 : 14, b: 46 },
        },
      });
    },
    [props.settings.title, s],
  );
  return (
    <div className="card flex min-w-0 shrink-0 flex-col overflow-hidden p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-1 pb-1">
        <h3 className="text-sm font-semibold">MS1 Spectrum</h3>
        {(s || props.selectedRt != null) && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-ink-500">
            {s?.meta.rt_start != null && s.meta.rt_end != null ? (
              <span className="rounded-full bg-brand-50 px-2 py-0.5 font-medium text-brand-700">
                Region {formatRt(s.meta.rt_start, props.rtUnit)} - {formatRt(s.meta.rt_end, props.rtUnit)}
              </span>
            ) : props.selectedRt != null ? (
              <span className="rounded-full bg-brand-50 px-2 py-0.5 font-medium text-brand-700">
                Selected RT {formatRt(props.selectedRt, props.rtUnit)}
              </span>
            ) : null}
            {s && (
              <span>
                {s.meta.polarity ?? "unk"} · {s.meta.n_peaks.toLocaleString()} peaks
                {props.polymerEnabled || polymerLabelCount > 0
                  ? ` · ${polymerLabelCount} polymer label${polymerLabelCount === 1 ? "" : "s"}`
                  : ""}
                {props.showDragHint && s.labels.length > 0
                  ? " · drag labels to reposition"
                  : ""}
              </span>
            )}
            {s && props.onPeakClick ? <span>Click a peak to create an EIC</span> : null}
            <PaperFigureExportToolbar
              disabled={!s}
              storageKey="mfp-publication-plot-export-lcms-spectrum"
              onExport={savePublication}
            />
            {s?.meta.n_scans != null && (
              <span>
                {s.meta.n_scans.toLocaleString()} scans, {s.meta.merge_mode ?? "sum"} merge
                {s.meta.bin_width != null ? `, ${s.meta.bin_width} m/z bins` : ""}
              </span>
            )}
            {s?.meta.ignored_peak_count ? (
              <span className="rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-700">
                ignored {s.meta.ignored_peak_count} peak{s.meta.ignored_peak_count === 1 ? "" : "s"}
                {s.meta.ignored_mz?.length ? ` near ${s.meta.ignored_mz.join(", ")}` : ""}
              </span>
            ) : null}
          </div>
        )}
      </div>
      {!s ? (
        <div className="flex h-72 items-center justify-center text-sm text-ink-500">
          Click a point on the TIC to view the MS1 spectrum at that retention time.
        </div>
      ) : (
        <div
          ref={specContainerRef}
          className="min-w-0 overflow-hidden"
          style={{ height: props.settings.height }}
        >
          <Plot
            revision={specPlotSize.revision}
            data={[
              {
                type: "bar",
                x: s.mz,
                y: s.intensity,
                width: props.settings.barWidth,
                marker: { color: props.settings.color },
                hovertemplate: "m/z: %{x:.4f}<br>int: %{y:.3e}<extra></extra>",
                name: "MS1",
              },
              ...overlayData,
            ]}
            layout={{
              height: specPlotSize.height,
              width: specPlotSize.width,
              margin: { l: 60, r: 20, t: 20, b: 40 },
              title: props.settings.title
                ? {
                    text: props.settings.title,
                    font: { size: props.settings.titleSize },
                  }
                : undefined,
              font: { size: props.settings.tickSize },
              xaxis: {
                title: axisTitle(props.settings.xTitle, props.settings.axisTitleSize),
                zeroline: false,
                showgrid: props.settings.showGrid,
                range: axisRange(props.settings.axis.xMin, props.settings.axis.xMax),
                tickfont: { size: props.settings.tickSize },
                ...axisFrame(props.settings),
              },
              yaxis: {
                title: axisTitle(props.settings.yTitle, props.settings.axisTitleSize),
                zeroline: false,
                exponentformat: "e",
                showgrid: props.settings.showGrid,
                range: axisRange(props.settings.axis.yMin, props.settings.axis.yMax),
                tickfont: { size: props.settings.tickSize },
                ...axisFrame(props.settings),
              },
              annotations: props.annotate
                ? [
                    ...visibleLabels.map((lbl) => ({
                      x: lbl.mz,
                      y: lbl.intensity,
                      text: lbl.text ? cleanLabelText(lbl.text) : lbl.mz.toFixed(4),
                      showarrow: lbl.source === "polymer",
                      arrowhead: 2,
                      arrowsize: 0.8,
                      arrowwidth: 1,
                      arrowcolor: "#7c3aed",
                      ax: 0,
                      ay: lbl.source === "polymer" ? -34 : 0,
                      yshift: lbl.source === "polymer" ? 0 : 10,
                      bgcolor:
                        lbl.source === "polymer" ? "rgba(124, 58, 237, 0.10)" : undefined,
                      bordercolor: lbl.source === "polymer" ? "#7c3aed" : undefined,
                      borderpad: lbl.source === "polymer" ? 3 : undefined,
                      font: {
                        size: props.settings.labels.fontSize,
                        color:
                          lbl.source === "polymer" ? "#7c3aed" : props.settings.labels.color,
                      },
                    })),
                    ...overlayAnnotations,
                  ]
                : [],
              colorway: pt.colorway,
              plot_bgcolor: pt.plot_bgcolor,
              paper_bgcolor: pt.paper_bgcolor,
              showlegend: overlayData.length > 0,
              barmode: "overlay",
              bargap: 0,
              dragmode: props.showDragHint ? "pan" : "zoom",
            }}
            config={{
              responsive: true,
              displaylogo: false,
              editable: props.showDragHint,
              edits: {
                annotationPosition: props.showDragHint,
                annotationText: false,
                axisTitleText: false,
                titleText: false,
              },
            }}
            style={{ width: "100%", height: "100%", minWidth: 0 }}
            useResizeHandler
            onClick={handleSpectrumClick}
            onInitialized={(_figure, graphDiv) => {
              specPlotRef.current = graphDiv as PlotlyHTMLElement;
              queuePlotlyElementResize(specPlotRef.current);
            }}
            onUpdate={(_figure, graphDiv) => {
              specPlotRef.current = graphDiv as PlotlyHTMLElement;
            }}
          />
        </div>
      )}
    </div>
  );
}

function EmptyState(props: { onPick: () => void }) {
  return (
    <div className="card flex flex-col items-center justify-center gap-3 p-12 text-center">
      <div className="text-4xl">📈</div>
      <div>
        <div className="text-lg font-semibold">Open an mzML file to begin</div>
        <div className="text-sm text-ink-500">
          The file is parsed with pyteomics on the backend and kept in memory.
        </div>
      </div>
      <button className="btn-primary" onClick={props.onPick}>
        Open mzML…
      </button>
    </div>
  );
}

// --- Status bar --------------------------------------------------------------

function StatusBar({
  truncName,
  ms1Count,
  rtRange,
  polLabel,
  uvAttached,
  offset,
}: {
  truncName: string;
  ms1Count: number;
  rtRange: string | null;
  polLabel: string;
  uvAttached: boolean;
  offset: number;
}) {
  const sep = <span className="text-ink-300">·</span>;
  return (
    <footer className="flex shrink-0 items-center justify-between border-t border-ink-200 bg-surface px-6 py-1.5 text-[11px] text-ink-500">
      <span className="font-medium text-ink-700 truncate max-w-[220px]">
        {truncName || "No session loaded"}
      </span>
      <span className="flex items-center gap-2">
        {ms1Count > 0 && <>{ms1Count} MS1 scans {sep}</>}
        {rtRange && <>{rtRange} {sep}</>}
        <span>{polLabel}</span>
        {offset !== 0 && <>{sep} UV offset {offset.toFixed(3)} min</>}
      </span>
      <span className="flex items-center gap-1.5">
        {uvAttached ? (
          <>
            <span className="h-1.5 w-1.5 rounded-full bg-green-400" />
            <span className="text-green-600">UV attached</span>
          </>
        ) : (
          <span className="text-ink-300">No UV</span>
        )}
      </span>
    </footer>
  );
}

// --- Dialogs -----------------------------------------------------------------

function Modal({
  title,
  onClose,
  children,
  footer,
  width = "max-w-xl",
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-ink-900/40 p-4">
      <div
        className={clsx(
          "flex max-h-[90vh] w-full flex-col overflow-hidden rounded-xl border border-ink-200 bg-surface shadow-xl",
          width,
        )}
      >
        <header className="flex items-center justify-between border-b border-ink-200 px-5 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          <button
            className="rounded-md p-1 text-ink-500 hover:bg-ink-100 hover:text-ink-800"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </header>
        <div className="flex-1 overflow-auto p-5 text-sm">{children}</div>
        {footer && (
          <footer className="flex items-center justify-end gap-2 border-t border-ink-200 bg-ink-50/40 px-5 py-3">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}

function FindMzDialog({
  input,
  setInput,
  tol,
  setTol,
  busy,
  onClose,
  onRun,
}: {
  input: string;
  setInput: (v: string) => void;
  tol: number;
  setTol: (v: number) => void;
  busy: boolean;
  onClose: () => void;
  onRun: () => void;
}) {
  return (
    <Modal
      title="Find m/z"
      onClose={onClose}
      footer={
        <>
          <button
            className="rounded-md border border-ink-200 bg-surface px-3 py-1.5 text-sm text-ink-700 hover:bg-ink-100"
            onClick={onClose}
          >
            Cancel
          </button>
          <button className="btn-primary" onClick={onRun} disabled={busy}>
            {busy ? "Searching…" : "Find"}
          </button>
        </>
      }
    >
      <p className="text-ink-600">
        Sweeps MS1 scans (sampled up to 200 probes) at the current polarity
        filter and jumps to the RT with the most intense peak within the
        tolerance window.
      </p>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <div>
          <div className="label">Target m/z</div>
          <input
            type="number"
            step="0.0001"
            className="input mt-1 w-full"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            autoFocus
          />
        </div>
        <div>
          <div className="label">Tolerance (Da)</div>
          <input
            type="number"
            step="0.001"
            className="input mt-1 w-full"
            value={tol}
            onChange={(e) => setTol(parseFloat(e.target.value) || 0.01)}
          />
        </div>
      </div>
    </Modal>
  );
}

function CustomUvLabelDialog({
  draft,
  onChange,
  onClose,
  onSave,
}: {
  draft: CustomUvLabelDraft;
  onChange: (draft: CustomUvLabelDraft) => void;
  onClose: () => void;
  onSave: (draft: CustomUvLabelDraft) => void;
}) {
  const patch = (next: Partial<CustomUvLabelDraft>) => onChange({ ...draft, ...next });
  return (
    <Modal
      title={draft.id ? "Edit UV Label" : "Custom UV Label"}
      onClose={onClose}
      footer={
        <>
          <button
            className="rounded-md border border-ink-200 bg-surface px-3 py-1.5 text-sm text-ink-700 hover:bg-ink-100"
            onClick={onClose}
          >
            Cancel
          </button>
          <button className="btn-primary" onClick={() => onSave(draft)}>
            Save
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <label className="block">
          <div className="label">Label text</div>
          <input
            className="input mt-1 w-full"
            value={draft.text}
            autoFocus
            onChange={(e) => patch({ text: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") onSave(draft);
            }}
          />
        </label>
        <NumberSetting
          label="UV RT (min)"
          value={Number.isFinite(parseFloat(draft.rtText)) ? parseFloat(draft.rtText) : null}
          step={0.0001}
          onChange={(value) => patch({ rtText: value == null ? "" : String(value) })}
        />
        <Check
          label="Snap to nearest UV peak"
          checked={draft.snap}
          onChange={(snap) => patch({ snap })}
        />
        <p className="text-xs text-ink-500">
          Clicking an existing label chip opens this dialog so you can rename it.
        </p>
      </div>
    </Modal>
  );
}

function EICDialog({
  input,
  setInput,
  tol,
  setTol,
  busy,
  onClose,
  onRun,
}: {
  input: string;
  setInput: (v: string) => void;
  tol: number;
  setTol: (v: number) => void;
  busy: boolean;
  onClose: () => void;
  onRun: () => void;
}) {
  return (
    <Modal
      title="Extracted Ion Chromatogram"
      onClose={onClose}
      footer={
        <>
          <button
            className="rounded-md border border-ink-200 bg-surface px-3 py-1.5 text-sm text-ink-700 hover:bg-ink-100"
            onClick={onClose}
          >
            Cancel
          </button>
          <button className="btn-primary" onClick={onRun} disabled={busy}>
            {busy ? "Extracting..." : "Generate EIC"}
          </button>
        </>
      }
    >
      <p className="text-ink-600">
        Sum intensity across every MS1 scan inside the target m/z window.
        The strongest EIC point will also load its nearest MS1 spectrum.
      </p>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <div>
          <div className="label">Target m/z</div>
          <input
            type="number"
            step="0.0001"
            className="input mt-1 w-full"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            autoFocus
          />
        </div>
        <div>
          <div className="label">Tolerance (Da)</div>
          <input
            type="number"
            step="0.001"
            min={0}
            className="input mt-1 w-full"
            value={tol}
            onChange={(e) => setTol(Math.max(0.000001, parseFloat(e.target.value) || 0.01))}
          />
        </div>
      </div>
    </Modal>
  );
}

type FeatureSortKey = "rtApex" | "mz" | "height" | "area" | "sn";
type FeatureSortDir = "asc" | "desc";

function FeatureTableDialog({
  rows,
  onDelete,
  onClear,
  onExportCsv,
  onClose,
  onUpdate,
  onLocate,
}: {
  rows: LCMSFeatureRow[];
  onDelete: (id: string) => void;
  onClear: () => void;
  onExportCsv: () => void;
  onClose: () => void;
  onUpdate: (id: string, patch: Partial<LCMSFeatureRow>) => void;
  onLocate: (eicPlotId: string) => void;
}) {
  const [sortKey, setSortKey] = useState<FeatureSortKey>("rtApex");
  const [sortDir, setSortDir] = useState<FeatureSortDir>("asc");
  const snFor = (row: LCMSFeatureRow): number => (row.baseline > 0 ? row.height / row.baseline : Infinity);
  const sortedRows = useMemo(() => {
    const factor = sortDir === "asc" ? 1 : -1;
    const getter: (r: LCMSFeatureRow) => number =
      sortKey === "rtApex"
        ? (r) => r.rtApex
        : sortKey === "mz"
          ? (r) => r.mz
          : sortKey === "height"
            ? (r) => r.height
            : sortKey === "area"
              ? (r) => r.area
              : snFor;
    return [...rows].sort((a, b) => {
      const va = getter(a);
      const vb = getter(b);
      if (!Number.isFinite(va) && !Number.isFinite(vb)) return 0;
      if (!Number.isFinite(va)) return 1;
      if (!Number.isFinite(vb)) return -1;
      return (va - vb) * factor;
    });
  }, [rows, sortKey, sortDir]);
  const toggleSort = (key: FeatureSortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(key === "rtApex" || key === "mz" ? "asc" : "desc");
    }
  };
  const sortIndicator = (key: FeatureSortKey) => (sortKey === key ? (sortDir === "asc" ? " ▲" : " ▼") : "");

  return (
    <Modal
      title="Feature Table"
      onClose={onClose}
      width="max-w-6xl"
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <button
            className="rounded-md border border-ink-200 bg-surface px-3 py-1.5 text-sm text-ink-700 hover:bg-ink-50 disabled:cursor-not-allowed disabled:text-ink-400"
            disabled={rows.length === 0}
            onClick={onClear}
          >
            Clear table
          </button>
          <div className="flex items-center gap-2">
            <button
              className="rounded-md border border-ink-200 bg-surface px-3 py-1.5 text-sm text-ink-700 hover:bg-ink-50 disabled:cursor-not-allowed disabled:text-ink-400"
              disabled={rows.length === 0}
              onClick={onExportCsv}
            >
              Export CSV
            </button>
            <button className="btn-primary" onClick={onClose}>Done</button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-4 text-sm">
        <div className="rounded-md border border-ink-200 bg-ink-50/60 px-3 py-2 text-xs text-ink-600">
          Integrate generated EICs to add rows here. Area is baseline-corrected trapezoid integration around the strongest EIC apex.
        </div>
        {rows.length === 0 ? (
          <div className="rounded-md border border-dashed border-ink-200 p-6 text-center text-sm text-ink-500">
            No features yet. Generate an EIC, then press Integrate on the EIC plot.
          </div>
        ) : (
          <div className="max-h-[560px] overflow-auto rounded-md border border-ink-200">
            <table className="min-w-full divide-y divide-ink-200 text-xs">
              <thead className="sticky top-0 bg-ink-50 text-left text-ink-600">
                <tr>
                  <th className="px-2 py-2 font-medium">Feature</th>
                  <th className="cursor-pointer select-none px-2 py-2 font-medium hover:text-ink-900" onClick={() => toggleSort("mz")}>
                    m/z{sortIndicator("mz")}
                  </th>
                  <th className="cursor-pointer select-none px-2 py-2 font-medium hover:text-ink-900" onClick={() => toggleSort("rtApex")}>
                    RT apex{sortIndicator("rtApex")}
                  </th>
                  <th className="px-2 py-2 font-medium">RT window</th>
                  <th className="cursor-pointer select-none px-2 py-2 font-medium hover:text-ink-900" onClick={() => toggleSort("height")}>
                    Height{sortIndicator("height")}
                  </th>
                  <th className="cursor-pointer select-none px-2 py-2 font-medium hover:text-ink-900" onClick={() => toggleSort("area")}>
                    Area{sortIndicator("area")}
                  </th>
                  <th className="px-2 py-2 font-medium">Baseline</th>
                  <th className="cursor-pointer select-none px-2 py-2 font-medium hover:text-ink-900" onClick={() => toggleSort("sn")}>
                    S/N{sortIndicator("sn")}
                  </th>
                  <th className="px-2 py-2 font-medium">Evidence</th>
                  <th className="px-2 py-2 font-medium">Source</th>
                  <th className="px-2 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100 bg-surface">
                {sortedRows.map((row, index) => {
                  const sn = snFor(row);
                  return (
                    <tr key={row.id}>
                      <td className="max-w-[240px] px-2 py-1.5">
                        <div className="font-medium text-ink-800">F{index + 1}</div>
                        <input
                          type="text"
                          className="mt-0.5 w-full rounded border border-ink-200 bg-surface px-1.5 py-0.5 text-[11px] text-ink-700 focus:border-brand-500 focus:outline-none"
                          placeholder="Label…"
                          value={row.label ?? ""}
                          onChange={(e) => onUpdate(row.id, { label: e.target.value || undefined })}
                        />
                      </td>
                      <td className="px-2 py-1.5 font-mono">
                        {row.mz.toFixed(4)}
                        <div className="text-[11px] text-ink-400">+/- {row.tolerance.toFixed(4)}</div>
                      </td>
                      <td className="px-2 py-1.5 font-mono">{row.rtApex.toFixed(3)}</td>
                      <td className="px-2 py-1.5 font-mono">
                        {row.rtStart.toFixed(3)}-{row.rtEnd.toFixed(3)}
                      </td>
                      <td className="px-2 py-1.5 font-mono">{row.height.toExponential(2)}</td>
                      <td className="px-2 py-1.5 font-mono">{row.area.toExponential(2)}</td>
                      <td className="px-2 py-1.5 font-mono">{row.baseline.toExponential(2)}</td>
                      <td className="px-2 py-1.5 font-mono">{Number.isFinite(sn) ? sn.toFixed(1) : "—"}</td>
                      <td className="max-w-[240px] px-2 py-1.5">
                        <div className="truncate">{row.expectedProduct || row.source}</div>
                        <input
                          type="text"
                          className="mt-0.5 w-full rounded border border-ink-200 bg-surface px-1.5 py-0.5 text-[11px] text-ink-700 focus:border-brand-500 focus:outline-none"
                          placeholder="Annotation…"
                          value={row.annotation ?? ""}
                          onChange={(e) => onUpdate(row.id, { annotation: e.target.value || undefined })}
                        />
                      </td>
                      <td className="max-w-[180px] px-2 py-1.5">
                        <div className="truncate">{row.sourceFile}</div>
                        <div className="text-[11px] text-ink-500">{row.polarity ?? "unknown"}</div>
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <div className="flex flex-col items-end gap-1">
                          <button
                            className="rounded-md border border-ink-200 bg-surface px-2 py-1 text-xs text-ink-700 hover:bg-ink-50"
                            onClick={() => onLocate(row.eicPlotId)}
                            title="Scroll to and highlight this row's EIC plot"
                          >
                            Open EIC
                          </button>
                          <button
                            className="rounded-md border border-ink-200 bg-surface px-2 py-1 text-xs text-ink-700 hover:bg-ink-50"
                            onClick={() => onDelete(row.id)}
                          >
                            Remove
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}

function ComparisonMatrixDialog({
  rows,
  sessions,
  onExportCsv,
  onClose,
}: {
  rows: LCMSFeatureRow[];
  sessions: LCMSSessionSummary[];
  onExportCsv: (
    rows: LCMSFeatureRow[],
    options: {
      metric: FeatureMatrixMetric;
      groupMode: FeatureMatrixGroupMode;
      mzTolerance: number;
      normalizeRows: boolean;
    },
  ) => Promise<void>;
  onClose: () => void;
}) {
  const [metric, setMetric] = useState<FeatureMatrixMetric>("area");
  const [groupMode, setGroupMode] = useState<FeatureMatrixGroupMode>("evidence");
  const [mzTolerance, setMzTolerance] = useState(0.05);
  const [normalizeRows, setNormalizeRows] = useState(false);
  const matrix = useMemo(
    () => groupFeatureRowsForMatrix(rows, sessions, { metric, groupMode, mzTolerance }),
    [groupMode, metric, mzTolerance, rows, sessions],
  );
  const { groups, columnIds, columnLabels } = matrix;
  const columnLabel = (id: string) => columnLabels[id] ?? id;
  const valueFor = (row: LCMSFeatureRow) => featureMatrixValue(row, metric);
  const cellMaxValue = (group: typeof groups[number]): number => {
    let max = 0;
    for (const cell of Object.values(group.cells)) {
      const v = valueFor(cell.row);
      if (v > max) max = v;
    }
    return max;
  };
  const formatCellValue = (cell: { row: LCMSFeatureRow } | undefined, maxValue: number) => {
    if (!cell) return "";
    const value = valueFor(cell.row);
    if (normalizeRows && maxValue > 0) return `${((value / maxValue) * 100).toFixed(1)}%`;
    return value >= 1000 || value < 0.01 ? value.toExponential(2) : value.toFixed(2);
  };
  const formatRtRange = (group: typeof groups[number]): string => {
    const spread = group.rtMax - group.rtMin;
    return spread > 0.01 ? `${group.rtMin.toFixed(3)}–${group.rtMax.toFixed(3)}` : group.rtApex.toFixed(3);
  };
  return (
    <Modal
      title="Comparison Matrix"
      onClose={onClose}
      width="max-w-7xl"
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <span className="text-xs text-ink-500">
            {groups.length} feature group{groups.length === 1 ? "" : "s"} across {columnIds.length} sample{columnIds.length === 1 ? "" : "s"}
          </span>
          <div className="flex items-center gap-2">
            <button
              className="rounded-md border border-ink-200 bg-surface px-3 py-1.5 text-sm text-ink-700 hover:bg-ink-50 disabled:cursor-not-allowed disabled:text-ink-400"
              disabled={groups.length === 0}
              onClick={() =>
                void onExportCsv(rows, {
                  metric,
                  groupMode,
                  mzTolerance,
                  normalizeRows,
                })
              }
            >
              Export CSV
            </button>
            <button className="btn-primary" onClick={onClose}>Done</button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-4 text-sm">
        <div className="grid grid-cols-4 gap-3">
          <SelectSetting
            label="Value"
            value={metric}
            options={[
              { value: "area", label: "Peak area" },
              { value: "height", label: "Peak height" },
            ]}
            onChange={(value) => setMetric(value as FeatureMatrixMetric)}
          />
          <SelectSetting
            label="Group rows by"
            value={groupMode}
            options={[
              { value: "evidence", label: "Evidence/label first" },
              { value: "mz", label: "m/z tolerance only" },
            ]}
            onChange={(value) => setGroupMode(value as FeatureMatrixGroupMode)}
          />
          <NumberSetting
            label="m/z grouping tolerance"
            value={mzTolerance}
            min={0.0001}
            max={2}
            step={0.001}
            onChange={(value) => setMzTolerance(Math.max(0.0001, value ?? 0.05))}
          />
          <label className="flex items-end gap-2 pb-2 text-xs text-ink-600">
            <input
              type="checkbox"
              checked={normalizeRows}
              onChange={(event) => setNormalizeRows(event.target.checked)}
            />
            Normalize each row to 100%
          </label>
        </div>
        <div className="rounded-md border border-ink-200 bg-ink-50/60 px-3 py-2 text-xs text-ink-600">
          This matrix uses integrated EIC features. Integrate matching EICs in each sample, then compare area or height here.
        </div>
        {rows.length === 0 ? (
          <div className="rounded-md border border-dashed border-ink-200 p-6 text-center text-sm text-ink-500">
            No integrated features yet. Generate and integrate EICs in one or more samples first.
          </div>
        ) : (
          <div className="max-h-[560px] overflow-auto rounded-md border border-ink-200">
            <table className="min-w-full divide-y divide-ink-200 text-xs">
              <thead className="sticky top-0 z-10 bg-ink-50 text-left text-ink-600">
                <tr>
                  <th className="sticky left-0 z-20 min-w-[220px] bg-ink-50 px-2 py-2 font-medium">Feature</th>
                  <th className="px-2 py-2 font-medium">m/z</th>
                  <th className="px-2 py-2 font-medium">RT</th>
                  <th className="px-2 py-2 font-medium">Polarity</th>
                  {columnIds.map((id) => (
                    <th key={id} className="min-w-[120px] px-2 py-2 font-medium">
                      <div className="max-w-[150px] truncate" title={columnLabel(id)}>
                        {columnLabel(id)}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100 bg-surface">
                {groups.map((group) => {
                  const maxValue = cellMaxValue(group);
                  return (
                    <tr key={group.id}>
                      <td className="sticky left-0 z-10 max-w-[260px] bg-surface px-2 py-1.5">
                        <div className="truncate font-medium text-ink-800" title={group.label}>{group.label}</div>
                        {group.annotation ? <div className="truncate text-[11px] text-ink-500">{group.annotation}</div> : null}
                      </td>
                      <td className="px-2 py-1.5 font-mono">{group.mz.toFixed(4)}</td>
                      <td className="px-2 py-1.5 font-mono" title={`RT range ${group.rtMin.toFixed(3)}–${group.rtMax.toFixed(3)}`}>{formatRtRange(group)}</td>
                      <td className="px-2 py-1.5">{group.polarity ?? "unknown"}</td>
                      {columnIds.map((id) => {
                        const cell = group.cells[id];
                        const extra = cell?.collisions.length ?? 0;
                        return (
                          <td key={id} className="px-2 py-1.5 font-mono">
                            <div className="flex items-baseline gap-1">
                              <span>{formatCellValue(cell, maxValue) || "-"}</span>
                              {extra > 0 ? (
                                <span
                                  className="rounded bg-amber-100 px-1 text-[10px] text-amber-800"
                                  title={`${extra} additional row${extra === 1 ? "" : "s"} matched this (group, sample)`}
                                >
                                  +{extra}
                                </span>
                              ) : null}
                            </div>
                            {cell && normalizeRows ? (
                              <div className="text-[11px] text-ink-400">
                                {valueFor(cell.row).toExponential(2)}
                              </div>
                            ) : null}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}

interface KendrickPersistedSettings {
  repeatSource: string;
  customMass: number;
  minRelIntensity: number;
  toleranceValue: number;
  toleranceUnit: "kmd" | "ppm";
  minSeriesPoints: number;
  xMode: "mz" | "knm";
  labelSeries: boolean;
}

function loadKendrickSettings(): Partial<KendrickPersistedSettings> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(KENDRICK_SETTINGS_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Partial<KendrickPersistedSettings>) : {};
  } catch {
    return {};
  }
}

function KendrickDialog({
  spectrum,
  settings,
  onCreateEic,
  onClose,
}: {
  spectrum: SpectrumData | null;
  settings: PolymerUiSettings;
  onCreateEic: (mz: number, tolerance: number, metadata?: Partial<LCMSEICMetadata>) => void;
  onClose: () => void;
}) {
  const monomers = useMemo(() => parseExpectedProductMonomers(polymerMonomerText(settings)), [settings]);
  const firstMass = monomers[0]?.mass ?? 100;
  const stored = useMemo(loadKendrickSettings, []);
  const [repeatSource, setRepeatSource] = useState(stored.repeatSource ?? (monomers[0] ? "0" : "custom"));
  const [customMass, setCustomMass] = useState(stored.customMass ?? firstMass);
  const [minRelIntensity, setMinRelIntensity] = useState(stored.minRelIntensity ?? 1);
  const [toleranceUnit, setToleranceUnit] = useState<"kmd" | "ppm">(stored.toleranceUnit ?? "kmd");
  const [toleranceValue, setToleranceValue] = useState(
    stored.toleranceValue ?? (stored.toleranceUnit === "ppm" ? 20 : 0.01),
  );
  const [minSeriesPoints, setMinSeriesPoints] = useState(stored.minSeriesPoints ?? 3);
  const [xMode, setXMode] = useState<"mz" | "knm">(stored.xMode ?? "mz");
  const [labelSeries, setLabelSeries] = useState(stored.labelSeries ?? true);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const payload: KendrickPersistedSettings = {
        repeatSource,
        customMass,
        minRelIntensity,
        toleranceValue,
        toleranceUnit,
        minSeriesPoints,
        xMode,
        labelSeries,
      };
      window.localStorage.setItem(KENDRICK_SETTINGS_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      /* ignore (private mode / SSR) */
    }
  }, [repeatSource, customMass, minRelIntensity, toleranceValue, toleranceUnit, minSeriesPoints, xMode, labelSeries]);
  const containerRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<PlotlyHTMLElement | null>(null);
  const plotSize = useContainerSize(containerRef, 460);
  const pt = usePlotlyTheme();

  const selectedMonomer = repeatSource === "custom" ? null : monomers[Number(repeatSource)] ?? null;
  const repeatMass = selectedMonomer?.mass ?? customMass;
  const nominalRepeatMass = Number.isFinite(repeatMass) && repeatMass > 0 ? Math.round(repeatMass) : null;
  const result = useMemo(
    () =>
      spectrum
        ? buildKendrickPoints(
            spectrum,
            repeatMass,
            minRelIntensity,
            toleranceValue,
            toleranceUnit,
            Math.max(2, Math.round(minSeriesPoints)),
          )
        : { points: [], series: [], truncated: false },
    [minRelIntensity, minSeriesPoints, repeatMass, spectrum, toleranceUnit, toleranceValue],
  );
  const pointsBySeries = useMemo(() => {
    const map = new Map<number, KendrickPoint[]>();
    for (const point of result.points) {
      if (point.seriesId == null) continue;
      const list = map.get(point.seriesId);
      if (list) list.push(point);
      else map.set(point.seriesId, [point]);
    }
    return map;
  }, [result.points]);
  const handleCreateSeriesEic = useCallback(
    (seriesId: number) => {
      const list = pointsBySeries.get(seriesId);
      if (!list || list.length === 0) return;
      const top = [...list].sort((a, b) => b.intensity - a.intensity).slice(0, 5);
      for (const point of top) onCreateEic(point.mz, 0.02);
    },
    [onCreateEic, pointsBySeries],
  );
  const labelIds = useMemo(
    () =>
      new Set(
        result.points
          .filter((point) => point.seriesId != null)
          .sort((a, b) => b.intensity - a.intensity)
          .slice(0, 80)
          .map((point) => point.id),
      ),
    [result.points],
  );
  usePlotResizePulses([
    labelSeries,
    minRelIntensity,
    minSeriesPoints,
    repeatMass,
    result.points.length,
    result.series.length,
    toleranceUnit,
    toleranceValue,
    xMode,
  ], plotRef);

  const xValues = result.points.map((point) => (xMode === "knm" ? point.kendrickNominalMass : point.mz));
  const markerColors = result.points.map((point) =>
    point.seriesId == null
      ? "rgba(70,83,106,0.45)"
      : pt.colorway[(point.seriesId - 1) % pt.colorway.length] ?? "#3559A8",
  );
  const markerSizes = result.points.map((point) => Math.min(18, 5 + Math.sqrt(point.relIntensity) * 1.4));
  const markerText = result.points.map((point) =>
    labelSeries && point.seriesId != null && labelIds.has(point.id)
      ? `S${point.seriesId} ${point.mz.toFixed(1)}`
      : "",
  );
  const shapes = result.series.map((series) => ({
    type: "line" as const,
    xref: "paper" as const,
    x0: 0,
    x1: 1,
    y0: series.center,
    y1: series.center,
    line: {
      color: pt.colorway[(series.id - 1) % pt.colorway.length] ?? "#3559A8",
      width: 1,
      dash: "dot" as const,
    },
  }));
  const savePublication = useCallback(
    (format: PublicationExportFormat, exportSettings: PublicationExportSettings) => {
      if (!plotRef.current || result.points.length === 0) return;
      void exportPlotlyPublicationImage(plotRef.current, {
        format,
        filename: `lcms_kendrick_${publicationFilenameSuffix(exportSettings, format)}`,
        ...exportSettings,
      }, {
        layoutOverrides: {
          font: { family: "Arial, Helvetica, sans-serif", size: 9, color: "#111827" },
          margin: { l: 58, r: 18, t: 16, b: 46 },
        },
      });
    },
    [result.points.length],
  );

  return (
    <Modal
      title="Kendrick Mass Defect"
      onClose={onClose}
      width="max-w-6xl"
      footer={<button className="btn-primary" onClick={onClose}>Done</button>}
    >
      <div className="flex flex-col gap-4 text-sm">
        <div className="grid grid-cols-6 gap-3">
          <SelectSetting
            label="Repeat unit"
            value={repeatSource}
            options={[
              ...monomers.map((monomer, index) => ({
                value: String(index),
                label: `${monomer.name} (${monomer.mass.toFixed(4)})`,
              })),
              { value: "custom", label: "Custom mass" },
            ]}
            onChange={setRepeatSource}
          />
          <NumberSetting
            label="Custom mass"
            value={customMass}
            min={0.0001}
            step={0.0001}
            onChange={(value) => setCustomMass(Math.max(0.0001, value ?? firstMass))}
          />
          <NumberSetting
            label="Min intensity (%)"
            value={minRelIntensity}
            min={0}
            max={100}
            step={0.1}
            onChange={(value) => setMinRelIntensity(Math.max(0, Math.min(100, value ?? 1)))}
          />
          <NumberSetting
            label={toleranceUnit === "ppm" ? "Tolerance (ppm)" : "KMD tolerance"}
            value={toleranceValue}
            min={toleranceUnit === "ppm" ? 0.1 : 0.0001}
            max={toleranceUnit === "ppm" ? 200 : 0.5}
            step={toleranceUnit === "ppm" ? 0.5 : 0.001}
            onChange={(value) =>
              setToleranceValue(
                Math.max(toleranceUnit === "ppm" ? 0.1 : 0.0001, value ?? (toleranceUnit === "ppm" ? 20 : 0.01)),
              )
            }
          />
          <SelectSetting
            label="Tolerance unit"
            value={toleranceUnit}
            options={[
              { value: "kmd", label: "Absolute KMD" },
              { value: "ppm", label: "ppm of m/z" },
            ]}
            onChange={(value) => {
              const next = value as "kmd" | "ppm";
              setToleranceUnit(next);
              setToleranceValue(next === "ppm" ? 20 : 0.01);
            }}
          />
          <NumberSetting
            label="Min line points"
            value={minSeriesPoints}
            min={2}
            max={20}
            step={1}
            onChange={(value) => setMinSeriesPoints(Math.max(2, Math.round(value ?? 3)))}
          />
          <SelectSetting
            label="X axis"
            value={xMode}
            options={[
              { value: "mz", label: "m/z" },
              { value: "knm", label: "Kendrick nominal" },
            ]}
            onChange={(value) => setXMode(value as "mz" | "knm")}
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-500">
          <div title="Nominal repeat mass = round(repeat mass). Custom values like 14.5 round up to 15 and silently shift the KMD scale.">
            Repeat {repeatMass.toFixed(6)} Da
            {nominalRepeatMass != null ? `, nominal ${nominalRepeatMass}` : ""}
            {spectrum ? `, ${result.points.length.toLocaleString()} plotted peaks` : ""}
            {result.truncated ? `, capped at ${KENDRICK_POINT_LIMIT.toLocaleString()}` : ""}
          </div>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={labelSeries}
              onChange={(event) => setLabelSeries(event.target.checked)}
            />
            Label series points
          </label>
          <PaperFigureExportToolbar
            disabled={!spectrum || result.points.length === 0}
            storageKey="mfp-publication-plot-export-lcms-kendrick"
            onExport={savePublication}
          />
        </div>
        {!spectrum ? (
          <div className="rounded-md border border-dashed border-ink-200 p-6 text-center text-sm text-ink-500">
            Load an MS1 spectrum first.
          </div>
        ) : result.points.length === 0 ? (
          <div className="rounded-md border border-dashed border-ink-200 p-6 text-center text-sm text-ink-500">
            No peaks passed the current Kendrick filters.
          </div>
        ) : (
          <div className="grid h-[520px] grid-cols-[minmax(0,1fr)_240px] gap-4">
            <div ref={containerRef} className="h-full min-w-0 overflow-hidden rounded-md border border-ink-200">
              <Plot
                revision={plotSize.revision}
                data={[
                  {
                    type: "scattergl",
                    mode: labelSeries ? "text+markers" : "markers",
                    x: xValues,
                    y: result.points.map((point) => point.kmd),
                    text: markerText,
                    textposition: "top center",
                    textfont: { size: 10, color: "#46536a" },
                    marker: {
                      color: markerColors,
                      size: markerSizes,
                      opacity: 0.82,
                      line: { color: "rgba(30,38,54,0.25)", width: 0.5 },
                    },
                    customdata: result.points.map((point) => [
                      point.mz,
                      point.intensity,
                      point.relIntensity,
                      point.kendrickMass,
                      point.kendrickNominalMass,
                      point.seriesId ?? "",
                    ]),
                    hovertemplate:
                      "m/z: %{customdata[0]:.4f}<br>Intensity: %{customdata[1]:.3e}<br>Relative: %{customdata[2]:.1f}%<br>Kendrick mass: %{customdata[3]:.4f}<br>Kendrick nominal: %{customdata[4]}<br>KMD: %{y:.5f}<br>Series: %{customdata[5]}<extra></extra>",
                    name: "KMD",
                  },
                ]}
                layout={{
                  height: plotSize.height,
                  width: plotSize.width,
                  margin: { l: 64, r: 20, t: 20, b: 48 },
                  font: { size: 12 },
                  xaxis: {
                    title: axisTitle(xMode === "knm" ? "Kendrick nominal mass" : "m/z", 13),
                    zeroline: false,
                    showgrid: true,
                  },
                  yaxis: {
                    title: axisTitle("Kendrick mass defect", 13),
                    zeroline: false,
                    showgrid: true,
                  },
                  shapes,
                  colorway: pt.colorway,
                  plot_bgcolor: pt.plot_bgcolor,
                  paper_bgcolor: pt.paper_bgcolor,
                  showlegend: false,
                  dragmode: "zoom",
                }}
                config={{ responsive: true, displaylogo: false }}
                style={{ width: "100%", height: "100%", minWidth: 0 }}
                useResizeHandler
                onInitialized={(_figure, graphDiv) => {
                  plotRef.current = graphDiv as PlotlyHTMLElement;
                  queuePlotlyElementResize(plotRef.current);
                }}
                onUpdate={(_figure, graphDiv) => {
                  plotRef.current = graphDiv as PlotlyHTMLElement;
                }}
              />
            </div>
            <div className="flex min-w-0 flex-col gap-2">
              <div className="label">Detected lines</div>
              <div className="max-h-[460px] overflow-auto rounded-md border border-ink-200">
                <table className="min-w-full divide-y divide-ink-200 text-xs">
                  <thead className="sticky top-0 bg-ink-50 text-left text-ink-600">
                    <tr>
                      <th className="px-2 py-2 font-medium">Line</th>
                      <th className="px-2 py-2 font-medium">KMD</th>
                      <th className="px-2 py-2 font-medium">Peaks</th>
                      <th className="px-2 py-2 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-100 bg-surface">
                    {result.series.length === 0 ? (
                      <tr>
                        <td className="px-2 py-3 text-ink-500" colSpan={4}>
                          No repeated KMD lines at this tolerance.
                        </td>
                      </tr>
                    ) : (
                      result.series.map((series) => (
                        <tr key={series.id}>
                          <td className="px-2 py-1.5 font-medium" style={{ color: pt.colorway[(series.id - 1) % pt.colorway.length] }}>
                            S{series.id}
                          </td>
                          <td className="px-2 py-1.5 font-mono">{series.center.toFixed(5)}</td>
                          <td className="px-2 py-1.5">{series.count}</td>
                          <td className="px-2 py-1.5">
                            <button
                              type="button"
                              className="rounded border border-ink-200 px-2 py-0.5 text-[11px] text-ink-700 hover:bg-ink-100"
                              onClick={() => handleCreateSeriesEic(series.id)}
                              title="Create EICs for the top 5 most-intense peaks in this series"
                            >
                              EIC
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

function ExpectedProductsDialog({
  polarity,
  settings,
  spectrum,
  tic,
  activeSid,
  onCreateEic,
  onClose,
}: {
  polarity: Exclude<Polarity, "all">;
  settings: PolymerUiSettings;
  spectrum: SpectrumData | null;
  tic: TICData | null;
  activeSid: string | null;
  onCreateEic: (mz: number, tolerance: number, metadata?: Partial<LCMSEICMetadata>) => void;
  onClose: () => void;
}) {
  const [maxDp, setMaxDp] = useState(3);
  const [resolutionMode, setResolutionMode] = useState<ExpectedProductResolutionMode>("normal");
  const [lowResolutionTolerance, setLowResolutionTolerance] = useState(0.15);
  const [showUnmatched, setShowUnmatched] = useState(false);
  const [allScansThresholdPct, setAllScansThresholdPct] = useState(5);
  const [exportingAllScans, setExportingAllScans] = useState(false);
  const VISIBLE_ROW_CAP = 300;
  const spectrumIndex = useMemo(() => (spectrum ? buildSpectrumIndex(spectrum) : null), [spectrum]);
  const rows = useMemo(
    () =>
      spectrumIndex
        ? buildExpectedProductHits(
            settings,
            polarity,
            spectrumIndex,
            maxDp,
            resolutionMode,
            lowResolutionTolerance,
          )
        : [],
    [lowResolutionTolerance, maxDp, polarity, resolutionMode, settings, spectrumIndex],
  );
  const filteredRows = showUnmatched ? rows : rows.filter((row) => row.observedMz != null);
  const visibleRows = filteredRows.slice(0, VISIBLE_ROW_CAP);
  const truncated = filteredRows.length > VISIBLE_ROW_CAP;
  const matchedCount = rows.filter((row) => row.observedMz != null).length;

  const CSV_HEADER = ["RT_min", "Scan", "Composition", "Variant", "Ion", "ExpectedMz", "ObservedMz", "AbsErrDa", "PpmErr", "Intensity", "ToleranceDa"];
  const rowToCsvCells = (r: ExpectedProductHit, rt: number, scanId: string) =>
    [rt.toFixed(4), scanId, r.composition, r.variant, r.ion,
      r.expectedMz.toFixed(6), r.observedMz?.toFixed(6) ?? "",
      r.absErr?.toFixed(6) ?? "", r.ppmErr?.toFixed(2) ?? "",
      r.intensity?.toExponential(4) ?? "", r.toleranceDa.toFixed(6),
    ];

  const downloadCsv = () => {
    if (!spectrum) return;
    const rt = spectrum.meta.rt_min;
    const scanId = spectrum.meta.spectrum_id.startsWith("summed:")
      ? `summed:${rt.toFixed(3)}`
      : formatScanId(spectrum.meta.spectrum_id);
    const csv = rowsToCsv([CSV_HEADER, ...rows.map((r) => rowToCsvCells(r, rt, scanId))]);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `expected_products_rt${rt.toFixed(3)}_dp${maxDp}_${polarity}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadAllScansCsv = async () => {
    if (!activeSid || !tic || tic.rt_min.length === 0) return;
    const maxTic = Math.max(...tic.tic);
    const threshold = maxTic * (allScansThresholdPct / 100);
    const rtsAboveThreshold = tic.rt_min.filter((_, i) => tic.tic[i] >= threshold);
    if (rtsAboveThreshold.length === 0) return;
    setExportingAllScans(true);
    const allRows: Array<Array<string | number>> = [CSV_HEADER];
    try {
      for (const rt of rtsAboveThreshold) {
        const sp = await api.lcms.spectrum(activeSid, {
          rt_min: rt,
          polarity: polarity === "positive" ? "positive" : "negative",
          top_n: 0,
          min_rel: 0,
        });
        const idx = buildSpectrumIndex(sp);
        const hits = buildExpectedProductHits(settings, polarity, idx, maxDp, resolutionMode, lowResolutionTolerance);
        const matched = hits.filter((r) => r.observedMz != null);
        const scanId = sp.meta.spectrum_id.startsWith("summed:")
          ? `summed:${rt.toFixed(3)}`
          : formatScanId(sp.meta.spectrum_id);
        for (const r of matched) {
          allRows.push(rowToCsvCells(r, rt, scanId));
        }
      }
      const csv = rowsToCsv(allRows);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `expected_products_all_scans_dp${maxDp}_${polarity}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExportingAllScans(false);
    }
  };

  return (
    <Modal
      title="Expected Products"
      onClose={onClose}
      footer={<button className="btn-primary" onClick={onClose}>Done</button>}
    >
      <div className="flex flex-col gap-4 text-sm">
        <div className="rounded-md border border-ink-200 bg-ink-50/60 px-3 py-2 text-xs text-ink-600">
          Matching expected oligomer products against the currently displayed MS1 spectrum.
        </div>
        <div className="grid grid-cols-4 gap-3">
          <NumberSetting
            label="Max oligomer size"
            value={maxDp}
            min={1}
            max={EXPECTED_PRODUCT_MAX_DP}
            step={1}
            onChange={(value) =>
              setMaxDp(Math.max(1, Math.min(EXPECTED_PRODUCT_MAX_DP, Math.round(value ?? 3))))
            }
          />
          <SelectSetting
            label="Resolution mode"
            value={resolutionMode}
            options={[
              { value: "normal", label: "Normal tolerance" },
              { value: "low", label: "Low resolution" },
            ]}
            onChange={(value) => setResolutionMode(value as ExpectedProductResolutionMode)}
          />
          <div title="Floor for matching in low-res mode. Configured ppm/Da is still used if wider.">
            <NumberSetting
              label="Low-res tolerance (Da)"
              value={lowResolutionTolerance}
              min={0.01}
              max={2}
              step={0.01}
              onChange={(value) => setLowResolutionTolerance(Math.max(0.01, value ?? 0.15))}
            />
          </div>
          <label className="flex items-end gap-2 pb-2 text-xs text-ink-600">
            <input
              type="checkbox"
              checked={showUnmatched}
              onChange={(event) => setShowUnmatched(event.target.checked)}
            />
            Show unmatched candidates
          </label>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-500">
          <div className="self-end pb-2 text-xs text-ink-500">
            {matchedCount} matched / {rows.length} candidates
            {truncated && (
              <span className="ml-2 rounded bg-amber-50 px-1.5 py-0.5 text-amber-800">
                showing first {VISIBLE_ROW_CAP}
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3 pb-2">
            {resolutionMode === "low" && (
              <span>
                Low resolution mode uses at least ± {lowResolutionTolerance.toFixed(2)} Da for matching.
              </span>
            )}
            <button
              className="rounded-md border border-ink-200 bg-surface px-2 py-1 text-xs text-ink-700 hover:bg-ink-50 disabled:cursor-not-allowed disabled:text-ink-400"
              onClick={downloadCsv}
              disabled={rows.length === 0 || !spectrum}
            >
              Export current scan CSV
            </button>
            <div className="flex items-center gap-1.5">
              <button
                className="rounded-md border border-brand-300 bg-surface px-2 py-1 text-xs text-brand-700 hover:bg-brand-50 disabled:cursor-not-allowed disabled:text-ink-400"
                onClick={() => void downloadAllScansCsv()}
                disabled={exportingAllScans || !activeSid || !tic}
                title={`Export matched products from all TIC scans above ${allScansThresholdPct}% of max TIC intensity`}
              >
                {exportingAllScans ? "Exporting…" : "Export all scans CSV"}
              </button>
              <span className="text-xs text-ink-500">TIC threshold:</span>
              <input
                type="number"
                className="input w-16 text-xs"
                value={allScansThresholdPct}
                min={0.1}
                max={100}
                step={0.5}
                onChange={(e) => setAllScansThresholdPct(Math.max(0.1, Math.min(100, parseFloat(e.target.value) || 5)))}
              />
              <span className="text-xs text-ink-500">% of max</span>
            </div>
          </div>
        </div>
        {!spectrum ? (
          <div className="rounded-md border border-dashed border-ink-200 p-6 text-center text-sm text-ink-500">
            Load an MS1 spectrum first.
          </div>
        ) : visibleRows.length === 0 ? (
          <div className="rounded-md border border-dashed border-ink-200 p-6 text-center text-sm text-ink-500">
            No expected products matched the current spectrum with the current tolerance.
          </div>
        ) : (
          <div className="max-h-[460px] overflow-auto rounded-md border border-ink-200">
            <table className="min-w-full divide-y divide-ink-200 text-xs">
              <thead className="sticky top-0 bg-ink-50 text-left text-ink-600">
                <tr>
                  <th className="px-2 py-2 font-medium">Product</th>
                  <th className="px-2 py-2 font-medium">Ion</th>
                  <th className="px-2 py-2 font-medium">Expected m/z</th>
                  <th className="px-2 py-2 font-medium">Observed</th>
                  <th className="px-2 py-2 font-medium">Error</th>
                  <th className="px-2 py-2 font-medium">Intensity</th>
                  <th className="px-2 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100 bg-surface">
                {visibleRows.map((row) => {
                  const mzForEic = row.observedMz ?? row.expectedMz;
                  return (
                    <tr key={row.id} className={row.observedMz == null ? "text-ink-400" : "text-ink-700"}>
                      <td className="max-w-[220px] px-2 py-1.5">
                        <div className="truncate font-medium">{row.composition}</div>
                        {row.variant ? <div className="text-[11px] text-ink-500">{row.variant}</div> : null}
                      </td>
                      <td className="px-2 py-1.5 font-mono">{row.ion}</td>
                      <td className="px-2 py-1.5 font-mono">{row.expectedMz.toFixed(4)}</td>
                      <td className="px-2 py-1.5 font-mono">
                        {row.observedMz != null ? row.observedMz.toFixed(4) : "-"}
                      </td>
                      <td className="px-2 py-1.5">
                        {row.absErr != null && row.ppmErr != null
                          ? `${row.absErr.toFixed(4)} Da / ${row.ppmErr.toFixed(1)} ppm`
                          : "-"}
                      </td>
                      <td className="px-2 py-1.5 font-mono">
                        {row.intensity != null ? row.intensity.toExponential(2) : "-"}
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <button
                          className="rounded-md border border-ink-200 bg-surface px-2 py-1 text-xs text-ink-700 hover:bg-ink-50"
                          onClick={() =>
                            onCreateEic(mzForEic, row.toleranceDa, {
                              label: `${row.composition} ${row.ion}`,
                              expectedProduct: row.composition,
                              annotation: [row.variant, row.ion].filter(Boolean).join(" "),
                            })
                          }
                        >
                          EIC
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}

function GraphSettingsDialog({
  settings,
  onChange,
  overlayEicEnabled,
  setOverlayEicEnabled,
  onSetDefault,
  onReset,
  onClose,
}: {
  settings: GraphSettings;
  onChange: (updater: (prev: GraphSettings) => GraphSettings) => void;
  overlayEicEnabled: boolean;
  setOverlayEicEnabled: (value: boolean) => void;
  onSetDefault: () => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const updateChart = (id: GraphId, patch: Partial<ChartSettings>) => {
    onChange((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  };
  const updateAxis = (id: GraphId, patch: Partial<AxisLimits>) => {
    onChange((prev) => ({
      ...prev,
      [id]: { ...prev[id], axis: { ...prev[id].axis, ...patch } },
    }));
  };
  const updateLabels = (id: GraphId, patch: Partial<LabelSettings>) => {
    onChange((prev) => ({
      ...prev,
      [id]: { ...prev[id], labels: { ...prev[id].labels, ...patch } },
    }));
  };
  const updateEicOverlay = (patch: Partial<EICOverlaySettings>) => {
    onChange((prev) => ({
      ...prev,
      eicOverlay: { ...prev.eicOverlay, ...patch },
    }));
  };

  const section = (id: GraphId, label: string) => {
    const s = settings[id];
    const labelsAvailable = id === "spectrum" || id === "uv";
    const labelControlsTitle = id === "uv" ? "UV labels" : "Peak labels";
    return (
      <section className="rounded-lg border border-ink-200 bg-surface p-4" key={id}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">{label}</h3>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-xs text-ink-600">
              <input
                type="checkbox"
                checked={s.showGrid}
                onChange={(e) => updateChart(id, { showGrid: e.target.checked })}
              />
              Grid
            </label>
            <label className="flex items-center gap-2 text-xs text-ink-600">
              <input
                type="checkbox"
                checked={s.showScaleBars}
                onChange={(e) =>
                  updateChart(id, { showScaleBars: e.target.checked })
                }
              />
              Axis scale bars
            </label>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <TextSetting
            label="Graph title"
            value={s.title}
            placeholder="No title"
            onChange={(value) => updateChart(id, { title: value })}
          />
          <NumberSetting
            label="Height (px)"
            value={s.height}
            min={180}
            max={900}
            step={10}
            onChange={(value) => updateChart(id, { height: value ?? s.height })}
          />
          <TextSetting
            label="X-axis title"
            value={s.xTitle}
            onChange={(value) => updateChart(id, { xTitle: value })}
          />
          <TextSetting
            label="Y-axis title"
            value={s.yTitle}
            onChange={(value) => updateChart(id, { yTitle: value })}
          />
          <ColorSetting
            label={id === "spectrum" ? "Bar color" : "Line color"}
            value={s.color}
            onChange={(value) => updateChart(id, { color: value })}
          />
          {id === "spectrum" ? (
            <NumberSetting
              label="Bar width"
              value={s.barWidth}
              min={0.05}
              max={5}
              step={0.05}
              onChange={(value) => updateChart(id, { barWidth: value ?? s.barWidth })}
            />
          ) : (
            <NumberSetting
              label="Line width"
              value={s.lineWidth}
              min={0.5}
              max={6}
              step={0.25}
              onChange={(value) => updateChart(id, { lineWidth: value ?? s.lineWidth })}
            />
          )}
          <NumberSetting
            label="Title size"
            value={s.titleSize}
            min={8}
            max={30}
            step={1}
            onChange={(value) => updateChart(id, { titleSize: value ?? s.titleSize })}
          />
          <NumberSetting
            label="Axis label size"
            value={s.axisTitleSize}
            min={8}
            max={28}
            step={1}
            onChange={(value) =>
              updateChart(id, { axisTitleSize: value ?? s.axisTitleSize })
            }
          />
          <NumberSetting
            label="Tick size"
            value={s.tickSize}
            min={8}
            max={24}
            step={1}
            onChange={(value) => updateChart(id, { tickSize: value ?? s.tickSize })}
          />
          <SelectSetting
            label="Frame"
            value={s.frameMode}
            options={[
              { value: "none", label: "No frame" },
              { value: "half", label: "Half frame" },
              { value: "full", label: "Full frame" },
            ]}
            onChange={(value) => updateChart(id, { frameMode: value as FrameMode })}
          />
        </div>

        <div className="mt-4">
          <div className="label">Axis limits</div>
          <div className="mt-2 grid grid-cols-4 gap-2">
            <NumberSetting
              label="X min"
              value={s.axis.xMin}
              nullable
              onChange={(value) => updateAxis(id, { xMin: value })}
            />
            <NumberSetting
              label="X max"
              value={s.axis.xMax}
              nullable
              onChange={(value) => updateAxis(id, { xMax: value })}
            />
            <NumberSetting
              label="Y min"
              value={s.axis.yMin}
              nullable
              onChange={(value) => updateAxis(id, { yMin: value })}
            />
            <NumberSetting
              label="Y max"
              value={s.axis.yMax}
              nullable
              onChange={(value) => updateAxis(id, { yMax: value })}
            />
          </div>
          <p className="mt-1 text-[11px] text-ink-500">
            Leave min/max blank to keep Plotly auto-scaling that axis.
          </p>
        </div>

        {id === "eic" && (
          <div className="mt-4 rounded-md border border-ink-200 bg-ink-50/40 p-3">
            <div className="mb-2 label">EIC overlay analysis</div>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex items-center gap-2 text-xs text-ink-600">
                <input
                  type="checkbox"
                  checked={overlayEicEnabled}
                  onChange={(event) => setOverlayEicEnabled(event.target.checked)}
                />
                Overlay generated EICs
              </label>
              <label className="flex items-center gap-2 text-xs text-ink-600">
                <input
                  type="checkbox"
                  checked={settings.eicOverlay.showLegend}
                  onChange={(event) => updateEicOverlay({ showLegend: event.target.checked })}
                />
                Show legend
              </label>
              <label className="flex items-center gap-2 text-xs text-ink-600">
                <input
                  type="checkbox"
                  checked={settings.eicOverlay.normalize}
                  onChange={(event) => updateEicOverlay({ normalize: event.target.checked })}
                />
                Normalize each EIC to 100%
              </label>
              <label className="flex items-center gap-2 text-xs text-ink-600">
                <input
                  type="checkbox"
                  checked={settings.eicOverlay.stack}
                  onChange={(event) => updateEicOverlay({ stack: event.target.checked })}
                />
                Stack traces vertically
              </label>
              <NumberSetting
                label="Overlay opacity"
                value={settings.eicOverlay.opacity}
                min={0.1}
                max={1}
                step={0.05}
                onChange={(value) =>
                  updateEicOverlay({ opacity: Math.min(1, Math.max(0.1, value ?? 0.9)) })
                }
              />
              <NumberSetting
                label="Stack gap (%)"
                value={settings.eicOverlay.stackGap}
                min={10}
                max={300}
                step={5}
                onChange={(value) =>
                  updateEicOverlay({ stackGap: Math.max(10, value ?? 110) })
                }
              />
            </div>
          </div>
        )}

        <div className="mt-4 rounded-md border border-ink-200 bg-ink-50/40 p-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="label">{labelControlsTitle}</div>
            {id !== "uv" && (
              <label className="flex items-center gap-2 text-xs text-ink-600">
                <input
                  type="checkbox"
                  checked={s.labels.enabled}
                  disabled={!labelsAvailable}
                  onChange={(e) => updateLabels(id, { enabled: e.target.checked })}
                />
                Enabled
              </label>
            )}
          </div>
          {labelsAvailable ? (
            <div className="grid grid-cols-2 gap-3">
              <NumberSetting
                label="Label size"
                value={s.labels.fontSize}
                min={6}
                max={24}
                step={1}
                onChange={(value) =>
                  updateLabels(id, { fontSize: value ?? s.labels.fontSize })
                }
              />
              <ColorSetting
                label="Label color"
                value={s.labels.color}
                onChange={(value) => updateLabels(id, { color: value })}
              />
              {id === "uv" && (
                <ColorSetting
                  label="Connector line color"
                  value={s.annotationConnectorColor ?? "#334155"}
                  onChange={(value) => updateChart(id, { annotationConnectorColor: value })}
                />
              )}
              {id === "uv" && (
                <NumberSetting
                  label="Connector line opacity"
                  value={s.annotationConnectorOpacity ?? 0.7}
                  min={0}
                  max={1}
                  step={0.05}
                  onChange={(value) =>
                    updateChart(id, {
                      annotationConnectorOpacity: Math.min(1, Math.max(0, value ?? 0.7)),
                    })
                  }
                />
              )}
            </div>
          ) : (
            <p className="text-xs text-ink-500">
              Reserved for future {label} label controls.
            </p>
          )}
        </div>
      </section>
    );
  };

  return (
    <Modal
      title="Graph Settings"
      onClose={onClose}
      footer={
        <>
          <button
            className="rounded-md border border-ink-200 bg-surface px-3 py-1.5 text-sm text-ink-700 hover:bg-ink-100"
            onClick={onReset}
          >
            Reset defaults
          </button>
          <button
            className="rounded-md border border-brand-200 bg-brand-50 px-3 py-1.5 text-sm font-medium text-brand-700 hover:bg-brand-100"
            onClick={onSetDefault}
          >
            Set current as default
          </button>
          <button className="btn-primary" onClick={onClose}>
            Done
          </button>
        </>
      }
    >
      <div className="mb-4 text-sm text-ink-600">
        Configure LCMS plot appearance. Axis limits apply only when both min and
        max are filled for that axis.
      </div>
      <div className="flex flex-col gap-4">
        {section("tic", "TIC")}
        {section("eic", "EIC")}
        {section("uv", "UV chromatogram")}
        {section("spectrum", "MS1 spectrum")}
      </div>
    </Modal>
  );
}

function TextSetting({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <div className="label">{label}</div>
      <input
        type="text"
        className="input mt-1 w-full"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function NumberSetting({
  label,
  value,
  nullable,
  min,
  max,
  step = 0.1,
  onChange,
}: {
  label: string;
  value: number | null;
  nullable?: boolean;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number | null) => void;
}) {
  return (
    <label className="block">
      <div className="label">{label}</div>
      <input
        type="number"
        className="input mt-1 w-full"
        value={value ?? ""}
        min={min}
        max={max}
        step={step}
        placeholder={nullable ? "auto" : undefined}
        onChange={(e) => {
          if (e.target.value === "") {
            onChange(nullable ? null : value);
            return;
          }
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(n);
        }}
      />
    </label>
  );
}

function SelectSetting({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <div className="label">{label}</div>
      <select
        className="input mt-1 w-full"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function ColorSetting({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <div className="label">{label}</div>
      <div className="mt-1 flex items-center gap-2">
        <input
          type="color"
          className="h-9 w-12 rounded border border-ink-200 bg-surface p-1"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <input
          type="text"
          className="input w-full font-mono"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    </label>
  );
}

function MonomerPresetBox({
  title,
  category,
  monomers,
  onChange,
}: {
  title: string;
  category: PolymerMonomerCategory;
  monomers: PolymerMonomerPreset[];
  onChange: (monomers: PolymerMonomerPreset[]) => void;
}) {
  const [name, setName] = useState("");
  const [abbr, setAbbr] = useState("");
  const [massText, setMassText] = useState("");
  const rows = monomers.filter((monomer) => monomer.category === category);
  const patchMonomer = (id: string, patch: Partial<PolymerMonomerPreset>) => {
    onChange(
      monomers.map((monomer) =>
        monomer.id === id ? { ...monomer, ...patch } : monomer,
      ),
    );
  };
  const addCustom = () => {
    const mass = parseFloat(massText);
    const cleanName = name.trim();
    const cleanAbbr = abbr.trim() || cleanName;
    if (!cleanName || !Number.isFinite(mass)) return;
    const slug = cleanName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    onChange([
      ...monomers,
      {
        id: `${category}:custom:${slug || "monomer"}:${Date.now()}`,
        category,
        name: cleanName,
        abbr: cleanAbbr,
        mass,
        selected: true,
        custom: true,
      },
    ]);
    setName("");
    setAbbr("");
    setMassText("");
  };
  return (
    <div className="rounded-md border border-ink-200 bg-surface p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-ink-500">
          {title}
        </div>
        <div className="text-xs text-ink-500">
          {rows.filter((monomer) => monomer.selected).length} selected
        </div>
      </div>
      <div className="max-h-56 overflow-auto rounded border border-ink-100">
        {rows.map((monomer) => (
          <div
            key={monomer.id}
            className="grid grid-cols-[minmax(0,1fr)_5rem_6rem_auto] items-center gap-2 border-b border-ink-100 px-2 py-1.5 last:border-b-0"
          >
            <label className="flex min-w-0 items-center gap-2">
              <input
                type="checkbox"
                checked={monomer.selected}
                onChange={(e) => patchMonomer(monomer.id, { selected: e.target.checked })}
              />
              <span className="min-w-0 truncate" title={monomer.name}>
                {monomer.name}
              </span>
            </label>
            <input
              className="input h-8 px-2 text-xs"
              value={monomer.abbr}
              title="Abbreviation used in labels"
              onChange={(e) => patchMonomer(monomer.id, { abbr: e.target.value })}
            />
            <span className="font-mono text-xs text-ink-500">
              {monomer.mass.toFixed(4)}
            </span>
            {monomer.custom ? (
              <button
                className="rounded px-1.5 py-0.5 text-xs text-ink-400 hover:bg-red-50 hover:text-red-600"
                onClick={() => onChange(monomers.filter((item) => item.id !== monomer.id))}
                title="Delete custom monomer"
              >
                x
              </button>
            ) : (
              <span className="w-4" />
            )}
          </div>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-[minmax(0,1fr)_5rem_6rem_auto] gap-2">
        <input
          className="input h-8 px-2 text-xs"
          placeholder="Custom name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          className="input h-8 px-2 text-xs"
          placeholder="Abbr"
          value={abbr}
          onChange={(e) => setAbbr(e.target.value)}
        />
        <input
          className="input h-8 px-2 text-xs"
          placeholder="Mass"
          type="number"
          step="0.000001"
          value={massText}
          onChange={(e) => setMassText(e.target.value)}
        />
        <button
          className="rounded-md border border-ink-200 bg-surface px-2 text-xs text-ink-700 hover:bg-ink-100 disabled:cursor-not-allowed disabled:opacity-60"
          onClick={addCustom}
          disabled={!name.trim() || !Number.isFinite(parseFloat(massText))}
        >
          Add
        </button>
      </div>
    </div>
  );
}

function PolymerDialog({
  polarity,
  settings,
  onChange,
  onClose,
}: {
  polarity: Polarity;
  settings: PolymerUiSettings;
  onChange: (settings: PolymerUiSettings) => void;
  onClose: () => void;
}) {
  const activeMode = polarity === "negative" ? "negative" : "positive";
  const disabled = polarity === "all";
  const shared = settings.shared;
  const profile = settings[activeMode];
  const patchShared = (next: Partial<PolymerSharedSettings>) =>
    onChange({ ...settings, shared: { ...settings.shared, ...next } });
  const patchProfile = (next: Partial<PolymerModeSettings>) =>
    onChange({ ...settings, [activeMode]: { ...profile, ...next } });
  const patchMonomers = (monomers: PolymerMonomerPreset[]) => onChange({ ...settings, monomers });
  const applySmallOligomerPreset = () => {
    onChange({
      ...settings,
      shared: {
        ...settings.shared,
        enabled: true,
        h2o_loss: true,
        cluster: true,
        charges: settings.shared.charges || "1",
      },
      [activeMode]: {
        ...profile,
        ...(activeMode === "positive"
          ? { adduct_na: true, adduct_k: true }
          : { adduct_cl: true, adduct_formate: true, adduct_acetate: true }),
      },
    });
  };
  const selectedSummary = polymerMonomerText(settings)
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(0, 6)
    .join(", ");
  return (
    <Modal
      title="Polymer / Reaction Match"
      onClose={onClose}
      footer={
        <>
          <button
            className="rounded-md border border-ink-200 bg-surface px-3 py-1.5 text-sm text-ink-700 hover:bg-ink-100"
            onClick={() => onChange(loadPolymerUiSettings())}
          >
            Reset
          </button>
          <button className="btn-primary" onClick={onClose} disabled={disabled}>
            Apply
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4 text-sm">
        {disabled && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">
            Choose Positive or Negative polarity before enabling polymer matching.
          </div>
        )}
        <label
          className={clsx(
            "flex items-center gap-2 text-sm text-ink-800",
            disabled && "opacity-60",
          )}
        >
          <input
            type="checkbox"
            checked={shared.enabled && !disabled}
            disabled={disabled}
            onChange={(e) => patchShared({ enabled: e.target.checked })}
          />
          <span>Enable polymer/reaction matching on spectrum</span>
        </label>
        {!disabled && (
          <div className="rounded-md border border-brand-200 bg-brand-50 px-3 py-2 text-xs text-brand-700">
            {polarity === "positive"
              ? "Positive mode: +H adduct mass with optional +Na/+K, water loss, and 2M clusters."
              : "Negative mode: -H adduct mass with optional +Cl/+HCOO/+Ac, water loss, and 2M clusters."}
          </div>
        )}
        {!disabled && (
          <button
            type="button"
            className="rounded-md border border-brand-200 bg-surface px-3 py-2 text-left text-xs text-brand-700 transition-colors hover:bg-brand-50"
            onClick={applySmallOligomerPreset}
          >
            Apply small-oligomer MS1 annotation preset
          </button>
        )}
        <GroupBox title="Monomers">
          <div className="rounded-md border border-ink-200 bg-ink-50/60 px-3 py-2 text-xs text-ink-600">
            Using: {selectedSummary || "no monomers selected"}
          </div>
          {!selectedSummary && (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Select at least one monomer below — adduct annotations are computed for compositions of the selected monomers.
            </div>
          )}
          <MonomerPresetBox
            title="Known hydroxy acids"
            category="hydroxy"
            monomers={settings.monomers}
            onChange={patchMonomers}
          />
          <MonomerPresetBox
            title="Amino acids"
            category="amino"
            monomers={settings.monomers}
            onChange={patchMonomers}
          />
          <label className="block">
            <div className="label">Other</div>
            <textarea
              className="input mt-1 h-24 w-full font-mono"
              value={shared.monomers_text}
              placeholder={"PEG 44.0262\nCustom,123.4567"}
              onChange={(e) => patchShared({ monomers_text: e.target.value })}
            />
            <p className="mt-1 text-xs text-ink-500">
              Freeform monomers still work: one per line as name mass, name,mass, or mass.
            </p>
          </label>
        </GroupBox>

        <div className="grid grid-cols-2 gap-3">
          <NumberSetting
            label="Per-bond delta"
            value={shared.bond_delta}
            step={0.000001}
            onChange={(value) => patchShared({ bond_delta: value ?? shared.bond_delta })}
          />
          <NumberSetting
            label="Extra delta"
            value={shared.extra_delta}
            step={0.000001}
            onChange={(value) => patchShared({ extra_delta: value ?? shared.extra_delta })}
          />
          <NumberSetting
            label={polarity === "negative" ? "-H adduct mass" : "+H adduct mass"}
            value={profile.adduct_mass}
            step={0.000001}
            onChange={(value) => patchProfile({ adduct_mass: value ?? profile.adduct_mass })}
          />
          <NumberSetting
            label="Cluster H adduct"
            value={profile.cluster_adduct_mass}
            step={0.000001}
            onChange={(value) =>
              patchProfile({ cluster_adduct_mass: value ?? profile.cluster_adduct_mass })
            }
          />
          <TextSetting
            label="Charges"
            value={shared.charges}
            onChange={(charges) => patchShared({ charges })}
          />
          <NumberSetting
            label="Max DP"
            value={shared.max_dp}
            min={1}
            max={200}
            step={1}
            onChange={(value) => patchShared({ max_dp: Math.max(1, value ?? shared.max_dp) })}
          />
          <NumberSetting
            label="Tolerance"
            value={shared.tol_value}
            min={0}
            step={0.001}
            onChange={(value) => patchShared({ tol_value: Math.max(0, value ?? shared.tol_value) })}
          />
          <SelectSetting
            label="Tolerance unit"
            value={shared.tol_unit}
            options={[
              { value: "Da", label: "Da" },
              { value: "ppm", label: "ppm" },
            ]}
            onChange={(tol_unit) => patchShared({ tol_unit: tol_unit as "Da" | "ppm" })}
          />
          <NumberSetting
            label="Min rel intensity"
            value={shared.min_rel_int}
            min={0}
            max={1}
            step={0.01}
            onChange={(value) =>
              patchShared({ min_rel_int: Math.max(0, Math.min(1, value ?? shared.min_rel_int)) })
            }
          />
        </div>

        {!disabled && (
          <GroupBox title={polarity === "negative" ? "Negative adducts" : "Positive adducts"}>
            <div className="grid grid-cols-2 gap-2">
              {polarity === "negative" ? (
                <>
                  <Check
                    label="+Cl"
                    checked={profile.adduct_cl}
                    onChange={(adduct_cl) => patchProfile({ adduct_cl })}
                  />
                  <Check
                    label="+HCOO"
                    checked={profile.adduct_formate}
                    onChange={(adduct_formate) => patchProfile({ adduct_formate })}
                  />
                  <Check
                    label="+Ac"
                    checked={profile.adduct_acetate}
                    onChange={(adduct_acetate) => patchProfile({ adduct_acetate })}
                  />
                </>
              ) : (
                <>
                  <Check
                    label="+Na"
                    checked={profile.adduct_na}
                    onChange={(adduct_na) => patchProfile({ adduct_na })}
                  />
                  <Check
                    label="+K"
                    checked={profile.adduct_k}
                    onChange={(adduct_k) => patchProfile({ adduct_k })}
                  />
                </>
              )}
            </div>
          </GroupBox>
        )}

        <GroupBox title="Variants">
          <Check
            label="Water loss (-H2O)"
            checked={shared.h2o_loss}
            onChange={(h2o_loss) => patchShared({ h2o_loss })}
          />
          <Check
            label="Decarboxylation (-CO2)"
            checked={shared.decarb}
            onChange={(decarb) => patchShared({ decarb })}
          />
          <Check
            label="Oxidation (+O)"
            checked={shared.oxid}
            onChange={(oxid) => patchShared({ oxid })}
          />
          <Check
            label={polarity === "negative" ? "Noncovalent dimers (2M-H)" : "Noncovalent dimers (2M+H)"}
            checked={shared.cluster}
            onChange={(cluster) => patchShared({ cluster })}
          />
        </GroupBox>
      </div>
    </Modal>
  );
}
