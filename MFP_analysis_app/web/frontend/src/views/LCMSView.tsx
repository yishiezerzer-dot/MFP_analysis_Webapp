import {
  ChangeEvent,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Plot from "react-plotly.js";
import type { PlotMouseEvent, PlotlyHTMLElement } from "plotly.js";
import clsx from "clsx";
import {
  api,
  LCMSSessionSummary,
  PolymerSettings,
  SpectrumData,
  SpectrumLabel,
  TICData,
  UVChromatogramResponse,
} from "../api";
import { PageHeaderContent, usePageHeader } from "../layout/PageHeader";

let pendingPlotResizeFrame: number | null = null;

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
): { height: number; width?: number } {
  const [size, setSize] = useState<{ height: number; width?: number }>({
    height: fallbackHeight,
  });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const h = Math.floor(entry.contentRect.height);
      const w = Math.floor(entry.contentRect.width);
      setSize((prev) => {
        const height = h > 0 ? h : prev.height;
        const width = w > 0 ? w : prev.width;
        return height === prev.height && width === prev.width ? prev : { height, width };
      });
      schedulePlotResize();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, fallbackHeight]);
  return size;
}

type Polarity = "all" | "positive" | "negative";
type RtUnit = "minutes" | "seconds";
type TabId = "navigate" | "view" | "annotate" | "polymer";
type GraphId = "tic" | "uv" | "spectrum";
type FrameMode = "none" | "half" | "full";
type UVLabelOrientation = "horizontal" | "vertical";

interface AxisLimits {
  xMin: number | null;
  xMax: number | null;
  yMin: number | null;
  yMax: number | null;
}

interface LabelSettings {
  enabled: boolean;
  fontSize: number;
  color: string;
}

interface ChartSettings {
  title: string;
  xTitle: string;
  yTitle: string;
  height: number;
  color: string;
  lineWidth: number;
  barWidth: number;
  titleSize: number;
  axisTitleSize: number;
  tickSize: number;
  showGrid: boolean;
  frameMode: FrameMode;
  showScaleBars: boolean;
  axis: AxisLimits;
  labels: LabelSettings;
}

interface GraphSettings {
  tic: ChartSettings;
  uv: ChartSettings;
  spectrum: ChartSettings;
}

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

interface PolymerSharedSettings {
  enabled: boolean;
  monomers_text: string;
  bond_delta: number;
  extra_delta: number;
  charges: string;
  decarb: boolean;
  oxid: boolean;
  cluster: boolean;
  max_dp: number;
  tol_value: number;
  tol_unit: "Da" | "ppm";
  min_rel_int: number;
}

type PolymerMonomerCategory = "hydroxy" | "amino";

interface PolymerMonomerPreset {
  id: string;
  category: PolymerMonomerCategory;
  name: string;
  abbr: string;
  mass: number;
  selected: boolean;
  custom?: boolean;
}

interface PolymerModeSettings {
  adduct_mass: number;
  cluster_adduct_mass: number;
  adduct_na: boolean;
  adduct_k: boolean;
  adduct_cl: boolean;
  adduct_formate: boolean;
  adduct_acetate: boolean;
}

interface PolymerUiSettings {
  shared: PolymerSharedSettings;
  positive: PolymerModeSettings;
  negative: PolymerModeSettings;
  monomers: PolymerMonomerPreset[];
}

const DEFAULT_AXIS_LIMITS: AxisLimits = {
  xMin: null,
  xMax: null,
  yMin: null,
  yMax: null,
};

const DEFAULT_GRAPH_SETTINGS: GraphSettings = {
  tic: {
    title: "",
    xTitle: "RT",
    yTitle: "TIC",
    height: 360,
    color: "#1e2636",
    lineWidth: 1.5,
    barWidth: 0.5,
    titleSize: 14,
    axisTitleSize: 13,
    tickSize: 12,
    showGrid: true,
    frameMode: "half",
    showScaleBars: true,
    axis: { ...DEFAULT_AXIS_LIMITS },
    labels: { enabled: false, fontSize: 10, color: "#46536a" },
  },
  uv: {
    title: "",
    xTitle: "RT",
    yTitle: "Signal",
    height: 320,
    color: "#5573b9",
    lineWidth: 1.5,
    barWidth: 0.5,
    titleSize: 14,
    axisTitleSize: 13,
    tickSize: 12,
    showGrid: true,
    frameMode: "half",
    showScaleBars: true,
    axis: { ...DEFAULT_AXIS_LIMITS },
    labels: { enabled: false, fontSize: 10, color: "#46536a" },
  },
  spectrum: {
    title: "",
    xTitle: "m/z",
    yTitle: "intensity",
    height: 360,
    color: "#323c50",
    lineWidth: 1.5,
    barWidth: 0.5,
    titleSize: 14,
    axisTitleSize: 13,
    tickSize: 12,
    showGrid: true,
    frameMode: "half",
    showScaleBars: true,
    axis: { ...DEFAULT_AXIS_LIMITS },
    labels: { enabled: true, fontSize: 10, color: "#46536a" },
  },
};

const GRAPH_SETTINGS_DEFAULT_STORAGE_KEY = "mfp.lcms.graphSettings.default";
const POLYMER_MONOMER_PRESETS_STORAGE_KEY = "mfp.lcms.polymerMonomerPresets";
const UV_PEAK_FETCH_LIMIT = 250;
const UV_LABEL_STAIR_X_STEP_MIN = 0.5;
const UV_LABEL_STAIR_Y_STEP_PX = 5;
const UV_LABEL_STAIR_BASE_Y_PX = 24;

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

function loadPolymerMonomerPresets(): PolymerMonomerPreset[] {
  const builtIns = clonePolymerMonomers(BUILT_IN_POLYMER_MONOMERS);
  if (typeof window === "undefined") return builtIns;
  try {
    const stored = window.localStorage.getItem(POLYMER_MONOMER_PRESETS_STORAGE_KEY);
    if (!stored) return builtIns;
    const saved = JSON.parse(stored) as PolymerMonomerPreset[];
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
  } catch {
    return builtIns;
  }
}

function savePolymerMonomerPresets(monomers: PolymerMonomerPreset[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(POLYMER_MONOMER_PRESETS_STORAGE_KEY, JSON.stringify(monomers));
}

function loadPolymerUiSettings(): PolymerUiSettings {
  return {
    ...DEFAULT_POLYMER_UI_SETTINGS,
    shared: { ...DEFAULT_POLYMER_SHARED_SETTINGS },
    positive: { ...DEFAULT_POLYMER_UI_SETTINGS.positive },
    negative: { ...DEFAULT_POLYMER_UI_SETTINGS.negative },
    monomers: loadPolymerMonomerPresets(),
  };
}

function polymerMonomerText(settings: PolymerUiSettings): string {
  const presetLines = settings.monomers
    .filter((monomer) => monomer.selected)
    .map((monomer) => `${monomer.abbr.trim() || monomer.name} ${monomer.mass.toFixed(6)}`);
  const otherLines = settings.shared.monomers_text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return [...presetLines, ...otherLines].join("\n");
}

function toApiPolymerSettings(
  settings: PolymerUiSettings,
  polarity: Exclude<Polarity, "all">,
): PolymerSettings {
  const profile = settings[polarity];
  return {
    ...settings.shared,
    monomers_text: polymerMonomerText(settings),
    ...profile,
    adduct_na: polarity === "positive" ? profile.adduct_na : false,
    adduct_k: polarity === "positive" ? profile.adduct_k : false,
    adduct_cl: polarity === "negative" ? profile.adduct_cl : false,
    adduct_formate: polarity === "negative" ? profile.adduct_formate : false,
    adduct_acetate: polarity === "negative" ? profile.adduct_acetate : false,
  };
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

function cloneGraphSettings(settings: GraphSettings): GraphSettings {
  return JSON.parse(JSON.stringify(settings)) as GraphSettings;
}

function loadGraphSettingsDefault(): GraphSettings {
  if (typeof window === "undefined") return cloneGraphSettings(DEFAULT_GRAPH_SETTINGS);
  try {
    const stored = window.localStorage.getItem(GRAPH_SETTINGS_DEFAULT_STORAGE_KEY);
    return stored
      ? (JSON.parse(stored) as GraphSettings)
      : cloneGraphSettings(DEFAULT_GRAPH_SETTINGS);
  } catch {
    return cloneGraphSettings(DEFAULT_GRAPH_SETTINGS);
  }
}

function saveGraphSettingsDefault(settings: GraphSettings) {
  window.localStorage.setItem(
    GRAPH_SETTINGS_DEFAULT_STORAGE_KEY,
    JSON.stringify(settings),
  );
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

function axisRange(min: number | null, max: number | null): [number, number] | undefined {
  return min != null && max != null ? [min, max] : undefined;
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

function toCSV(rows: string[][]): string {
  const esc = (v: string) =>
    /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  return rows.map((r) => r.map(esc).join(",")).join("\n");
}

// --- Main view ---------------------------------------------------------------

export function LCMSView() {
  // Sessions / data
  const [sessions, setSessions] = useState<LCMSSessionSummary[]>([]);
  const [activeSid, setActiveSid] = useState<string | null>(null);
  const [tic, setTic] = useState<TICData | null>(null);
  const [spectrum, setSpectrum] = useState<SpectrumData | null>(null);
  const [uv, setUv] = useState<UVChromatogramResponse | null>(null);

  // Filters / display
  const [polarity, setPolarity] = useState<Polarity>("all");
  const [rtUnit, setRtUnit] = useState<RtUnit>("minutes");

  // Right sidebar state
  const [activeTab, setActiveTab] = useState<TabId>("navigate");
  const [workflowHidden, setWorkflowHidden] = useState(false);
  const [showPolymerControls, setShowPolymerControls] = useState(false);
  const [showConfidenceControls, setShowConfidenceControls] = useState(false);
  const [showAlignmentDiagnostics, setShowAlignmentDiagnostics] = useState(false);

  // Panel visibility
  const [showTIC, setShowTIC] = useState(true);
  const [showSpectrum, setShowSpectrum] = useState(true);
  const [showUV, setShowUV] = useState(true);

  // UV↔MS alignment
  const [uvOffsetText, setUvOffsetText] = useState("0.000");
  const [uvOffset, setUvOffset] = useState(0);
  const [autoAlignUv, setAutoAlignUv] = useState(false);

  // Annotate – spectrum
  const [annotateSpectrum, setAnnotateSpectrum] = useState(true);
  const [spectrumTopN, setSpectrumTopN] = useState(10);
  const [spectrumMinRel, setSpectrumMinRel] = useState(0.05);
  const [enableDragLabels, setEnableDragLabels] = useState(true);

  // Annotate – UV
  const [transferMsToUv, setTransferMsToUv] = useState(false);
  const [uvTransferCount, setUvTransferCount] = useState(3);
  const [uvProminence, setUvProminence] = useState(0.05);
  const [uvMinDistance, setUvMinDistance] = useState(0.2);
  const [snapUvLabels, setSnapUvLabels] = useState(true);
  const [uvLabelOrientation, setUvLabelOrientation] =
    useState<UVLabelOrientation>("vertical");
  const [uvLabelStairXStep, setUvLabelStairXStep] =
    useState(UV_LABEL_STAIR_X_STEP_MIN);
  const [uvLabelStairYStep, setUvLabelStairYStep] =
    useState(UV_LABEL_STAIR_Y_STEP_PX);

  // Annotate – overlay
  const [showOverlayLabels, setShowOverlayLabels] = useState(false);
  const [multiDragOverlay, setMultiDragOverlay] = useState(false);
  const [polymerSettings, setPolymerSettings] =
    useState<PolymerUiSettings>(() => loadPolymerUiSettings());
  const [uvTextLabels, setUvTextLabels] = useState<UVTextLabel[]>([]);

  // View – region select
  const [regionSelect, setRegionSelect] = useState(false);

  // RT navigation
  const [selectedRt, setSelectedRt] = useState<number | null>(null);
  const [selectedUvRt, setSelectedUvRt] = useState<number | null>(null);
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
  const [customUvLabelDraft, setCustomUvLabelDraft] =
    useState<CustomUvLabelDraft | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);
  const uvFileRef = useRef<HTMLInputElement>(null);

  const active = useMemo(
    () => sessions.find((s) => s.session_id === activeSid) ?? null,
    [sessions, activeSid],
  );

  const pol = polarity === "all" ? undefined : polarity;
  const activePolymerSettings = useMemo(
    () =>
      polarity === "all" || !polymerSettings.shared.enabled
        ? undefined
        : toApiPolymerSettings(polymerSettings, polarity),
    [polarity, polymerSettings],
  );

  // --- data loading ---------------------------------------------------------

  useEffect(() => {
    api.lcms
      .list()
      .then((list) => {
        setSessions(list);
        if (list.length && !activeSid) setActiveSid(list[0].session_id);
      })
      .catch((err) => setError(String(err)));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    savePolymerMonomerPresets(polymerSettings.monomers);
  }, [polymerSettings.monomers]);

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

  const addSpectrumLabelsToUv = useCallback((sp: SpectrumData, anchors: UVLabelAnchor[]) => {
    if (!uv || uv.available !== true || anchors.length === 0) return 0;
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
    setUvTextLabels((prev) => [
      ...prev.filter(
        (label) =>
          label.kind === "custom" ||
          !anchors.some((anchor) => Math.abs(label.uv_rt_min - anchor.uv_rt_min) < 1e-6),
      ),
      ...nextLabels,
    ]);
    return nextLabels.length;
  }, [rtUnit, uv, uvLabelOrientation, uvOffset, uvTransferCount]);

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
  }, []);

  const deleteUvLabel = useCallback((id: string) => {
    setUvTextLabels((prev) => prev.filter((label) => label.id !== id));
  }, []);

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
    [selectedRt, uvAnchorAtRt, uvTextLabels],
  );

  const autoLabelUvPeaks = useCallback(async () => {
    if (!uv || uv.available !== true) {
      setInfo("Attach a UV chromatogram before auto-labeling UV peaks.");
      return;
    }
    if (!activeSid) return;
    setBusy(true);
    setError(null);
    try {
      const freshUv = await api.lcms.uv(activeSid, {
        top_n: UV_PEAK_FETCH_LIMIT,
        min_rel: uvProminence,
        min_distance_min: uvMinDistance,
      });
      setUv(freshUv);
      const peaks = freshUv.available === true ? freshUv.peaks : [];
      if (peaks.length === 0) {
        setInfo("No UV peaks were detected with the current UV peak settings.");
        return;
      }
      let labeledPeaks = 0;
      let labelCount = 0;
      for (let peakIndex = 0; peakIndex < peaks.length; peakIndex += 1) {
        const peak = peaks[peakIndex];
        const sp = await api.lcms.spectrum(activeSid, {
          rt_min: peak.rt_min + uvOffset,
          polarity: pol,
          top_n: Math.max(1, spectrumTopN),
          min_rel: Math.max(0, spectrumMinRel),
          polymer: activePolymerSettings,
        });
        const count = addSpectrumLabelsToUv(sp, [
          {
            uv_rt_min: peak.rt_min,
            signal: peak.signal,
            source_peak_index: peakIndex,
          },
        ]);
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
    const sortedIds = [...uvTextLabels]
      .sort((a, b) => a.uv_rt_min - b.uv_rt_min)
      .map((label) => label.id);
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
    const arranged = new Map<string, UVLabelLayoutOffset>();
    arrangeUvLabelsAsSeriesStairs(
      uvTextLabels,
      uvOffset,
      rtUnit === "seconds" ? 60 : 1,
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
    uv,
    uvLabelStairXStep,
    uvLabelStairYStep,
    uvOffset,
    uvTextLabels,
  ]);

  const onUpload = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const s = await api.lcms.upload(file);
      setSessions((prev) => [...prev, s]);
      setActiveSid(s.session_id);
      setSpectrum(null);
      setSelectedRt(null);
      setSelectedUvRt(null);
      setUvTextLabels([]);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const onRemove = async (sid: string) => {
    await api.lcms.remove(sid).catch((err) => setError(String(err)));
    setSessions((prev) => prev.filter((s) => s.session_id !== sid));
    if (activeSid === sid) {
      setActiveSid(null);
      setSpectrum(null);
      setTic(null);
      setSelectedRt(null);
      setSelectedUvRt(null);
      setUvTextLabels([]);
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

  const onRemoveUV = async () => {
    if (!activeSid) return;
    setUvBusy(true);
    try {
      await api.lcms.removeUV(activeSid);
      setUv({
        available: false,
        reason: "No UV chromatogram attached to this dataset.",
      });
      setUvTextLabels([]);
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
  const goJump = () => {
    const t = parseFloat(rtJumpText);
    if (!Number.isFinite(t) || rtList.length === 0) return;
    const rtMin = rtUnit === "seconds" ? t / 60.0 : t;
    const i = nearestIndex(rtList, rtMin);
    goToIndex(i);
  };

  // Find m/z: scan every MS1 at current filter for the most intense near m/z
  const [findMzInput, setFindMzInput] = useState("");
  const [findMzTol, setFindMzTol] = useState(0.01);
  const findMz = async () => {
    if (!activeSid) return;
    const target = parseFloat(findMzInput);
    if (!Number.isFinite(target)) return;
    setBusy(true);
    setError(null);
    try {
      // Crude but works: sweep every MS1 and ask backend for spectrum; pick the one
      // with highest intensity in [target-tol, target+tol]. For large files this is
      // slow, so we first downsample the RT grid to at most 200 probes.
      const probes: number[] = [];
      const n = rtList.length;
      if (n === 0) return;
      const stride = Math.max(1, Math.floor(n / 200));
      for (let i = 0; i < n; i += stride) probes.push(rtList[i]);

      let bestRt = probes[0];
      let bestIntensity = -1;
      for (const rt of probes) {
        const sp = await api.lcms.spectrum(activeSid, {
          rt_min: rt,
          polarity: pol,
          top_n: 5,
          min_rel: 0.0,
        });
        for (let i = 0; i < sp.mz.length; i += 1) {
          if (Math.abs(sp.mz[i] - target) <= findMzTol) {
            if (sp.intensity[i] > bestIntensity) {
              bestIntensity = sp.intensity[i];
              bestRt = rt;
            }
            break;
          }
        }
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
      const rows: string[][] = [["rt_min", "mz", "intensity"]];
      const stride = Math.max(1, Math.floor(rtList.length / 300));
      for (let i = 0; i < rtList.length; i += stride) {
        const rt = rtList[i];
        const sp = await api.lcms.spectrum(activeSid, {
          rt_min: rt,
          polarity: pol,
          top_n: Math.max(1, spectrumTopN),
          min_rel: spectrumMinRel,
        });
        for (const lbl of sp.labels) {
          rows.push([
            rt.toFixed(4),
            lbl.mz.toFixed(4),
            lbl.intensity.toExponential(3),
          ]);
        }
      }
      const blob = new Blob([toCSV(rows)], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${active?.display_name ?? "lcms"}.labels.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setInfo(`Exported ${rows.length - 1} labels across ${rtList.length} scans.`);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

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
          <input
            ref={fileRef}
            type="file"
            accept=".mzML,.mzml"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onUpload(f);
              e.target.value = "";
            }}
          />
          <button
            className="btn-primary"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            {busy ? "Working…" : "Open mzML…"}
          </button>
        </>
      }
    />,
  );

  const statusText = useMemo(() => {
    return {
      mzml: active?.display_name ?? "(no mzML)",
      uv:
        active?.uv?.available && active.uv.filename
          ? active.uv.filename
          : "(no UV linked)",
      polarity,
      offset: uvOffset,
    };
  }, [active, polarity, uvOffset]);

  // --- render ---------------------------------------------------------------

  return (
    <div className="flex h-full flex-col">
      {error && (
        <div className="border-b border-red-200 bg-red-50 px-6 py-2 text-sm text-red-700">
          {error}{" "}
          <button className="underline" onClick={() => setError(null)}>
            dismiss
          </button>
        </div>
      )}
      {info && (
        <div className="border-b border-brand-200 bg-brand-50 px-6 py-2 text-sm text-brand-700">
          {info}{" "}
          <button className="underline" onClick={() => setInfo(null)}>
            dismiss
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <SessionsSidebar
          sessions={sessions}
          activeSid={activeSid}
          onSelect={setActiveSid}
          onRemove={onRemove}
        />

        <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-auto p-6">
          <DatasetRibbon active={active} />

          {!active && <EmptyState onPick={() => fileRef.current?.click()} />}

          {active && (
            <>
              {showTIC && (
                <TICChart
                  tic={tic}
                  onClick={onTICClick}
                  selectedRt={selectedRt}
                  rtUnit={rtUnit}
                  regionSelect={regionSelect}
                  settings={graphSettings.tic}
                />
              )}
              {showUV && (
                <UVChromatogramChart
                  uv={uv}
                  busy={uvBusy}
                  xOffset={uvOffset}
                  selectedUvRt={
                    selectedUvRt ?? (selectedRt != null ? selectedRt - uvOffset : null)
                  }
                  labels={uvTextLabels}
                  rtUnit={rtUnit}
                  onPickFile={() => uvFileRef.current?.click()}
                  onRemove={onRemoveUV}
                  onClick={onUVClick}
                  onClearLabels={() => setUvTextLabels([])}
                  onDeleteLabel={deleteUvLabel}
                  onEditLabel={editUvLabel}
                  onMoveLabel={moveUvLabel}
                  labelOrientation={uvLabelOrientation}
                  settings={graphSettings.uv}
                />
              )}
              {showSpectrum && (
                <SpectrumChart
                  spectrum={spectrum}
                  annotate={annotateSpectrum}
                  showDragHint={enableDragLabels}
                  selectedRt={selectedRt}
                  rtUnit={rtUnit}
                  settings={graphSettings.spectrum}
                  polymerEnabled={Boolean(activePolymerSettings)}
                />
              )}
            </>
          )}

          <input
            ref={uvFileRef}
            type="file"
            accept=".csv,.tsv,.txt,text/csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onUploadUV(f);
              e.target.value = "";
            }}
          />
        </div>

        <ToolsPanel
          // Primary actions
          onEIC={() => setEicOpen(true)}
          onJumpMz={() => setFindMzOpen(true)}
          onExportLabels={exportLabels}
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
          onPrev={goPrev}
          onNext={goNext}
          onFirst={goFirst}
          onLast={goLast}
          onFindMz={() => setFindMzOpen(true)}
          onAutoAlignUV={autoAlignNow}
          onEICDialog={() => setEicOpen(true)}
          rtJumpText={rtJumpText}
          setRtJumpText={setRtJumpText}
          onRtJump={goJump}
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
          onGraphSettings={() => setGraphSettingsOpen(true)}
          showTIC={showTIC}
          setShowTIC={setShowTIC}
          showSpectrum={showSpectrum}
          setShowSpectrum={setShowSpectrum}
          showUV={showUV}
          setShowUV={setShowUV}
          regionSelect={regionSelect}
          setRegionSelect={setRegionSelect}
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
          uvLabelOrientation={uvLabelOrientation}
          setUvLabelOrientation={setUvLabelOrientation}
          uvLabelStairXStep={uvLabelStairXStep}
          setUvLabelStairXStep={setUvLabelStairXStep}
          uvLabelStairYStep={uvLabelStairYStep}
          setUvLabelStairYStep={setUvLabelStairYStep}
          onLabelSelectedRT={transferSelectedSpectrumToUv}
          onAutoLabelUV={autoLabelUvPeaks}
          onCustomUvLabel={openCustomUvLabel}
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
          onPolymerDialog={() => setPolymerDialogOpen(true)}
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
      {eicOpen && <EICDialog onClose={() => setEicOpen(false)} />}
      {graphSettingsOpen && (
        <GraphSettingsDialog
          settings={graphSettings}
          onChange={setGraphSettings}
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
      {customUvLabelDraft && (
        <CustomUvLabelDialog
          draft={customUvLabelDraft}
          onChange={setCustomUvLabelDraft}
          onClose={() => setCustomUvLabelDraft(null)}
          onSave={saveCustomUvLabel}
        />
      )}
    </div>
  );
}

// --- Left: sessions list -----------------------------------------------------

const SESSIONS_PIN_STORAGE_KEY = "mfp.lcms.sessions.pinned";

function SessionsSidebar(props: {
  sessions: LCMSSessionSummary[];
  activeSid: string | null;
  onSelect: (sid: string) => void;
  onRemove: (sid: string) => void;
}) {
  const [pinned, setPinned] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    const stored = window.localStorage.getItem(SESSIONS_PIN_STORAGE_KEY);
    return stored === "1";
  });
  const [hovered, setHovered] = useState(false);
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

  const expanded = pinned || hovered;

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

        {props.sessions.map((s, idx) => {
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
                    ? "border-brand-500 bg-white text-brand-600 shadow-card"
                    : "border-transparent text-ink-500 hover:border-ink-200 hover:bg-white",
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
                isActive ? "bg-white shadow-card" : "hover:bg-ink-100",
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
  busy,
  activeLoaded,
  onCollapse,
}: {
  onEIC: () => void;
  onJumpMz: () => void;
  onExportLabels: () => void;
  busy: boolean;
  activeLoaded: boolean;
  onCollapse?: () => void;
}) {
  return (
    <section className="border-b border-ink-200 bg-white p-4">
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
            className="rounded-md border border-ink-200 bg-white px-3 py-2 text-sm text-ink-700 transition-colors hover:bg-ink-100 disabled:cursor-not-allowed disabled:text-ink-400"
            disabled={!activeLoaded || busy}
            onClick={onJumpMz}
          >
            Jump to m/z…
          </button>
          <button
            className="rounded-md border border-ink-200 bg-white px-3 py-2 text-sm text-ink-700 transition-colors hover:bg-ink-100 disabled:cursor-not-allowed disabled:text-ink-400"
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
      <header className="flex items-start justify-between gap-2 bg-white p-4 pb-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">Workflow &amp; Tools</h3>
          <p className="mt-0.5 text-xs text-ink-500">
            Fine-tune visibility and advanced LCMS controls
          </p>
        </div>
        <button
          className="flex h-7 shrink-0 items-center gap-1 rounded-md border border-dashed border-ink-300 bg-white px-2 text-xs text-ink-700 hover:bg-ink-100"
          onClick={() => setHidden(!hidden)}
        >
          {hidden ? "Show ▼" : "Hide ▲"}
        </button>
      </header>

      {!hidden && (
        <>
          <div className="flex flex-col gap-1 bg-white/70 px-4 pb-2">
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

          <div className="flex items-center gap-1 border-b border-ink-200 bg-white/70 px-3 pt-2">
            {(
              [
                { id: "navigate", label: "Navigate" },
                { id: "view", label: "View" },
                { id: "annotate", label: "Annotate" },
                ...(showPolymerControls
                  ? [{ id: "polymer" as const, label: "Polymer" }]
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
        <button
          className="mt-2 rounded-md border border-ink-200 bg-white px-3 py-1.5 text-xs text-ink-700 hover:bg-ink-100 disabled:cursor-not-allowed disabled:opacity-60"
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
            className="rounded-md border border-ink-200 bg-white px-3 py-1.5 text-xs text-ink-700 hover:bg-ink-100 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={!p.activeLoaded}
            onClick={p.onLabelSelectedRT}
          >
            Label selected RT
          </button>
          <button
            className="rounded-md border border-ink-200 bg-white px-3 py-1.5 text-xs text-ink-700 hover:bg-ink-100"
            onClick={p.onAutoLabelUV}
            disabled={!p.activeLoaded}
          >
            Auto Label UV Peaks
          </button>
        </div>
      </GroupBox>

      <div className="grid grid-cols-3 gap-2">
        <button
          className="rounded-md border border-ink-200 bg-white px-2 py-1.5 text-xs text-ink-700 hover:bg-ink-100 disabled:cursor-not-allowed disabled:opacity-60"
          disabled
          title="Coming soon"
        >
          Annotate Peaks…
        </button>
        <button
          className="rounded-md border border-ink-200 bg-white px-2 py-1.5 text-xs text-ink-700 hover:bg-ink-100"
          onClick={p.onAutoArrangeLabels}
          disabled={p.uvLabelCount === 0}
        >
          Auto Arrange Labels
        </button>
        <button
          className="rounded-md border border-ink-200 bg-white px-2 py-1.5 text-xs text-ink-700 hover:bg-ink-100 disabled:cursor-not-allowed disabled:opacity-60"
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
}: {
  polarity: Polarity;
  settings: PolymerUiSettings;
  onChange: (settings: PolymerUiSettings) => void;
  onOpen: () => void;
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
      </GroupBox>
    </div>
  );
}

// --- Small layout primitives -------------------------------------------------

function GroupBox({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="rounded-md border border-ink-200 bg-white p-3">
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
  onClick: (e: Readonly<PlotMouseEvent>) => void;
  selectedRt: number | null;
  rtUnit: RtUnit;
  regionSelect: boolean;
  settings: ChartSettings;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const plotSize = useContainerSize(containerRef, props.settings.height);
  const scale = props.rtUnit === "seconds" ? 60 : 1;
  const unit = props.rtUnit === "seconds" ? "s" : "min";
  const xs = useMemo(
    () => (props.tic ? props.tic.rt_min.map((v) => v * scale) : []),
    [props.tic, scale],
  );
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
  return (
    <div className="card flex min-w-0 shrink-0 flex-col overflow-hidden p-3">
      <div className="flex items-baseline justify-between px-1 pb-1">
        <h3 className="text-sm font-semibold">Total Ion Chromatogram</h3>
        <div className="flex items-center gap-2 text-xs text-ink-500">
          {props.selectedRt != null && (
            <span className="rounded-full bg-brand-50 px-2 py-0.5 font-medium text-brand-700">
              Selected RT {formatRt(props.selectedRt, props.rtUnit)}
            </span>
          )}
          <span>
            {props.regionSelect
              ? "Drag on the plot to select an RT region"
              : "Click a point to load the spectrum at that RT"}
          </span>
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
            data={[
              {
                type: "scattergl",
                mode: "lines",
                x: xs,
                y: props.tic.tic,
                line: { color: props.settings.color, width: props.settings.lineWidth },
                hovertemplate: `RT: %{x:.3f} ${unit}<br>TIC: %{y:.3e}<extra></extra>`,
                name: "TIC",
              },
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
              plot_bgcolor: "#ffffff",
              paper_bgcolor: "#ffffff",
              showlegend: false,
              shapes,
              dragmode: props.regionSelect ? "select" : "zoom",
            }}
            config={{ responsive: true, displaylogo: false }}
            style={{ width: "100%", height: "100%", minWidth: 0 }}
            useResizeHandler
            onClick={props.onClick}
          />
        </div>
      )}
    </div>
  );
}

function UVChromatogramChart(props: {
  uv: UVChromatogramResponse | null;
  busy: boolean;
  xOffset: number;
  selectedUvRt: number | null;
  labels: UVTextLabel[];
  rtUnit: RtUnit;
  onPickFile: () => void;
  onRemove: () => void;
  onClick: (e: Readonly<PlotMouseEvent>) => void;
  onClearLabels: () => void;
  onDeleteLabel: (id: string) => void;
  onEditLabel: (label: UVTextLabel) => void;
  onMoveLabel: (id: string, patch: Partial<UVTextLabel>) => void;
  labelOrientation: UVLabelOrientation;
  settings: ChartSettings;
}) {
  const {
    uv,
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
    labelOrientation,
    settings,
  } = props;
  const available = uv?.available === true;
  const meta = available ? uv.meta : null;
  const scale = rtUnit === "seconds" ? 60 : 1;
  const unit = rtUnit === "seconds" ? "s" : "min";
  const uvContainerRef = useRef<HTMLDivElement>(null);
  const uvPlotRef = useRef<PlotlyHTMLElement | null>(null);
  const uvPlotSize = useContainerSize(uvContainerRef, settings.height);

  const xs = available ? uv.rt_min.map((v) => (v + xOffset) * scale) : [];
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
    labelOrientation,
    labels.length,
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
  const handleRelayout = (event: Readonly<Record<string, unknown>>) => {
    labels.forEach((label, index) => {
      const patch: Partial<UVTextLabel> = {};
      const ax = event[`annotations[${index}].ax`];
      const ay = event[`annotations[${index}].ay`];
      if (typeof ax === "number" && Number.isFinite(ax)) patch.ax = ax;
      if (typeof ay === "number" && Number.isFinite(ay)) patch.ay = ay;
      if (Object.keys(patch).length > 0) onMoveLabel(label.id, patch);
    });
  };
  const shapes =
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
          {labels.length > 0 && (
            <>
              <span className="text-ink-500">
                {labels.length} transferred label{labels.length === 1 ? "" : "s"}
              </span>
              <button
                className="rounded-md border border-red-200 bg-white px-2 py-1 text-red-600 transition-colors hover:bg-red-50"
                onClick={onClearLabels}
                title="Delete all transferred UV labels"
              >
                Clear labels
              </button>
            </>
          )}
          {available && (
            <button
              className="rounded-md border border-ink-200 bg-white px-2 py-1 text-ink-700 transition-colors hover:bg-ink-50"
              onClick={saveSvg}
              disabled={busy}
              title="Save the UV chromatogram as an SVG file"
            >
              Save SVG
            </button>
          )}
          <button
            className="rounded-md border border-ink-200 bg-white px-2 py-1 text-ink-700 transition-colors hover:bg-ink-50 disabled:cursor-not-allowed disabled:opacity-60"
            onClick={onPickFile}
            disabled={busy}
            title="Attach a UV/DAD chromatogram exported from your LC"
          >
            {busy ? "Working…" : available ? "Replace UV CSV…" : "Attach UV CSV…"}
          </button>
          {available && (
            <button
              className="rounded-md border border-ink-200 bg-white px-2 py-1 text-ink-500 transition-colors hover:bg-red-50 hover:text-red-600"
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
      ) : !available ? (
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
            Attach UV CSV…
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
              data={[
                {
                  type: "scattergl",
                  mode: "lines",
                  x: xs,
                  y: uv.signal,
                  line: { color: settings.color, width: settings.lineWidth },
                  hovertemplate: `RT: %{x:.3f} ${unit}<br>Signal: %{y:.3e}<extra></extra>`,
                  name: "UV",
                },
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
                annotations: labels.map((label, index) => ({
                  x: (label.uv_rt_min + xOffset) * scale,
                  y: label.signal,
                  text: cleanLabelText(label.text),
                  textangle: labelOrientation === "vertical" ? "-90" : "0",
                  showarrow: true,
                  arrowhead: 0,
                  ax: label.ax ?? 0,
                  axref: label.axRef === "x" ? "x" : "pixel",
                  ayref: label.ayRef === "y" ? "y" : "pixel",
                  ay:
                    label.ay ??
                    (labelOrientation === "vertical" ? -78 - index * 26 : -42 - index * 22),
                  font: {
                    size: settings.labels.fontSize,
                    color: settings.labels.color,
                  },
                })),
                plot_bgcolor: "#ffffff",
                paper_bgcolor: "#ffffff",
                showlegend: false,
                shapes,
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
                  className="inline-flex max-w-full items-center gap-1 rounded-full border border-ink-200 bg-white px-2 py-1 text-ink-700"
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
  annotate: boolean;
  showDragHint: boolean;
  selectedRt: number | null;
  rtUnit: RtUnit;
  settings: ChartSettings;
  polymerEnabled: boolean;
}) {
  const s = props.spectrum;
  const specContainerRef = useRef<HTMLDivElement>(null);
  const specPlotSize = useContainerSize(specContainerRef, props.settings.height);
  const polymerLabelCount = s
    ? (s.polymer_labels ?? s.labels.filter((label) => label.source === "polymer")).length
    : 0;
  const visibleLabels = s
    ? s.labels.filter((label) => props.settings.labels.enabled || label.source === "polymer")
    : [];
  return (
    <div className="card flex min-w-0 shrink-0 flex-col overflow-hidden p-3">
      <div className="flex items-baseline justify-between px-1 pb-1">
        <h3 className="text-sm font-semibold">MS1 Spectrum</h3>
        {(s || props.selectedRt != null) && (
          <div className="flex items-center gap-2 text-xs text-ink-500">
            {props.selectedRt != null && (
              <span className="rounded-full bg-brand-50 px-2 py-0.5 font-medium text-brand-700">
                Selected RT {formatRt(props.selectedRt, props.rtUnit)}
              </span>
            )}
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
                ? visibleLabels.map((lbl) => ({
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
                  }))
                : [],
              plot_bgcolor: "#ffffff",
              paper_bgcolor: "#ffffff",
              showlegend: false,
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
  mzml,
  uv,
  polarity,
  offset,
}: {
  mzml: string;
  uv: string;
  polarity: Polarity;
  offset: number;
}) {
  return (
    <footer className="flex shrink-0 items-center gap-4 border-t border-ink-200 bg-white px-6 py-1.5 text-[11px] text-ink-600">
      <span>
        <span className="font-medium text-ink-500">MzML:</span> {mzml}
      </span>
      <span className="text-ink-300">|</span>
      <span>
        <span className="font-medium text-ink-500">UV:</span> {uv}
      </span>
      <span className="text-ink-300">|</span>
      <span>
        <span className="font-medium text-ink-500">Polarity filter:</span>{" "}
        {polarity}
      </span>
      <span className="text-ink-300">|</span>
      <span>
        <span className="font-medium text-ink-500">UV↔MS offset:</span>{" "}
        {offset.toFixed(3)} min
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
          "flex max-h-[90vh] w-full flex-col overflow-hidden rounded-xl border border-ink-200 bg-white shadow-xl",
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
            className="rounded-md border border-ink-200 bg-white px-3 py-1.5 text-sm text-ink-700 hover:bg-ink-100"
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
            className="rounded-md border border-ink-200 bg-white px-3 py-1.5 text-sm text-ink-700 hover:bg-ink-100"
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

function EICDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal
      title="Extracted Ion Chromatogram"
      onClose={onClose}
      footer={
        <button
          className="rounded-md border border-ink-200 bg-white px-3 py-1.5 text-sm text-ink-700 hover:bg-ink-100"
          onClick={onClose}
        >
          Close
        </button>
      }
    >
      <p className="text-ink-600">
        EIC chromatogram generation is not yet implemented in the web edition.
        Use the desktop app for full EIC support, or export labels and plot in
        Data Studio as an interim workflow.
      </p>
      <div className="mt-4 rounded-md border border-dashed border-ink-200 bg-ink-50/50 p-6 text-center text-sm text-ink-500">
        Coming soon
      </div>
    </Modal>
  );
}

function GraphSettingsDialog({
  settings,
  onChange,
  onSetDefault,
  onReset,
  onClose,
}: {
  settings: GraphSettings;
  onChange: (updater: (prev: GraphSettings) => GraphSettings) => void;
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

  const section = (id: GraphId, label: string) => {
    const s = settings[id];
    const labelsAvailable = id === "spectrum" || id === "uv";
    const labelControlsTitle = id === "uv" ? "UV labels" : "Peak labels";
    return (
      <section className="rounded-lg border border-ink-200 bg-white p-4" key={id}>
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
            className="rounded-md border border-ink-200 bg-white px-3 py-1.5 text-sm text-ink-700 hover:bg-ink-100"
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
          className="h-9 w-12 rounded border border-ink-200 bg-white p-1"
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
    <div className="rounded-md border border-ink-200 bg-white p-3">
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
          className="rounded-md border border-ink-200 bg-white px-2 text-xs text-ink-700 hover:bg-ink-100 disabled:cursor-not-allowed disabled:opacity-60"
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
            className="rounded-md border border-ink-200 bg-white px-3 py-1.5 text-sm text-ink-700 hover:bg-ink-100"
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
              ? "Positive mode: +H adduct mass with optional +Na/+K."
              : "Negative mode: -H adduct mass with optional +Cl/+HCOO/+Ac."}
          </div>
        )}
        <GroupBox title="Monomers">
          <div className="rounded-md border border-ink-200 bg-ink-50/60 px-3 py-2 text-xs text-ink-600">
            Using: {selectedSummary || "no monomers selected"}
          </div>
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
            label="Noncovalent dimers (2M-H)"
            checked={shared.cluster}
            onChange={(cluster) => patchShared({ cluster })}
          />
        </GroupBox>
      </div>
    </Modal>
  );
}
