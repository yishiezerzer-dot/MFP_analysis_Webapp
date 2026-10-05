import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, FlaskConical, FolderOpen, Palette, Spline, Wand2, X } from "lucide-react";
import { ChartCardTitle, ICON_PROPS, ToolbarButton } from "../components/common/ChartCardParts";
import { SideRail } from "../components/common/SideRail";
import { useContainerSize } from "../lcms/viewShared";
import Plot from "react-plotly.js";
import Plotly from "plotly.js-dist-min";
import type { Data, Layout } from "plotly.js";
import clsx from "clsx";
import {
  api,
  FTIRAssignment,
  FTIRBaseline,
  FTIRFitResponse,
  FTIRIntegrationResponse,
  FTIRLibraryCategories,
  FTIRMatchResponse,
  FTIRReferenceHit,
  FTIRNormalize,
  FTIRPeak,
  FTIRPeaksRequest,
  FTIRPreprocessOptions,
  FTIRSessionSummary,
  FTIRSubtractResponse,
  FTIRSpectrumResponse,
  FTIRYMode,
} from "../api";
import { PageHeaderContent, usePageHeader } from "../layout/PageHeader";
import { HelpOpenButton } from "../help/HelpShell";
import { exportColorMeta, themeTraceColor, usePlotlyTheme } from "../theme/ThemeProvider";
import { AlertBanner } from "../components/AlertBanner";
import { PaperFigureExportToolbar } from "../components/PaperFigureExportToolbar";
import { useWorkspace } from "../context/WorkspaceContext";
import { useRegisterFileIngest } from "../context/FileIngestionContext";
import { useUndoRedo } from "../hooks/useUndoRedo";
import { ExperimentTagEditor } from "../components/ExperimentTagEditor";
import { TabEmptyState } from "../components/common/TabEmptyState";
import { ExampleTips } from "../components/ExampleData";
import { Hint } from "../components/Hint";
import { useRevealPanel } from "../help/reveal";
import { useOpenFromUrl } from "../hooks/useOpenFromUrl";
import { FTIR_PRESETS } from "../utils/ftirPresets";
import { useViewRequest } from "../hooks/useViewRequest";
import { useWorkflow } from "../workflows/WorkflowProvider";
import type { FtirPeaksRequest } from "../workflows/ftirPeaks";
import {
  exportPlotlyPublicationImage,
  PublicationExportFormat,
  PublicationExportSettings,
  publicationFilenameSuffix,
  sanitizeFilenamePart,
} from "../utils/publicationPlotExport";
import { FTIRInspectorPanel, type FTIRInspectorTab } from "../components/ftir/FTIRInspectorPanel";
import { FTIRCanvasToolbar } from "../components/ftir/FTIRCanvasToolbar";

// --- types local to this view ---

interface PeakPickOptions {
  min_prominence: number;
  min_height: number | null;
  min_distance_cm1: number;
  top_n: number;
  second_derivative: boolean;
  assign: boolean;
  assign_top_n: number;
  assign_min_score: number;
}

const DEFAULT_PRE: FTIRPreprocessOptions = {
  mode: "absorbance",
  smoothing_window: 0,
  poly_order: 2,
  baseline: "airpls",
  normalize: "none",
  baseline_lambda: 100000,
  baseline_p: 0.01,
  mask_atmospheric: false,
  atr_correction: false,
  atr_n_crystal: 1.5,
};

const DEFAULT_PEAK: PeakPickOptions = {
  min_prominence: 0.01,
  min_height: null,
  min_distance_cm1: 8.0,
  top_n: 15,
  second_derivative: false,
  assign: true,
  assign_top_n: 3,
  assign_min_score: 35.0,
};

type PeakEditMode = "none" | "add" | "remove";

interface ManualPeakEdits {
  added: FTIRPeak[];
  removed: number[];
}

type PlotFrameMode = "none" | "half" | "full";

interface GraphSettings {
  lineWidth: number;
  frame: PlotFrameMode;
  showTicks: boolean;
  showGrid: boolean;
  showScaleBars?: boolean;
  showGroupRegions?: boolean;
  overlayMode?: "overlay" | "offset" | "stacked";
  peakLabelColor: string;
  peakLabelSize: number;
  axisTitleSize: number;
  axisTickSize: number;
  traceColors: Record<string, string>;
}

interface FTIRLabelEdit {
  text?: string;
  bandId?: string | null;
  hidden?: boolean;
  ax?: number;
  ay?: number;
}

type FTIRLabelEdits = Record<string, FTIRLabelEdit>;

interface FTIRAssignmentConstraints {
  excluded_categories: string[];
  excluded_subcategories: string[];
  ambiguity_ratio: number;
}

const DEFAULT_ASSIGNMENT_CONSTRAINTS: FTIRAssignmentConstraints = {
  excluded_categories: [],
  excluded_subcategories: [],
  ambiguity_ratio: 1.3,
};

interface FTIRBandRegion {
  lo: number;
  hi: number;
}

interface FTIRQuantState {
  integrationRegion: FTIRBandRegion;
  integrationBaseline: "linear" | "horizontal" | "tangent";
  subtractSid: string;
  subtractK: number;
  subtractUseRegion: boolean;
  subtractRegion: FTIRBandRegion;
  matchRegion: FTIRBandRegion;
  matchDerivativeOrder: 0 | 1 | 2;
  matchTopN: number;
  fitRegion: FTIRBandRegion;
  fitComponents: number;
  fitProfile: "gauss" | "lorentz" | "voigt";
}

const DEFAULT_QUANT_STATE: FTIRQuantState = {
  integrationRegion: { lo: 1700, hi: 1750 },
  integrationBaseline: "linear",
  subtractSid: "",
  subtractK: 1,
  subtractUseRegion: false,
  subtractRegion: { lo: 1000, hi: 1800 },
  matchRegion: { lo: 650, hi: 1800 },
  matchDerivativeOrder: 1,
  matchTopN: 8,
  fitRegion: { lo: 1600, hi: 1750 },
  fitComponents: 2,
  fitProfile: "gauss",
};

const DEFAULT_GRAPH_SETTINGS: GraphSettings = {
  lineWidth: 1.4,
  frame: "half",
  showTicks: true,
  showGrid: true,
  showGroupRegions: false,
  overlayMode: "overlay",
  peakLabelColor: "#dc2626",
  peakLabelSize: 10,
  axisTitleSize: 13,
  axisTickSize: 12,
  traceColors: {},
};

type FTIRControlPanelKey = "preprocess" | "overlay" | "peaks" | "assignments" | "quant";

type FTIRControlPanels = Record<FTIRControlPanelKey, boolean>;

const DEFAULT_CONTROL_PANELS: FTIRControlPanels = {
  preprocess: false,
  overlay: false,
  peaks: false,
  assignments: false,
  quant: false,
};

const FTIR_STORAGE_PREFIX = "mfp.ftir";

interface FTIRWorkspaceEnvelope {
  version: 1;
  module: "FTIR";
  createdAt: string;
  sessions: Array<{
    session_id: string;
    display_name: string;
    path?: string;
  }>;
  activeSessionId: string | null;
  viewState: {
    preprocess: FTIRPreprocessOptions;
    peakPick: PeakPickOptions;
    overlayEnabled: boolean;
    overlaySessionIds: string[];
    graphSettings: GraphSettings;
    assignmentConstraints?: FTIRAssignmentConstraints;
    quantState?: FTIRQuantState;
  };
  analysisState: {
    peaks: FTIRPeak[];
    assignments: FTIRAssignment[] | null;
    assignmentsBySession?: Record<string, FTIRAssignment[] | null>;
    overlayPeaksBySession?: Record<string, FTIRPeak[]>;
    pickAcrossOverlay?: boolean;
    labelEdits?: FTIRLabelEdits;
    manualPeakEdits?: Record<string, ManualPeakEdits>;
  };
}

interface FTIROverlaySpectrum {
  session_id: string;
  display_name: string;
  spectrum: FTIRSpectrumResponse;
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

function safeFilename(name: string): string {
  return name.trim().replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "_") || "ftir";
}

function formatJcampNumber(value: number): string {
  return Number.isFinite(value) ? Number(value).toPrecision(8) : "0";
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] ?? ch);
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

function peakLabelKey(sessionId: string, wn: number): string {
  return `${sessionId}:${wn.toFixed(3)}`;
}

function parsePeakLabelKey(key: string): { sessionId: string; wn: number } | null {
  const splitAt = key.lastIndexOf(":");
  if (splitAt <= 0) return null;
  const wn = Number(key.slice(splitAt + 1));
  if (!Number.isFinite(wn)) return null;
  return { sessionId: key.slice(0, splitAt), wn };
}

function findAssignment(assignments: FTIRAssignment[] | null | undefined, wn: number): FTIRAssignment | undefined {
  return assignments?.find((item) => Math.abs(item.wn - wn) < 0.01);
}

function topAssignmentLabel(assignments: FTIRAssignment[] | null | undefined, wn: number): string | null {
  return findAssignment(assignments, wn)?.candidates?.[0]?.label ?? null;
}

function resolvedPeakLabel(
  sessionId: string,
  peak: FTIRPeak,
  assignments: FTIRAssignment[] | null | undefined,
  edits: FTIRLabelEdits,
): string | null {
  const edit = edits[peakLabelKey(sessionId, peak.wn)];
  if (edit?.hidden) return null;
  const override = edit?.text?.trim();
  if (override) return override;
  const selected = edit?.bandId
    ? findAssignment(assignments, peak.wn)?.candidates?.find((candidate) => (candidate.band_id ?? candidate.id) === edit.bandId)
    : null;
  return selected?.label || topAssignmentLabel(assignments, peak.wn) || peak.wn.toFixed(0);
}

function manualPeakTolerance(wn: number): number {
  return Math.max(2, Math.abs(wn) * 0.0008);
}

function applyManualPeakEdits(peaks: FTIRPeak[], edits: ManualPeakEdits | undefined): FTIRPeak[] {
  if (!edits) return peaks;
  const removed = edits.removed ?? [];
  const kept = peaks.filter((peak) => !removed.some((wn) => Math.abs(wn - peak.wn) <= manualPeakTolerance(peak.wn)));
  return [...kept, ...(edits.added ?? [])].sort((a, b) => a.wn - b.wn);
}

function makeManualPeak(wn: number, y: number): FTIRPeak {
  return {
    wn: Number(wn),
    y: Number(y),
    prominence: 0,
    width_cm1: null,
    left_base_wn: null,
    right_base_wn: null,
  };
}

function mergeAddedPeak(peaks: FTIRPeak[], peak: FTIRPeak): FTIRPeak[] {
  return [...peaks.filter((item) => Math.abs(item.wn - peak.wn) > manualPeakTolerance(peak.wn)), peak].sort(
    (a, b) => a.wn - b.wn,
  );
}

function mergeRemovedPeak(values: number[], wn: number): number[] {
  return [...values.filter((item) => Math.abs(item - wn) > manualPeakTolerance(wn)), wn].sort((a, b) => a - b);
}

// Processing, peak picking and the bond library work in absorbance; a transmittance spectrum is
// shown (and exported) as %T again: T = 100·10^(−A) of the processed absorbance.
export function displayY(value: number, mode: FTIRYMode): number {
  return mode === "transmittance" ? 100 * 10 ** -value : value;
}

export function fromDisplayY(value: number, mode: FTIRYMode): number {
  return mode === "transmittance" ? -Math.log10(Math.max(value, 0.01) / 100) : value;
}

function estimateYOffset(spectra: FTIRSpectrumResponse[]): number {
  const ranges = spectra.map((s) => {
    const min = Math.min(...s.y);
    const max = Math.max(...s.y);
    return Number.isFinite(max - min) ? max - min : 0;
  });
  return Math.max(...ranges, 1) * 1.15;
}

function buildStackedAxes(
  mode: GraphSettings["overlayMode"],
  count: number,
  color: string,
  showGrid: boolean,
  axisTitleSize: number,
  axisTickSize: number,
): Partial<Layout> {
  if (mode !== "stacked" || count <= 0) return {};
  const total = count + 1;
  const axes: Partial<Layout> = {};
  for (let i = 0; i < total; i += 1) {
    const start = i / total;
    const end = (i + 1) / total - 0.02;
    const key = i === 0 ? "yaxis" : (`yaxis${i + 1}` as keyof Layout);
    (axes as Record<string, unknown>)[key] = {
      domain: [start, Math.max(start + 0.05, end)],
      zeroline: false,
      showgrid: showGrid,
      linecolor: color,
      tickfont: { size: axisTickSize },
      automargin: true,
      title: i === 0
        ? {
            text: "Active",
            font: { size: axisTitleSize },
            standoff: Math.max(8, Math.round(axisTickSize * 0.8)),
          }
        : undefined,
    };
  }
  return axes;
}

function readStoredValue<T>(key: string, fallback: T, reconcile?: (value: Partial<T>) => T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<T>;
    return reconcile ? reconcile(parsed) : (parsed as T);
  } catch {
    return fallback;
  }
}

function useStoredState<T>(key: string, fallback: T, reconcile?: (value: Partial<T>) => T) {
  const [value, setValue] = useState<T>(() => readStoredValue(key, fallback, reconcile));

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Best-effort persistence; the controls still work if storage is unavailable.
    }
  }, [key, value]);

  return [value, setValue] as const;
}

function mergeAssignmentConstraints(value: Partial<FTIRAssignmentConstraints>): FTIRAssignmentConstraints {
  return {
    ...DEFAULT_ASSIGNMENT_CONSTRAINTS,
    ...value,
    excluded_categories: Array.isArray(value.excluded_categories) ? value.excluded_categories : [],
    excluded_subcategories: Array.isArray(value.excluded_subcategories) ? value.excluded_subcategories : [],
  };
}

function mergeQuantState(value: Partial<FTIRQuantState>): FTIRQuantState {
  return {
    ...DEFAULT_QUANT_STATE,
    ...value,
    integrationRegion: { ...DEFAULT_QUANT_STATE.integrationRegion, ...(value.integrationRegion ?? {}) },
    subtractRegion: { ...DEFAULT_QUANT_STATE.subtractRegion, ...(value.subtractRegion ?? {}) },
    matchRegion: { ...DEFAULT_QUANT_STATE.matchRegion, ...(value.matchRegion ?? {}) },
    fitRegion: { ...DEFAULT_QUANT_STATE.fitRegion, ...(value.fitRegion ?? {}) },
  };
}

export function FTIRView() {
  const { activeWorkspaceId } = useWorkspace();
  const [sessions, setSessions] = useState<FTIRSessionSummary[]>([]);
  // Set once the saved workspace has chosen the active spectrum, so later choices are not overridden.
  const [sessionsRestored, setSessionsRestored] = useState(false);
  const [activeSid, setActiveSid] = useStoredState<string | null>(
    `${FTIR_STORAGE_PREFIX}.activeSessionId`,
    null,
    (value) => (typeof value === "string" ? value : null),
  );
  const [storedPre, setStoredPre] = useStoredState<FTIRPreprocessOptions>(
    `${FTIR_STORAGE_PREFIX}.preprocess`,
    DEFAULT_PRE,
    (value) => {
      const merged = { ...DEFAULT_PRE, ...value };
      return (merged.normalize as string) === "msc" ? { ...merged, normalize: "none" } : merged;
    },
  );
  const {
    state: pre,
    set: setPre,
    undo: undoPre,
    redo: redoPre,
    canUndo: canUndoPre,
    canRedo: canRedoPre,
  } = useUndoRedo<FTIRPreprocessOptions>(storedPre, { enableKeyShortcuts: true });

  useEffect(() => {
    setStoredPre(pre);
  }, [pre, setStoredPre]);
  const [storedPk, setStoredPk] = useStoredState<PeakPickOptions>(
    `${FTIR_STORAGE_PREFIX}.peakPick`,
    DEFAULT_PEAK,
    (value) => ({ ...DEFAULT_PEAK, ...value }),
  );
  const {
    state: pk,
    set: setPk,
    undo: undoPk,
    redo: redoPk,
    canUndo: canUndoPk,
    canRedo: canRedoPk,
  } = useUndoRedo<PeakPickOptions>(storedPk);

  useEffect(() => {
    setStoredPk(pk);
  }, [pk, setStoredPk]);
  const [spectrum, setSpectrum] = useState<FTIRSpectrumResponse | null>(null);
  const [showSecondDerivative, setShowSecondDerivative] = useState<boolean>(false);
  const [showBaselineCurve, setShowBaselineCurve] = useState<boolean>(false);
  const [overlayEnabled, setOverlayEnabled] = useStoredState<boolean>(`${FTIR_STORAGE_PREFIX}.overlayEnabled`, false);
  const [overlaySessionIds, setOverlaySessionIds] = useStoredState<string[]>(
    `${FTIR_STORAGE_PREFIX}.overlaySessionIds`,
    [],
    (value) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []),
  );
  const [overlaySpectra, setOverlaySpectra] = useState<FTIROverlaySpectrum[]>([]);
  const [peaks, setPeaks] = useState<FTIRPeak[]>([]);
  const [assignmentsBySession, setAssignmentsBySession] = useState<Record<string, FTIRAssignment[] | null>>({});
  const [overlayPeaksBySession, setOverlayPeaksBySession] = useState<Record<string, FTIRPeak[]>>({});
  const [manualPeakEdits, setManualPeakEdits] = useStoredState<Record<string, ManualPeakEdits>>(
    `${FTIR_STORAGE_PREFIX}.manualPeakEdits`,
    {},
    (value) => (value && typeof value === "object" ? value as Record<string, ManualPeakEdits> : {}),
  );
  const [peakEditMode, setPeakEditMode] = useState<PeakEditMode>("none");
  const [activePeakTableSid, setActivePeakTableSid] = useState<string | null>(null);
  const [labelEdits, setLabelEdits] = useStoredState<FTIRLabelEdits>(
    `${FTIR_STORAGE_PREFIX}.labelEdits`,
    {},
    (value) => (value && typeof value === "object" ? value as FTIRLabelEdits : {}),
  );
  const [graphSettings, setGraphSettings] = useStoredState<GraphSettings>(
    `${FTIR_STORAGE_PREFIX}.graphSettings`,
    DEFAULT_GRAPH_SETTINGS,
    (value) => ({
      ...DEFAULT_GRAPH_SETTINGS,
      ...value,
      peakLabelSize: Math.max(6, Math.min(28, Number(value.peakLabelSize) || DEFAULT_GRAPH_SETTINGS.peakLabelSize)),
      axisTitleSize: Math.max(8, Math.min(28, Number(value.axisTitleSize) || DEFAULT_GRAPH_SETTINGS.axisTitleSize)),
      axisTickSize: Math.max(8, Math.min(24, Number(value.axisTickSize) || DEFAULT_GRAPH_SETTINGS.axisTickSize)),
      traceColors: value.traceColors ?? {},
    }),
  );
  const [assignments, setAssignments] = useState<FTIRAssignment[] | null>(null);
  const [pickAcrossOverlay, setPickAcrossOverlay] = useStoredState<boolean>(`${FTIR_STORAGE_PREFIX}.pickAcrossOverlay`, false);
  const [libMeta, setLibMeta] = useState<{ version: string; n_entries: number } | null>(null);
  const [libraryCategories, setLibraryCategories] = useState<FTIRLibraryCategories | null>(null);
  const [assignmentConstraints, setAssignmentConstraints] = useStoredState<FTIRAssignmentConstraints>(
    `${FTIR_STORAGE_PREFIX}.assignmentConstraints`,
    DEFAULT_ASSIGNMENT_CONSTRAINTS,
    mergeAssignmentConstraints,
  );
  const [quantState, setQuantState] = useStoredState<FTIRQuantState>(
    `${FTIR_STORAGE_PREFIX}.quantState`,
    DEFAULT_QUANT_STATE,
    mergeQuantState,
  );
  const [controlPanels, setControlPanels] = useStoredState<FTIRControlPanels>(
    `${FTIR_STORAGE_PREFIX}.controlPanels`,
    DEFAULT_CONTROL_PANELS,
    (value) => ({ ...DEFAULT_CONTROL_PANELS, ...value }),
  );
  const [inspectorTab, setInspectorTab] = useState<FTIRInspectorTab>("preprocess");
  useOpenFromUrl(
    sessions.map((s) => s.session_id),
    (sid) => setActiveSid(sid),
  );
  useRevealPanel({
    "ftir.inspector.preprocess": () => setInspectorTab("preprocess"),
    "ftir.inspector.peaks": () => setInspectorTab("peaks"),
    "ftir.inspector.quant": () => setInspectorTab("quant"),
    "ftir.inspector.overlay": () => setInspectorTab("overlay"),
  });
  const [integrationResult, setIntegrationResult] = useState<FTIRIntegrationResponse | null>(null);
  const [differenceSpectrum, setDifferenceSpectrum] = useState<FTIRSubtractResponse | null>(null);
  const [matchResult, setMatchResult] = useState<FTIRMatchResponse | null>(null);
  const [selectedReference, setSelectedReference] = useState<FTIRReferenceHit | null>(null);
  const [fitResult, setFitResult] = useState<FTIRFitResponse | null>(null);
  const [quantBusy, setQuantBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const workspaceFileRef = useRef<HTMLInputElement>(null);


  const active = useMemo(
    () => sessions.find((s) => s.session_id === activeSid) ?? null,
    [sessions, activeSid],
  );

  // The y-mode is a property of the file (detected on upload); apply it once when a session
  // becomes active, leaving the user free to override it afterwards.
  const modeSyncedForSidRef = useRef<string | null>(null);
  useEffect(() => {
    if (!active || modeSyncedForSidRef.current === active.session_id) return;
    modeSyncedForSidRef.current = active.session_id;
    if (active.y_mode && active.y_mode !== pre.mode) setPre({ ...pre, mode: active.y_mode });
  }, [active, pre, setPre]);

  useEffect(() => {
    let cancelled = false;
    api.ftir
      .list()
      .then(async (list) => {
        if (cancelled) return;
        setSessions(list);

        let restoredSid: string | null = null;
        try {
          const res = await api.workspaces.getState(activeWorkspaceId, "ftir");
          if (res?.state?.activeSid && list.some((s) => s.session_id === res.state.activeSid)) {
            restoredSid = res.state.activeSid;
          }
        } catch {
          // ignore
        }

        setActiveSid((current) => {
          if (restoredSid) return restoredSid;
          return current && list.some((session) => session.session_id === current)
            ? current
            : list[0]?.session_id ?? null;
        });
        setSessionsRestored(true);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    api.ftir.library().then((m) => { if (!cancelled) setLibMeta(m); }).catch(() => undefined);
    api.ftir.libraryCategories().then((c) => { if (!cancelled) setLibraryCategories(c); }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [activeWorkspaceId]);

  useEffect(() => {
    if (!activeWorkspaceId) return;
    const timer = window.setTimeout(() => {
      api.workspaces
        .saveState(activeWorkspaceId, "ftir", {
          activeSid,
          mode: pre.mode,
        })
        .catch(() => undefined);
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [activeWorkspaceId, activeSid, pre.mode]);

  // Retry library categories if the initial fetch failed (e.g. backend not ready on mount).
  useEffect(() => {
    if (libraryCategories !== null) return;
    api.ftir.libraryCategories().then(setLibraryCategories).catch(() => undefined);
  }, [sessions, libraryCategories]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)) return;
      // Leave browser shortcuts (Ctrl+F find, Ctrl+P print, …) alone.
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key.toLowerCase() === "p") void runPick();
      if (event.key.toLowerCase() === "o") setOverlayEnabled((v) => !v);
      if (event.key.toLowerCase() === "f") setGraphSettings((g) => ({ ...g, showGroupRegions: !g.showGroupRegions }));
      if (event.key === "Escape") setPeakEditMode("none");
      if (event.key === "[") cycleSession(-1);
      if (event.key === "]") cycleSession(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    setOverlaySessionIds((prev) => {
      const available = new Set(sessions.map((session) => session.session_id));
      const kept = prev.filter((sid) => available.has(sid));
      if (kept.length > 0 || sessions.length === 0) return kept;
      return sessions.map((session) => session.session_id);
    });
  }, [sessions]);

  useEffect(() => {
    setQuantState((prev) => {
      if (!prev.subtractSid || sessions.some((session) => session.session_id === prev.subtractSid)) return prev;
      return { ...prev, subtractSid: "" };
    });
  }, [sessions]);

  // Refetch spectrum whenever session or preprocessing changes.
  useEffect(() => {
    if (!activeSid || !sessions.some((session) => session.session_id === activeSid)) {
      setSpectrum(null);
      setPeaks([]);
      setAssignments(null);
      return;
    }
    // Ignore responses from superseded requests: when the y-mode switches (e.g. on load, a file is
    // detected as absorbance), an older transmittance response arriving last would otherwise be
    // drawn under the absorbance label (inverted bands).
    let cancelled = false;
    setBusy(true);
    api.ftir
      .spectrum(activeSid, {
        ...pre,
        max_points: 4000,
        include_second_derivative: showSecondDerivative,
        include_baseline: showBaselineCurve,
      })
      .then((next) => {
        if (!cancelled) setSpectrum(next);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeSid, pre, sessions, showSecondDerivative, showBaselineCurve]);

  useEffect(() => {
    if (!activeSid) return;
    setPeaks(overlayPeaksBySession[activeSid] ?? []);
    setAssignments(assignmentsBySession[activeSid] ?? null);
  }, [activeSid, overlayPeaksBySession, assignmentsBySession]);

  useEffect(() => {
    setActivePeakTableSid(activeSid);
  }, [activeSid]);

  useEffect(() => {
    setActivePeakTableSid((sid) => {
      if (sid && sessions.some((session) => session.session_id === sid)) return sid;
      return activeSid;
    });
  }, [activeSid, sessions]);

  useEffect(() => {
    setManualPeakEdits((prev) => {
      const available = new Set(sessions.map((session) => session.session_id));
      const next: Record<string, ManualPeakEdits> = {};
      for (const [sid, edits] of Object.entries(prev)) {
        if (available.has(sid)) next[sid] = edits;
      }
      return next;
    });
  }, [sessions]);

  useEffect(() => {
    if (!overlayEnabled || overlaySessionIds.length <= 1) {
      setOverlaySpectra([]);
      return;
    }
    let cancelled = false;
    Promise.all(
      overlaySessionIds.map(async (sid) => {
        const session = sessions.find((item) => item.session_id === sid);
        if (!session) return null;
        const spec = await api.ftir.spectrum(sid, { ...pre, max_points: 4000 });
        return {
          session_id: sid,
          display_name: session.display_name,
          spectrum: spec,
        };
      }),
    )
      .then((items) => {
        if (!cancelled) setOverlaySpectra(items.filter(Boolean) as FTIROverlaySpectrum[]);
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [overlayEnabled, overlaySessionIds, pre, sessions]);

  const addLoadedSessions = (loaded: FTIRSessionSummary[]) => {
    if (loaded.length === 0) return;
    // An example that was already open comes back as its existing session.
    setSessions((prev) => [...prev, ...loaded.filter((s) => !prev.some((p) => p.session_id === s.session_id))]);
    setActiveSid(loaded[loaded.length - 1].session_id);
    setPeaks([]);
    setAssignments(null);
  };

  const openExample = async (sessionIds: string[]) => {
    addLoadedSessions(await Promise.all(sessionIds.map((sid) => api.ftir.get(sid))));
  };

  const { startWorkflow } = useWorkflow();
  const guide = () => startWorkflow({ id: "ftir-peaks", initial: activeSid ? { source: "spectrum", sid: activeSid } : undefined });

  // "Identify peaks" workflow: apply the settings now, pick peaks once they are active.
  const [pendingPick, setPendingPick] = useState<string | null>(null);
  useViewRequest<FtirPeaksRequest>("ftir", sessionsRestored, async (request) => {
    if (!sessions.some((s) => s.session_id === request.sid)) {
      try {
        addLoadedSessions([await api.ftir.get(request.sid)]);
      } catch (err) {
        setError(String(err));
        return;
      }
    }
    setActiveSid(request.sid);
    setPre({ ...pre, ...request.preprocess });
    setPk({ ...pk, ...request.peaks, assign: true });
    setAssignmentConstraints((prev) => ({ ...prev, excluded_categories: request.exclude }));
    setInspectorTab("peaks");
    setPendingPick(request.sid);
  });

  const onUpload = async (files: File[]) => {
    if (files.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const uploaded: FTIRSessionSummary[] = [];
      for (const file of files) {
        const s = await api.ftir.upload(file);
        uploaded.push(s);
      }
      addLoadedSessions(uploaded);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  useRegisterFileIngest("/ftir", onUpload);

  const onRemove = async (sid: string) => {
    await api.ftir.remove(sid).catch((e) => setError(String(e)));
    setSessions((prev) => prev.filter((s) => s.session_id !== sid));
    setManualPeakEdits((prev) => {
      const next = { ...prev };
      delete next[sid];
      return next;
    });
    setAssignmentsBySession((prev) => {
      const next = { ...prev };
      delete next[sid];
      return next;
    });
    setOverlayPeaksBySession((prev) => {
      const next = { ...prev };
      delete next[sid];
      return next;
    });
    setActivePeakTableSid((current) => (current === sid ? activeSid : current));
    if (activeSid === sid) {
      setActiveSid(null);
      setSpectrum(null);
      setPeaks([]);
      setAssignments(null);
    }
  };

  const runPick = useCallback(async () => {
    if (!activeSid) return;
    setPicking(true);
    setError(null);
    try {
      const body: FTIRPeaksRequest = { ...pre, ...pk, ...assignmentConstraints };
      const targetIds = pickAcrossOverlay && overlayEnabled
        ? Array.from(new Set(overlaySessionIds.filter((sid) => sessions.some((s) => s.session_id === sid))))
        : [activeSid];
      if (!targetIds.includes(activeSid)) targetIds.unshift(activeSid);
      const results = await Promise.all(
        targetIds.map(async (sid) => ({
          sid,
          result: await api.ftir.peaks(sid, body),
        })),
      );
      const bySession: Record<string, FTIRPeak[]> = {};
      const assignmentMap: Record<string, FTIRAssignment[] | null> = {};
      for (const item of results) {
        bySession[item.sid] = applyManualPeakEdits(item.result.peaks, manualPeakEdits[item.sid]);
      }
      for (const item of results) assignmentMap[item.sid] = item.result.assignments ?? null;
      setAssignmentsBySession((prev) => ({ ...prev, ...assignmentMap }));
      setOverlayPeaksBySession((prev) => ({ ...prev, ...bySession }));
      const activeResult = results.find((item) => item.sid === activeSid)?.result;
      setPeaks(activeResult ? applyManualPeakEdits(activeResult.peaks, manualPeakEdits[activeSid]) : []);
      setAssignments(activeResult?.assignments ?? null);
    } catch (err) {
      setError(String(err));
    } finally {
      setPicking(false);
    }
  }, [activeSid, pre, pk, assignmentConstraints, pickAcrossOverlay, overlayEnabled, overlaySessionIds, sessions, manualPeakEdits]);

  useEffect(() => {
    if (!pendingPick || activeSid !== pendingPick || !active) return;
    // Wait for the file's absorbance/transmittance mode to be applied.
    if (active.y_mode && pre.mode !== active.y_mode) return;
    setPendingPick(null);
    void runPick();
  }, [pendingPick, activeSid, active, pre.mode, runPick]);

  const updateLabelEdit = useCallback((key: string, patch: FTIRLabelEdit) => {
    setLabelEdits((prev) => {
      const nextEdit = { ...(prev[key] ?? {}), ...patch };
      if ("text" in patch || "bandId" in patch || "hidden" in patch) {
        const parsed = parsePeakLabelKey(key);
        if (parsed) {
          void api.ftir
            .updatePeakLabel(parsed.sessionId, parsed.wn, {
              band_id: nextEdit.bandId ?? null,
              custom_text: nextEdit.text ?? null,
              hidden: nextEdit.hidden ?? false,
            })
            .catch(() => undefined);
        }
      }
      return {
        ...prev,
        [key]: nextEdit,
      };
    });
  }, []);

  const runIntegrate = useCallback(async () => {
    if (!activeSid) return;
    setQuantBusy(true);
    setError(null);
    try {
      const result = await api.ftir.integrate(activeSid, {
        ...pre,
        max_points: 4000,
        region: [quantState.integrationRegion.lo, quantState.integrationRegion.hi],
        baseline_mode: quantState.integrationBaseline,
      });
      setIntegrationResult(result);
    } catch (err) {
      setError(String(err));
    } finally {
      setQuantBusy(false);
    }
  }, [activeSid, pre, quantState.integrationBaseline, quantState.integrationRegion.hi, quantState.integrationRegion.lo]);

  const runSubtract = useCallback(async () => {
    if (!activeSid) return;
    const sidB = quantState.subtractSid || sessions.find((session) => session.session_id !== activeSid)?.session_id;
    if (!sidB) return;
    setQuantBusy(true);
    setError(null);
    try {
      const result = await api.ftir.subtract(activeSid, {
        ...pre,
        max_points: 4000,
        sid_b: sidB,
        k: quantState.subtractK,
        region_minimize: quantState.subtractUseRegion
          ? [quantState.subtractRegion.lo, quantState.subtractRegion.hi]
          : null,
      });
      setDifferenceSpectrum(result);
      setQuantState((prev) => ({ ...prev, subtractSid: sidB, subtractK: result.k }));
    } catch (err) {
      setError(String(err));
    } finally {
      setQuantBusy(false);
    }
  }, [activeSid, pre, quantState.subtractK, quantState.subtractRegion.hi, quantState.subtractRegion.lo, quantState.subtractSid, quantState.subtractUseRegion, sessions]);

  const runMatch = useCallback(async () => {
    if (!activeSid) return;
    setQuantBusy(true);
    setError(null);
    try {
      const result = await api.ftir.match(activeSid, {
        ...pre,
        max_points: 4000,
        region: [quantState.matchRegion.lo, quantState.matchRegion.hi],
        derivative_order: quantState.matchDerivativeOrder,
        top_n: quantState.matchTopN,
      });
      setMatchResult(result);
      setSelectedReference(result.hits[0] ?? null);
    } catch (err) {
      setError(String(err));
    } finally {
      setQuantBusy(false);
    }
  }, [activeSid, pre, quantState.matchDerivativeOrder, quantState.matchRegion.hi, quantState.matchRegion.lo, quantState.matchTopN]);

  const runFit = useCallback(async () => {
    if (!activeSid) return;
    setQuantBusy(true);
    setError(null);
    try {
      const result = await api.ftir.fit(activeSid, {
        ...pre,
        max_points: 4000,
        region: [quantState.fitRegion.lo, quantState.fitRegion.hi],
        n_components: quantState.fitComponents,
        profile: quantState.fitProfile,
      });
      setFitResult(result);
    } catch (err) {
      setError(String(err));
    } finally {
      setQuantBusy(false);
    }
  }, [activeSid, pre, quantState.fitComponents, quantState.fitProfile, quantState.fitRegion.hi, quantState.fitRegion.lo]);

  const handleChartPeakEdit = useCallback((wn: number, y: number) => {
    if (!activeSid || peakEditMode === "none") return;
    const peak = makeManualPeak(wn, y);
    setManualPeakEdits((prev) => {
      const current = prev[activeSid] ?? { added: [], removed: [] };
      const next: ManualPeakEdits =
        peakEditMode === "add"
          ? {
              added: mergeAddedPeak(current.added, peak),
              removed: current.removed.filter((item) => Math.abs(item - peak.wn) > manualPeakTolerance(peak.wn)),
            }
          : {
              added: current.added.filter((item) => Math.abs(item.wn - peak.wn) > manualPeakTolerance(peak.wn)),
              removed: mergeRemovedPeak(current.removed, peak.wn),
            };
      setPeaks((prevPeaks) => applyManualPeakEdits(prevPeaks, next));
      setOverlayPeaksBySession((prevMap) => ({
        ...prevMap,
        [activeSid]: applyManualPeakEdits(prevMap[activeSid] ?? peaks, next),
      }));
      return { ...prev, [activeSid]: next };
    });
  }, [activeSid, peakEditMode, peaks]);

  const clearManualPeaks = useCallback(() => {
    if (!activeSid) return;
    setManualPeakEdits((prev) => {
      const next = { ...prev };
      delete next[activeSid];
      return next;
    });
  }, [activeSid]);

  const cycleSession = useCallback((delta: number) => {
    setActiveSid((sid) => {
      if (sessions.length === 0) return sid;
      const current = Math.max(0, sessions.findIndex((session) => session.session_id === sid));
      const next = (current + delta + sessions.length) % sessions.length;
      return sessions[next]?.session_id ?? sid;
    });
  }, [sessions]);

  const saveWorkspace = () => {
    const workspace: FTIRWorkspaceEnvelope = {
      version: 1,
      module: "FTIR",
      createdAt: new Date().toISOString(),
      sessions: sessions.map((session) => ({
        session_id: session.session_id,
        display_name: session.display_name,
      })),
      activeSessionId: activeSid,
      viewState: {
        preprocess: pre,
        peakPick: pk,
        overlayEnabled,
        overlaySessionIds,
        graphSettings,
        assignmentConstraints,
        quantState,
      },
      analysisState: {
        peaks,
        assignments,
        assignmentsBySession,
        overlayPeaksBySession,
        pickAcrossOverlay,
        labelEdits,
        manualPeakEdits,
      },
    };
    downloadJson(workspace, "ftir.workspace.json");
  };

  const loadWorkspaceFile = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const workspace = await readJsonFile<FTIRWorkspaceEnvelope>(file);
      if (workspace.module !== "FTIR") {
        throw new Error("This is not an FTIR workspace file.");
      }
      const availableIds = new Set(sessions.map((session) => session.session_id));
      const missing = workspace.sessions.filter((session) => !availableIds.has(session.session_id));
      const loadedPre = { ...DEFAULT_PRE, ...(workspace.viewState.preprocess ?? {}) };
      setPre((loadedPre.normalize as string) === "msc" ? { ...loadedPre, normalize: "none" } : loadedPre);
      setPk({ ...DEFAULT_PEAK, ...(workspace.viewState.peakPick ?? {}) });
      setAssignmentConstraints({
        ...DEFAULT_ASSIGNMENT_CONSTRAINTS,
        ...(workspace.viewState.assignmentConstraints ?? {}),
        excluded_categories: workspace.viewState.assignmentConstraints?.excluded_categories ?? [],
        excluded_subcategories: workspace.viewState.assignmentConstraints?.excluded_subcategories ?? [],
      });
      setQuantState({ ...DEFAULT_QUANT_STATE, ...(workspace.viewState.quantState ?? {}) });
      setOverlayEnabled(Boolean(workspace.viewState.overlayEnabled));
      setOverlaySessionIds(
        (workspace.viewState.overlaySessionIds ?? []).filter((sid) => availableIds.has(sid)),
      );
      const loadedGraph = workspace.viewState.graphSettings;
      setGraphSettings({
        ...DEFAULT_GRAPH_SETTINGS,
        ...(loadedGraph ?? {}),
        showTicks: loadedGraph?.showTicks ?? loadedGraph?.showScaleBars ?? DEFAULT_GRAPH_SETTINGS.showTicks,
        showGrid: loadedGraph?.showGrid ?? loadedGraph?.showScaleBars ?? DEFAULT_GRAPH_SETTINGS.showGrid,
        traceColors: {
          ...(loadedGraph?.traceColors ?? {}),
        },
      });
      const loadedPeaks = workspace.analysisState.peaks ?? [];
      const loadedAssignments = workspace.analysisState.assignments ?? null;
      const loadedActiveSid = workspace.activeSessionId && availableIds.has(workspace.activeSessionId)
        ? workspace.activeSessionId
        : activeSid;
      setPeaks(loadedPeaks);
      setAssignments(loadedAssignments);
      setAssignmentsBySession({
        ...(loadedActiveSid && loadedAssignments ? { [loadedActiveSid]: loadedAssignments } : {}),
        ...(workspace.analysisState.assignmentsBySession ?? {}),
      });
      setOverlayPeaksBySession({
        ...(loadedActiveSid ? { [loadedActiveSid]: loadedPeaks } : {}),
        ...(workspace.analysisState.overlayPeaksBySession ?? {}),
      });
      setPickAcrossOverlay(Boolean(workspace.analysisState.pickAcrossOverlay));
      setLabelEdits(workspace.analysisState.labelEdits ?? {});
      setManualPeakEdits(workspace.analysisState.manualPeakEdits ?? {});
      if (workspace.activeSessionId && availableIds.has(workspace.activeSessionId)) {
        setActiveSid(workspace.activeSessionId);
      }
      setError(null);
      if (missing.length > 0) {
        setError(
          `Loaded workspace settings, but ${missing.length} source session(s) are not loaded in the current server.`,
        );
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const exportPeaksCSV = () => {
    if (peaks.length === 0) return;
    const assignmentsByWn = new Map<number, FTIRAssignment>();
    for (const assignment of assignments ?? []) assignmentsByWn.set(assignment.wn, assignment);
    const esc = (value: string | number | null | undefined) => {
      const text = value == null ? "" : String(value);
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const rows = [
      ["wn", "y", "prominence", "width_cm1", "top_assignment", "score", "selected_band_id", "plot_label", "label_hidden"],
      ...peaks.map((peak) => {
        const top = assignmentsByWn.get(peak.wn)?.candidates?.[0];
        const edit = activeSid ? labelEdits[peakLabelKey(activeSid, peak.wn)] : undefined;
        return [
          peak.wn,
          displayY(peak.y, pre.mode),
          peak.prominence,
          peak.width_cm1 ?? "",
          top?.label ?? "",
          top?.score ?? "",
          edit?.bandId ?? "",
          edit?.text ?? "",
          edit?.hidden ? "true" : "",
        ];
      }),
    ];
    const csv = rows.map((row) => row.map((value) => esc(value)).join(",")).join("\n");
    downloadBlob(
      new Blob([csv], { type: "text/csv" }),
      `${active?.display_name ?? "ftir"}.peaks.csv`,
    );
  };

  const exportJCAMP = () => {
    if (!spectrum || !active) return;
    const transmittance = pre.mode === "transmittance";
    const lines = [
      "##TITLE=" + active.display_name,
      "##JCAMP-DX=5.00",
      "##DATA TYPE=INFRARED SPECTRUM",
      "##ORIGIN=MFP Analysis App",
      "##XUNITS=1/CM",
      // Transmittance spectra are exported as they are shown, as a fraction (JCAMP convention).
      transmittance ? "##YUNITS=TRANSMITTANCE" : "##YUNITS=ABSORBANCE",
      `##FIRSTX=${spectrum.wn[0] ?? ""}`,
      `##LASTX=${spectrum.wn[spectrum.wn.length - 1] ?? ""}`,
      `##NPOINTS=${spectrum.wn.length}`,
      "##XYDATA=(X++(Y..Y))",
      ...spectrum.wn.map((wn, i) => {
        const y = spectrum.y[i] ?? 0;
        return `${formatJcampNumber(wn)} ${formatJcampNumber(transmittance ? displayY(y, "transmittance") / 100 : y)}`;
      }),
      "##END=",
    ];
    downloadBlob(new Blob([lines.join("\n")], { type: "chemical/x-jcamp-dx" }), `${safeFilename(active.display_name)}.jdx`);
  };

  const exportHTMLReport = () => {
    if (!active) return;
    const assignmentRows = peaks.slice(0, 200).map((peak) => {
      const top = assignments?.find((item) => Math.abs(item.wn - peak.wn) < 0.01)?.candidates?.[0];
      return `<tr><td>${peak.wn.toFixed(1)}</td><td>${formatNumber(displayY(peak.y, pre.mode))}</td><td>${formatNumber(peak.prominence)}</td><td>${escapeHtml(top?.label ?? "")}</td><td>${top?.score?.toFixed(0) ?? ""}</td></tr>`;
    }).join("");
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(active.display_name)} FTIR report</title><style>body{font-family:Arial,sans-serif;margin:32px;color:#111827}table{border-collapse:collapse;width:100%;font-size:12px}td,th{border:1px solid #d1d5db;padding:6px;text-align:left}h1{font-size:22px}.meta{color:#4b5563;font-size:13px}</style></head><body><h1>${escapeHtml(active.display_name)}</h1><p class="meta">Generated ${new Date().toLocaleString()} · ${peaks.length} peaks · mode ${pre.mode}</p><h2>Preprocessing</h2><p class="meta">baseline ${pre.baseline}, normalize ${pre.normalize}, smoothing ${pre.smoothing_window}</p><h2>Peak assignments</h2><table><thead><tr><th>cm^-1</th><th>${pre.mode === "transmittance" ? "%T" : "Y"}</th><th>Prominence</th><th>Top assignment</th><th>Score</th></tr></thead><tbody>${assignmentRows}</tbody></table></body></html>`;
    downloadBlob(new Blob([html], { type: "text/html" }), `${safeFilename(active.display_name)}.ftir-report.html`);
  };

  const peakTableSessions = useMemo(() => {
    if (!active) return [];
    const rows = [{ session_id: active.session_id, display_name: active.display_name }];
    for (const overlay of overlaySpectra) {
      if (overlay.session_id !== active.session_id && !rows.some((row) => row.session_id === overlay.session_id)) {
        rows.push({ session_id: overlay.session_id, display_name: overlay.display_name });
      }
    }
    return rows;
  }, [active, overlaySpectra]);

  const selectedPeakTableSid = useMemo(() => {
    if (activePeakTableSid && peakTableSessions.some((session) => session.session_id === activePeakTableSid)) {
      return activePeakTableSid;
    }
    return active?.session_id ?? null;
  }, [active?.session_id, activePeakTableSid, peakTableSessions]);

  const selectedPeakTableSession = useMemo(
    () => peakTableSessions.find((session) => session.session_id === selectedPeakTableSid) ?? null,
    [peakTableSessions, selectedPeakTableSid],
  );

  const selectedPeakTablePeaks = selectedPeakTableSid === active?.session_id
    ? peaks
    : selectedPeakTableSid
      ? overlayPeaksBySession[selectedPeakTableSid] ?? []
      : [];

  const hasAnyPeakTable = peakTableSessions.some((session) => {
    if (session.session_id === active?.session_id) return peaks.length > 0;
    return (overlayPeaksBySession[session.session_id] ?? []).length > 0;
  });

  usePageHeader(
    <PageHeaderContent
      title="FTIR"
      subtitle={
        <>
          Spectrum viewer · preprocess · peak pick · library assignment
          {libMeta ? ` · library v${libMeta.version} (${libMeta.n_entries} entries)` : ""}
        </>
      }
      actions={
        <>
          <HelpOpenButton />
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.txt,.tsv,.dx,.jdx,.spc"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = e.target.files ? Array.from(e.target.files) : [];
              if (files.length > 0) void onUpload(files);
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
          <Hint id="ftir.loadWorkspace" placement="bottom">
            <button
              className="rounded-md border border-ink-200 bg-surface px-3 py-2 text-sm text-ink-700 transition-colors hover:bg-ink-100"
              disabled={busy}
              onClick={() => workspaceFileRef.current?.click()}
            >
              Load workspace
            </button>
          </Hint>
          <Hint id="ftir.saveWorkspace" placement="bottom" extra={sessions.length === 0 ? "Open a spectrum first." : undefined}>
            <span>
              <button
                className="rounded-md border border-ink-200 bg-surface px-3 py-2 text-sm text-ink-700 transition-colors hover:bg-ink-100 disabled:cursor-not-allowed disabled:text-ink-500"
                disabled={busy || sessions.length === 0}
                onClick={saveWorkspace}
              >
                Save workspace
              </button>
            </span>
          </Hint>
          <Hint id="ftir.exportPeaks" placement="bottom" extra={peaks.length === 0 ? "Pick peaks first." : undefined}>
            <span>
              <button
                className="rounded-md border border-ink-200 bg-surface px-3 py-2 text-sm text-ink-700 transition-colors hover:bg-ink-100 disabled:cursor-not-allowed disabled:text-ink-500"
                disabled={busy || peaks.length === 0}
                onClick={exportPeaksCSV}
              >
                Export peaks CSV
              </button>
            </span>
          </Hint>
          <Hint id="ftir.exportJdx" placement="bottom" extra={!spectrum ? "Open a spectrum first." : undefined}>
            <span>
              <button
                className="rounded-md border border-ink-200 bg-surface px-3 py-2 text-sm text-ink-700 transition-colors hover:bg-ink-100 disabled:cursor-not-allowed disabled:text-ink-500"
                disabled={busy || !spectrum}
                onClick={exportJCAMP}
              >
                Export JDX
              </button>
            </span>
          </Hint>
          <Hint id="ftir.report" placement="bottom" extra={!active ? "Open a spectrum first." : undefined}>
            <span>
              <button
                className="rounded-md border border-ink-200 bg-surface px-3 py-2 text-sm text-ink-700 transition-colors hover:bg-ink-100 disabled:cursor-not-allowed disabled:text-ink-500"
                disabled={busy || !active}
                onClick={exportHTMLReport}
              >
                Report HTML
              </button>
            </span>
          </Hint>
          <Hint id="ftir.guide" placement="bottom">
            <button type="button" className="btn-ghost border border-ink-200" onClick={guide}>
                <Wand2 {...ICON_PROPS} />
                Guide me
              </button>
          </Hint>
          <Hint id="ftir.open" placement="bottom">
            <button
              className="btn-primary"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
            >
              {busy ? "Working…" : "Open FTIR file(s)…"}
            </button>
          </Hint>
        </>
      }
    />,
  );

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = e.dataTransfer.files ? Array.from(e.dataTransfer.files) : [];
    if (files.length > 0) void onUpload(files);
  };

  const setControlPanelOpen = (key: FTIRControlPanelKey, open: boolean) => {
    setControlPanels((prev) => ({ ...prev, [key]: open }));
  };

  const handleTagUpdated = (newTag: string) => {
    setSessions((prev) =>
      prev.map((s) => (s.session_id === activeSid ? { ...s, experiment_tag: newTag } : s)),
    );
  };

  return (
    <div
      className="flex h-full flex-col"
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      {dragOver && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-brand-500/10 backdrop-blur-sm">
          <div className="rounded-xl border-2 border-dashed border-brand-500 bg-surface px-10 py-8 text-center shadow-xl">
            <FolderOpen size={32} strokeWidth={1.5} className="mx-auto text-brand-600" aria-hidden />
            <div className="mt-2 text-sm font-medium text-brand-700">Drop your FTIR files here</div>
          </div>
        </div>
      )}
      {error && (
        <AlertBanner kind="error" message={error} onDismiss={() => setError(null)} className="mx-6 mt-2 mb-2" />
      )}

      <div className="flex min-h-0 flex-1">
        <SessionsSidebar
          sessions={sessions}
          activeSid={activeSid}
          onSelect={setActiveSid}
          onRemove={onRemove}
        />

        {!active ? (
          <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-auto p-6">
            <TabEmptyState
              icon={<FlaskConical size={40} strokeWidth={1.5} aria-hidden />}
              title="Open FTIR spectra"
              purpose="Clean up a spectrum (baseline, normalisation), pick peaks and let the bond library suggest what each one is; integrate bands, subtract spectra or deconvolute amide I when you need more."
              accepts="Accepts .csv .txt .tsv .dx .jdx .spc — two columns, wavenumber and absorbance or transmittance. Several files at once."
              pickLabel="Choose file(s)…"
              onPick={() => fileRef.current?.click()}
              exampleModule="ftir"
              onExampleOpened={openExample}
              extra={
                <button type="button" className="btn-ghost border border-ink-200" onClick={guide}>
                  <Wand2 {...ICON_PROPS} />
                  Guide me
                </button>
              }
            />
          </div>
        ) : (
          <div className="flex min-w-0 flex-1 overflow-hidden">
            {/* Left 65% Canvas: Summary, Floating Canvas Toolbar, SpectrumChart, PeakTable */}
            <div className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-4 lg:p-5">
              <ExampleTips module="ftir" activeName={active.display_name} />
              <SummaryCard active={active} spectrum={spectrum} peaks={peaks} onTagUpdated={handleTagUpdated} />

              <SpectrumChart
                peakTool={
                  <FTIRCanvasToolbar
                    mode={peakEditMode}
                    onModeChange={setPeakEditMode}
                    manualPeakCount={(manualPeakEdits[active.session_id]?.added.length ?? 0) + (manualPeakEdits[active.session_id]?.removed.length ?? 0)}
                    onClearManual={clearManualPeaks}
                  />
                }
                spectrum={spectrum}
                overlays={overlaySpectra}
                differenceSpectrum={differenceSpectrum}
                selectedReference={selectedReference}
                fitResult={fitResult}
                integrationRegion={quantState.integrationRegion}
                peaks={peaks}
                mode={pre.mode}
                title={active.display_name}
                activeSessionId={active.session_id}
                activePeaks={peaks}
                activeAssignments={assignments}
                assignmentsBySession={assignmentsBySession}
                overlayPeaksBySession={overlayPeaksBySession}
                labelEdits={labelEdits}
                onLabelEdit={updateLabelEdit}
                graphSettings={graphSettings}
                setGraphSettings={setGraphSettings}
                peakEditMode={peakEditMode}
                onChartPeakEdit={handleChartPeakEdit}
                showSecondDerivative={showSecondDerivative}
                setShowSecondDerivative={setShowSecondDerivative}
                showBaselineCurve={showBaselineCurve}
                setShowBaselineCurve={setShowBaselineCurve}
              />

              {hasAnyPeakTable && selectedPeakTableSid && selectedPeakTableSession && (
                <PeakTablesTabs
                  sessions={peakTableSessions}
                  activeSid={selectedPeakTableSid}
                  peaksBySession={{
                    ...overlayPeaksBySession,
                    [active.session_id]: peaks,
                  }}
                  onSelect={setActivePeakTableSid}
                >
                  <PeaksTable
                    sessionId={selectedPeakTableSid}
                    title={selectedPeakTableSession.display_name}
                    peaks={selectedPeakTablePeaks}
                    assignments={assignmentsBySession[selectedPeakTableSid] ?? (selectedPeakTableSid === active.session_id ? assignments : null)}
                    labelEdits={labelEdits}
                    onLabelEdit={updateLabelEdit}
                    mode={pre.mode}
                  />
                </PeakTablesTabs>
              )}
            </div>

            {/* Right 35% Inspector Panel */}
            <FTIRInspectorPanel
              activeTab={inspectorTab}
              onTabChange={setInspectorTab}
              undoPre={undoPre}
              redoPre={redoPre}
              canUndoPre={canUndoPre}
              canRedoPre={canRedoPre}
              undoPk={undoPk}
              redoPk={redoPk}
              canUndoPk={canUndoPk}
              canRedoPk={canRedoPk}
              childrenPreprocess={<PreprocessCard pre={pre} setPre={setPre} />}
              childrenPeaks={
                <div className="flex flex-col gap-4">
                  <PeakCard
                    pk={pk}
                    setPk={setPk}
                    onRun={runPick}
                    picking={picking}
                    disabled={!spectrum}
                    pickAcrossOverlay={pickAcrossOverlay}
                    setPickAcrossOverlay={setPickAcrossOverlay}
                    overlayEnabled={overlayEnabled}
                    overlayCount={overlaySessionIds.length}
                  />
                  <AssignmentConstraintsCard
                    categories={libraryCategories}
                    constraints={assignmentConstraints}
                    setConstraints={setAssignmentConstraints}
                    onApply={runPick}
                    disabled={!spectrum || picking}
                  />
                </div>
              }
              childrenQuant={
                <QuantToolsCard
                  sessions={sessions}
                  activeSid={active.session_id}
                  state={quantState}
                  setState={setQuantState}
                  integrationResult={integrationResult}
                  differenceSpectrum={differenceSpectrum}
                  onIntegrate={runIntegrate}
                  onSubtract={runSubtract}
                  onMatch={runMatch}
                  onFit={runFit}
                  onClearDifference={() => setDifferenceSpectrum(null)}
                  matchResult={matchResult}
                  selectedReference={selectedReference}
                  onSelectReference={setSelectedReference}
                  onClearReference={() => setSelectedReference(null)}
                  fitResult={fitResult}
                  onClearFit={() => setFitResult(null)}
                  busy={quantBusy}
                  disabled={!spectrum}
                />
              }
              childrenOverlay={
                <OverlayCard
                  sessions={sessions}
                  enabled={overlayEnabled}
                  setEnabled={setOverlayEnabled}
                  selectedIds={overlaySessionIds}
                  setSelectedIds={setOverlaySessionIds}
                  overlayMode={graphSettings.overlayMode}
                  setOverlayMode={(overlayMode) => setGraphSettings((prev) => ({ ...prev, overlayMode }))}
                />
              }
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ------------------------------ components ------------------------------

function CollapsiblePanel(props: {
  title: string;
  summary?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  headerRight?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="shrink-0">
      <button
        type="button"
        className="card flex w-full items-center justify-between gap-3 p-3 text-left transition-colors hover:bg-ink-50"
        aria-expanded={props.open}
        onClick={() => props.onOpenChange(!props.open)}
      >
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-ink-800">{props.title}</span>
          {props.summary ? (
            <span className="mt-0.5 block truncate text-xs text-ink-500">{props.summary}</span>
          ) : null}
        </span>
        <span className="flex items-center gap-2">
          {props.headerRight}
          <span
            className={clsx(
              "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded border border-ink-200 text-xs text-ink-600 transition-transform",
              props.open && "rotate-90",
            )}
            aria-hidden="true"
          >
            {">"}
          </span>
        </span>
      </button>
      {props.open && <div className="mt-2">{props.children}</div>}
    </section>
  );
}

function SessionsSidebar(props: {
  sessions: FTIRSessionSummary[];
  activeSid: string | null;
  onSelect: (sid: string) => void;
  onRemove: (sid: string) => void;
}) {
  return (
    <SideRail
      label="Sessions"
      rail={props.sessions.map((s, idx) => (
        <button
          key={s.session_id}
          type="button"
          onClick={() => props.onSelect(s.session_id)}
          title={s.display_name}
          className={clsx(
            "flex h-7 w-8 shrink-0 items-center justify-center rounded-md border text-[12px] font-semibold transition-colors",
            s.session_id === props.activeSid
              ? "border-brand-500 bg-surface text-brand-700 shadow-card"
              : "border-transparent text-ink-500 hover:border-ink-200 hover:bg-surface",
          )}
        >
          {idx + 1}
        </button>
      ))}
    >
      {(close) => (
        <>
          {props.sessions.length === 0 && <div className="text-caption px-2">No files loaded.</div>}
          {props.sessions.map((s) => {
            const isActive = s.session_id === props.activeSid;
            return (
              <div
                key={s.session_id}
                className={clsx(
                  "group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5",
                  isActive ? "bg-surface shadow-card" : "hover:bg-ink-100",
                )}
                onClick={() => {
                  props.onSelect(s.session_id);
                  close();
                }}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium" title={s.display_name}>
                    {s.display_name}
                  </div>
                  <div className="text-caption">
                    {s.n_points.toLocaleString()} pts · {formatRange(s.wn_min, s.wn_max)} cm⁻¹
                  </div>
                </div>
                <button
                  type="button"
                  className="btn-ghost invisible px-1.5 py-0.5 group-hover:visible"
                  onClick={(e) => {
                    e.stopPropagation();
                    props.onRemove(s.session_id);
                  }}
                  aria-label={`Remove ${s.display_name}`}
                  title="Remove"
                >
                  <X {...ICON_PROPS} />
                </button>
              </div>
            );
          })}
        </>
      )}
    </SideRail>
  );
}

function SummaryCard(props: {
  active: FTIRSessionSummary;
  spectrum: FTIRSpectrumResponse | null;
  peaks: FTIRPeak[];
  onTagUpdated?: (newTag: string) => void;
}) {
  const { active, spectrum, peaks, onTagUpdated } = props;
  const status = [
    `${active.n_points.toLocaleString()} points${spectrum ? ` (plotting ${spectrum.n_points_returned.toLocaleString()})` : ""}`,
    `${formatRange(active.wn_min, active.wn_max)} cm⁻¹`,
    `raw y ${formatRange(active.y_min, active.y_max)}`,
    `${peaks.length} peak${peaks.length === 1 ? "" : "s"}`,
  ].join(" · ");
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 px-1">
      <span className="text-card-title max-w-[28rem] truncate" title={active.display_name}>
        {active.display_name}
      </span>
      <span className="text-caption">{status}</span>
      <ExperimentTagEditor
        sessionId={active.session_id}
        currentTag={active.experiment_tag}
        module="ftir"
        onTagUpdated={onTagUpdated}
      />
    </div>
  );
}

function PreprocessCard(props: {
  pre: FTIRPreprocessOptions;
  setPre: (p: FTIRPreprocessOptions) => void;
}) {
  const { pre, setPre } = props;
  return (
    <div className="card shrink-0 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-card-title">Preprocess</h3>
        <Hint id="ftir.preset">
          <select
            className="input py-1"
            aria-label="Apply a preprocessing preset"
            value=""
            onChange={(e) => {
              const preset = FTIR_PRESETS[e.target.value];
              if (preset) setPre({ ...pre, ...preset });
            }}
          >
            <option value="" disabled>
              Preset…
            </option>
            {Object.keys(FTIR_PRESETS).map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </Hint>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field hint="ftir.mode" label="Mode">
          <select
            className="input w-full"
            value={pre.mode}
            onChange={(e) => setPre({ ...pre, mode: e.target.value as FTIRYMode })}
          >
            <option value="absorbance">absorbance</option>
            <option value="transmittance">transmittance</option>
          </select>
        </Field>
        <Field hint="ftir.smoothing" label="Smoothing window">
          <input
            type="number"
            className="input w-full"
            min={0}
            max={201}
            step={2}
            value={pre.smoothing_window}
            onChange={(e) =>
              setPre({ ...pre, smoothing_window: clampInt(e.target.value, 0, 201) })
            }
          />
        </Field>
        <Field hint="ftir.polyOrder" label="SavGol poly order">
          <input
            type="number"
            className="input w-full"
            min={0}
            max={5}
            value={pre.poly_order}
            onChange={(e) => setPre({ ...pre, poly_order: clampInt(e.target.value, 0, 5) })}
          />
        </Field>
        <Field hint="ftir.baseline" label="Baseline">
          <select
            className="input w-full"
            value={pre.baseline}
            onChange={(e) => setPre({ ...pre, baseline: e.target.value as FTIRBaseline })}
          >
            <option value="none">none</option>
            <option value="rubberband">rubberband</option>
            <option value="asls">AsLS</option>
            <option value="airpls">airPLS</option>
            <option value="polyfit">polyfit (deg≤3)</option>
          </select>
        </Field>
        <Field hint="ftir.normalize" label="Normalize">
          <select
            className="input w-full"
            value={pre.normalize}
            onChange={(e) => setPre({ ...pre, normalize: e.target.value as FTIRNormalize })}
          >
            <option value="none">none</option>
            <option value="max">max</option>
            <option value="area">area</option>
            <option value="snv">SNV</option>
            <option value="vector">vector</option>
            <option value="min-max">min-max</option>
          </select>
        </Field>
        <Field hint="ftir.baselineLambda" label="Baseline lambda">
          <input
            type="number"
            className="input w-full"
            min={1}
            max={1000000000}
            step={10000}
            value={pre.baseline_lambda}
            disabled={!["asls", "airpls"].includes(pre.baseline)}
            onChange={(e) =>
              setPre({ ...pre, baseline_lambda: Math.max(1, Math.min(1000000000, Number(e.target.value) || 100000)) })
            }
          />
        </Field>
        <Field hint="ftir.asymmetry" label="Asymmetry p">
          <input
            type="number"
            className="input w-full"
            min={0.001}
            max={0.1}
            step={0.001}
            value={pre.baseline_p}
            disabled={pre.baseline !== "asls"}
            onChange={(e) =>
              setPre({ ...pre, baseline_p: Math.max(0.001, Math.min(0.1, Number(e.target.value) || 0.01)) })
            }
          />
        </Field>
        <Field hint="ftir.maskCo2" label="Atmospheric mask">
          <>
            <label className="flex min-h-9 items-center gap-2 rounded-md border border-ink-200 bg-surface px-2 py-1 text-[13px]">
              <input
                type="checkbox"
                checked={pre.mask_atmospheric}
                onChange={(e) => setPre({ ...pre, mask_atmospheric: e.target.checked })}
              />
              Mask CO₂
            </label>
          </>
        </Field>
        <Field hint="ftir.atr" label="ATR correction">
          <>
            <label className="flex min-h-9 items-center gap-2 rounded-md border border-ink-200 bg-surface px-2 py-1 text-[13px]">
              <input
                type="checkbox"
                checked={pre.atr_correction}
                onChange={(e) => setPre({ ...pre, atr_correction: e.target.checked })}
              />
              Correct ATR (approx.)
            </label>
          </>
        </Field>
        <Field hint="ftir.atrN" label="ATR n crystal">
          <input
            type="number"
            className="input w-full"
            min={1.1}
            max={4}
            step={0.05}
            value={pre.atr_n_crystal}
            disabled={!pre.atr_correction}
            onChange={(e) =>
              setPre({ ...pre, atr_n_crystal: Math.max(1.1, Math.min(4, Number(e.target.value) || 1.5)) })
            }
          />
        </Field>
      </div>
    </div>
  );
}

function OverlayCard(props: {
  sessions: FTIRSessionSummary[];
  enabled: boolean;
  setEnabled: (v: boolean) => void;
  selectedIds: string[];
  setSelectedIds: (ids: string[]) => void;
  overlayMode: GraphSettings["overlayMode"];
  setOverlayMode: (mode: GraphSettings["overlayMode"]) => void;
}) {
  return (
    <div className="card shrink-0 p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="text-sm font-semibold">Overlay</h3>
        <Hint id="ftir.overlayShow">
          <label className="flex items-center gap-2 text-sm text-ink-700">
            <input
              type="checkbox"
              checked={props.enabled}
              onChange={(e) => props.setEnabled(e.target.checked)}
            />
            Show selected spectra
          </label>
        </Hint>
      </div>
      <Hint id="ftir.overlayMode">
        <div className="mb-3 flex items-center gap-2 text-xs text-ink-600">
          <span>Mode</span>
          <select className="input py-1 text-xs" value={props.overlayMode ?? "overlay"} onChange={(e) => props.setOverlayMode(e.target.value as GraphSettings["overlayMode"])}>
            <option value="overlay">overlay</option>
            <option value="offset">offset</option>
            <option value="stacked">stacked</option>
          </select>
        </div>
      </Hint>
      <Hint id="ftir.overlaySelect" className="w-full">
        <div className="grid gap-2">
          {props.sessions.map((session) => (
            <label
              key={session.session_id}
              className="flex min-w-0 items-center gap-2 rounded-md border border-ink-200 bg-surface px-2 py-1.5 text-xs"
            >
              <input
                type="checkbox"
                checked={props.selectedIds.includes(session.session_id)}
                onChange={(event) => {
                  props.setSelectedIds(
                    event.target.checked
                      ? [...props.selectedIds, session.session_id]
                      : props.selectedIds.filter((sid) => sid !== session.session_id),
                  );
                }}
              />
              <span className="truncate">{session.display_name}</span>
            </label>
          ))}
        </div>
      </Hint>
    </div>
  );
}

function PeakCard(props: {
  pk: PeakPickOptions;
  setPk: (p: PeakPickOptions) => void;
  onRun: () => void;
  picking: boolean;
  disabled: boolean;
  pickAcrossOverlay: boolean;
  setPickAcrossOverlay: (value: boolean) => void;
  overlayEnabled: boolean;
  overlayCount: number;
}) {
  const { pk, setPk } = props;
  return (
    <div className="card shrink-0 p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-card-title">Peak picking</h3>
        <Hint id="ftir.pickPeaks">
          <button className="btn-primary whitespace-nowrap" onClick={props.onRun} disabled={props.disabled || props.picking}>
            {props.picking ? "Picking…" : "Pick peaks"}
          </button>
        </Hint>
      </div>
      <Hint id="ftir.pickOverlay">
        <label className="text-body mb-3 flex items-center gap-2">
          <input
            type="checkbox"
            checked={props.pickAcrossOverlay}
            disabled={!props.overlayEnabled || props.overlayCount < 2}
            onChange={(e) => props.setPickAcrossOverlay(e.target.checked)}
          />
          Pick on overlaid spectra
        </label>
      </Hint>
      <div className="grid grid-cols-2 gap-3">
        <Field hint="ftir.minProminence" label="Min prominence" className="flex flex-col justify-end">
          <input
            type="number"
            className="input w-full"
            min={0}
            step={0.001}
            value={pk.min_prominence}
            onChange={(e) =>
              setPk({ ...pk, min_prominence: Math.max(0, Number(e.target.value) || 0) })
            }
          />
        </Field>
        <Field hint="ftir.minHeight" label="Min height" className="flex flex-col justify-end">
          <input
            type="number"
            className="input w-full"
            min={0}
            step={0.001}
            value={pk.min_height ?? ""}
            placeholder="off"
            onChange={(e) =>
              setPk({
                ...pk,
                min_height:
                  e.target.value.trim() === ""
                    ? null
                    : Math.max(0, Number(e.target.value) || 0),
              })
            }
          />
        </Field>
        <Field hint="ftir.minDistance" label="Min distance (cm⁻¹)" className="flex flex-col justify-end">
          <input
            type="number"
            className="input w-full"
            min={0}
            step={1}
            value={pk.min_distance_cm1}
            onChange={(e) =>
              setPk({ ...pk, min_distance_cm1: Math.max(0, Number(e.target.value) || 0) })
            }
          />
        </Field>
        <Field hint="ftir.topN" label="Top N (0 = all)" className="flex flex-col justify-end">
          <input
            type="number"
            className="input w-full"
            min={0}
            max={200}
            step={1}
            value={pk.top_n}
            onChange={(e) => setPk({ ...pk, top_n: clampInt(e.target.value, 0, 200) })}
          />
        </Field>
        <Field hint="ftir.assign" label="Assign bonds" className="flex flex-col justify-end">
          <label className="flex min-h-9 items-center gap-2 rounded-md border border-ink-200 bg-surface px-2 py-1 text-[13px]">
            <input
              type="checkbox"
              checked={pk.assign}
              onChange={(e) => setPk({ ...pk, assign: e.target.checked })}
            />
            Use library v3
          </label>
        </Field>
        <Field hint="ftir.shoulder" label="2nd derivative" className="flex flex-col justify-end">
          <>
            <label className="flex min-h-9 items-center gap-2 rounded-md border border-ink-200 bg-surface px-2 py-1 text-[13px]">
              <input
                type="checkbox"
                checked={pk.second_derivative}
                onChange={(e) => setPk({ ...pk, second_derivative: e.target.checked })}
              />
              Shoulder mode
            </label>
          </>
        </Field>
        <Field hint="ftir.assignTopN" label="Assign top N" className="flex flex-col justify-end">
          <input
            type="number"
            className="input w-full"
            min={1}
            max={10}
            step={1}
            value={pk.assign_top_n}
            disabled={!pk.assign}
            onChange={(e) => setPk({ ...pk, assign_top_n: clampInt(e.target.value, 1, 10) })}
          />
        </Field>
        <Field hint="ftir.assignMinScore" label="Assign min score" className="flex flex-col justify-end">
          <input
            type="number"
            className="input w-full"
            min={0}
            max={100}
            step={1}
            value={pk.assign_min_score}
            disabled={!pk.assign}
            onChange={(e) =>
              setPk({
                ...pk,
                assign_min_score: Math.max(0, Math.min(100, Number(e.target.value) || 0)),
              })
            }
          />
        </Field>
      </div>
    </div>
  );
}

function AssignmentConstraintsCard(props: {
  categories: FTIRLibraryCategories | null;
  constraints: FTIRAssignmentConstraints;
  setConstraints: (value: FTIRAssignmentConstraints) => void;
  onApply: () => void;
  disabled: boolean;
}) {
  const categories = props.categories?.categories ?? [];
  const subcategories = Object.entries(props.categories?.subcategories_by_category ?? {}).flatMap(
    ([category, values]) => values.map((value) => ({ category, value })),
  );
  const toggleCategory = (category: string, checked: boolean) => {
    const nextCategories = toggleString(props.constraints.excluded_categories, category, checked);
    const removedSubcategories = props.categories?.subcategories_by_category[category] ?? [];
    props.setConstraints({
      ...props.constraints,
      excluded_categories: nextCategories,
      excluded_subcategories: checked
        ? props.constraints.excluded_subcategories
        : props.constraints.excluded_subcategories.filter((item) => !removedSubcategories.includes(item)),
    });
  };
  const toggleSubcategory = (subcategory: string, checked: boolean) => {
    props.setConstraints({
      ...props.constraints,
      excluded_subcategories: toggleString(props.constraints.excluded_subcategories, subcategory, checked),
    });
  };
  return (
    <div className="card shrink-0 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-card-title">Assignment constraints</h3>
          <p className="text-caption mt-0.5">
            Rule out functional groups before re-labeling peaks.
          </p>
        </div>
        <Hint id="ftir.relabel">
          <span>
            <button className="btn-primary" onClick={props.onApply} disabled={props.disabled}>
              Apply & re-label
            </button>
          </span>
        </Hint>
      </div>
      <div className="grid grid-cols-1 gap-3">
        <Field hint="ftir.excludeCategories" label="Exclude categories">
          <div className="max-h-36 overflow-auto rounded-md border border-ink-200 bg-surface p-2">
            {categories.length === 0 ? (
              <div className="text-xs text-ink-500">Library categories unavailable.</div>
            ) : (
              <div className="grid grid-cols-1 gap-1">
                {categories.map((category) => (
                  <label key={category} className="flex items-center gap-2 text-[13px] text-ink-700">
                    <input
                      type="checkbox"
                      checked={props.constraints.excluded_categories.includes(category)}
                      onChange={(event) => toggleCategory(category, event.target.checked)}
                    />
                    <span className="truncate">{category}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </Field>
        <Field hint="ftir.excludeSubcategories" label="Exclude subcategories">
          <div className="max-h-36 overflow-auto rounded-md border border-ink-200 bg-surface p-2">
            {subcategories.length === 0 ? (
              <div className="text-xs text-ink-500">No subcategories loaded.</div>
            ) : (
              <div className="grid grid-cols-1 gap-1">
                {subcategories.map(({ category, value }) => (
                  <label key={`${category}:${value}`} className="flex items-center gap-2 text-[13px] text-ink-700">
                    <input
                      type="checkbox"
                      checked={props.constraints.excluded_subcategories.includes(value)}
                      disabled={props.constraints.excluded_categories.includes(category)}
                      onChange={(event) => toggleSubcategory(value, event.target.checked)}
                    />
                    <span className="truncate">
                      {value}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </Field>
        <Field hint="ftir.ambiguity" label="Ambiguity ratio">
          <input
            type="number"
            className="input w-full"
            min={1}
            max={5}
            step={0.1}
            value={props.constraints.ambiguity_ratio}
            onChange={(event) =>
              props.setConstraints({
                ...props.constraints,
                ambiguity_ratio: Math.max(1, Math.min(5, Number(event.target.value) || 1.3)),
              })
            }
          />
        </Field>
      </div>
    </div>
  );
}

function toggleString(values: string[], value: string, checked: boolean): string[] {
  if (checked) return values.includes(value) ? values : [...values, value];
  return values.filter((item) => item !== value);
}

function QuantToolsCard(props: {
  sessions: FTIRSessionSummary[];
  activeSid: string;
  state: FTIRQuantState;
  setState: (value: FTIRQuantState) => void;
  integrationResult: FTIRIntegrationResponse | null;
  differenceSpectrum: FTIRSubtractResponse | null;
  onIntegrate: () => void;
  onSubtract: () => void;
  onMatch: () => void;
  onFit: () => void;
  onClearDifference: () => void;
  matchResult: FTIRMatchResponse | null;
  selectedReference: FTIRReferenceHit | null;
  onSelectReference: (hit: FTIRReferenceHit) => void;
  onClearReference: () => void;
  fitResult: FTIRFitResponse | null;
  onClearFit: () => void;
  busy: boolean;
  disabled: boolean;
}) {
  const compareSessions = props.sessions.filter((session) => session.session_id !== props.activeSid);
  const selectedCompareSid = props.state.subtractSid || compareSessions[0]?.session_id || "";
  const updateRegion = (key: "integrationRegion" | "subtractRegion" | "fitRegion", patch: Partial<FTIRBandRegion>) => {
    props.setState({ ...props.state, [key]: { ...props.state[key], ...patch } });
  };
  const updateAnyRegion = (key: "integrationRegion" | "subtractRegion" | "matchRegion" | "fitRegion", patch: Partial<FTIRBandRegion>) => {
    props.setState({ ...props.state, [key]: { ...props.state[key], ...patch } });
  };
  return (
    <div className="card shrink-0 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Quantitative tools</h3>
          <p className="mt-0.5 text-xs text-ink-500">Integrate bands and create scaled difference spectra.</p>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4">
        <div className="rounded-md border border-ink-200 bg-surface-raised p-3">
          <div className="text-section mb-2">Band integration</div>
          <div className="grid grid-cols-2 gap-2">
            <Field hint="ftir.integrateRegion" label="Lo cm^-1">
              <input
                className="input w-full"
                type="number"
                value={props.state.integrationRegion.lo}
                onChange={(event) => updateRegion("integrationRegion", { lo: Number(event.target.value) || 0 })}
              />
            </Field>
            <Field hint="ftir.integrateRegion" label="Hi cm^-1">
              <input
                className="input w-full"
                type="number"
                value={props.state.integrationRegion.hi}
                onChange={(event) => updateRegion("integrationRegion", { hi: Number(event.target.value) || 0 })}
              />
            </Field>
            <Field hint="ftir.integrateBaseline" label="Baseline">
              <select
                className="input w-full"
                value={props.state.integrationBaseline}
                onChange={(event) =>
                  props.setState({
                    ...props.state,
                    integrationBaseline: event.target.value as FTIRQuantState["integrationBaseline"],
                  })
                }
              >
                <option value="linear">linear</option>
                <option value="horizontal">horizontal</option>
                <option value="tangent">tangent</option>
              </select>
            </Field>
            <Field hint="ftir.integrate" label="Run">
              <button className="btn-primary h-9 w-full" disabled={props.disabled || props.busy} onClick={props.onIntegrate}>
                Integrate
              </button>
            </Field>
          </div>
          {props.integrationResult && (
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <Metric label="Area" value={formatNumber(props.integrationResult.area)} />
              <Metric label="Height" value={formatNumber(props.integrationResult.height)} />
              <Metric label="FWHM" value={props.integrationResult.fwhm == null ? "-" : props.integrationResult.fwhm.toFixed(1)} />
              <Metric label="Peak" value={`${props.integrationResult.peak_wn.toFixed(1)} cm^-1`} />
            </div>
          )}
        </div>

        <div className="rounded-md border border-ink-200 bg-surface-raised p-3">
          <div className="text-section mb-2">Difference spectrum</div>
          <div className="grid grid-cols-2 gap-2">
            <Field hint="ftir.subtractSession" label="Subtract session">
              <select
                className="input w-full"
                value={selectedCompareSid}
                disabled={compareSessions.length === 0}
                onChange={(event) => props.setState({ ...props.state, subtractSid: event.target.value })}
              >
                {compareSessions.length === 0 && <option value="">No comparison</option>}
                {compareSessions.map((session) => (
                  <option key={session.session_id} value={session.session_id}>
                    {session.display_name}
                  </option>
                ))}
              </select>
            </Field>
            <Field hint="ftir.subtractK" label="Scale k">
              <input
                className="input w-full"
                type="number"
                min={-10}
                max={10}
                step={0.05}
                value={props.state.subtractK}
                onChange={(event) => props.setState({ ...props.state, subtractK: Number(event.target.value) || 0 })}
              />
            </Field>
            <Field hint="ftir.subtractAutoFit" label="Auto-fit region">
              <label className="flex min-h-9 items-center gap-2 rounded-md border border-ink-200 bg-surface px-2 py-1 text-[13px]">
                <input
                  type="checkbox"
                  checked={props.state.subtractUseRegion}
                  onChange={(event) => props.setState({ ...props.state, subtractUseRegion: event.target.checked })}
                />
                Use region
              </label>
            </Field>
            <Field hint="ftir.subtract" label="Run">
              <button
                className="btn-primary h-9 w-full"
                disabled={props.disabled || props.busy || !selectedCompareSid}
                onClick={props.onSubtract}
              >
                Subtract
              </button>
            </Field>
            {props.state.subtractUseRegion && (
              <>
                <Field hint="ftir.subtractRegion" label="Fit lo cm^-1">
                  <input
                    className="input w-full"
                    type="number"
                    value={props.state.subtractRegion.lo}
                    onChange={(event) => updateRegion("subtractRegion", { lo: Number(event.target.value) || 0 })}
                  />
                </Field>
                <Field hint="ftir.subtractRegion" label="Fit hi cm^-1">
                  <input
                    className="input w-full"
                    type="number"
                    value={props.state.subtractRegion.hi}
                    onChange={(event) => updateRegion("subtractRegion", { hi: Number(event.target.value) || 0 })}
                  />
                </Field>
              </>
            )}
          </div>
          {props.differenceSpectrum && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-600">
              <span>
                Difference trace shown with k={props.differenceSpectrum.k.toFixed(3)} over{" "}
                {props.differenceSpectrum.n_points_returned.toLocaleString()} points.
              </span>
              <Hint id="ftir.clearDifference">
                <button className="btn-ghost border border-ink-200 px-2 py-0.5 text-xs" onClick={props.onClearDifference}>
                  Clear difference
                </button>
              </Hint>
            </div>
          )}
        </div>
      </div>
      <div className="mt-4 rounded-md border border-ink-200 bg-surface-raised p-3">
        <div className="text-section mb-2">Reference matching</div>
        <div className="grid grid-cols-2 gap-2">
          <Field hint="ftir.matchRegion" label="Match lo cm^-1">
            <input
              className="input w-full"
              type="number"
              value={props.state.matchRegion.lo}
              onChange={(event) => updateAnyRegion("matchRegion", { lo: Number(event.target.value) || 650 })}
            />
          </Field>
          <Field hint="ftir.matchRegion" label="Match hi cm^-1">
            <input
              className="input w-full"
              type="number"
              value={props.state.matchRegion.hi}
              onChange={(event) => updateAnyRegion("matchRegion", { hi: Number(event.target.value) || 1800 })}
            />
          </Field>
          <Field hint="ftir.matchDerivative" label="Derivative">
            <select
              className="input w-full"
              value={props.state.matchDerivativeOrder}
              onChange={(event) =>
                props.setState({
                  ...props.state,
                  matchDerivativeOrder: Number(event.target.value) as FTIRQuantState["matchDerivativeOrder"],
                })
              }
            >
              <option value={0}>0</option>
              <option value={1}>1st</option>
              <option value={2}>2nd</option>
            </select>
          </Field>
          <Field hint="ftir.matchTopN" label="Top N">
            <input
              className="input w-full"
              type="number"
              min={1}
              max={12}
              value={props.state.matchTopN}
              onChange={(event) =>
                props.setState({ ...props.state, matchTopN: clampInt(event.target.value, 1, 12) })
              }
            />
          </Field>
          <Field hint="ftir.match" label="Run">
            <button className="btn-primary h-9 w-full" disabled={props.disabled || props.busy} onClick={props.onMatch}>
              Match
            </button>
          </Field>
          <Field hint="ftir.clearReference" label="Overlay">
            <button
              className="btn-ghost h-9 w-full border border-ink-200 px-2 text-xs"
              disabled={!props.selectedReference}
              onClick={props.onClearReference}
            >
              Clear ref
            </button>
          </Field>
        </div>
        {props.matchResult && (
          <div className="mt-3 grid grid-cols-1 gap-2">
            {props.matchResult.hits.map((hit) => {
              const isSelected = props.selectedReference?.name === hit.name;
              const pct = Math.max(0, Math.min(100, hit.correlation * 100));
              return (
                <button
                  key={hit.name}
                  className={clsx(
                    "rounded-md border p-2 text-left transition-colors",
                    isSelected ? "border-brand-500 bg-brand-500/10" : "border-ink-200 bg-surface hover:bg-ink-50",
                  )}
                  onClick={() => props.onSelectReference(hit)}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-ink-800">{hit.label}</div>
                      <div className="truncate text-[12px] text-ink-500">{hit.ranking_method}</div>
                    </div>
                    <div className="font-mono text-sm text-ink-700">{hit.correlation.toFixed(3)}</div>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink-100">
                    <div className="h-full rounded-full bg-brand-500" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="mt-1 truncate text-[12px] text-ink-500">{hit.source}</div>
                </button>
              );
            })}
          </div>
        )}
      </div>
      <div className="mt-4 rounded-md border border-ink-200 bg-surface-raised p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="text-section">
            Sub-band Deconvolution & Fitting (2nd Derivative Seeded)
          </div>
          <Hint id="ftir.fitPresets">
            <div className="flex flex-wrap items-center gap-1 text-[12px] text-ink-500">
              <span>Presets:</span>
              <button
                type="button"
                className="rounded border border-ink-200 bg-surface px-1.5 py-0.5 hover:bg-ink-100"
                onClick={() => props.setState({ ...props.state, fitRegion: { lo: 1600, hi: 1700 }, fitComponents: 4, fitProfile: "gauss" })}
              >
                Amide I (1600–1700)
              </button>
              <button
                type="button"
                className="rounded border border-ink-200 bg-surface px-1.5 py-0.5 hover:bg-ink-100"
                onClick={() => props.setState({ ...props.state, fitRegion: { lo: 1680, hi: 1780 }, fitComponents: 2, fitProfile: "gauss" })}
              >
                Carbonyl (1680–1780)
              </button>
              <button
                type="button"
                className="rounded border border-ink-200 bg-surface px-1.5 py-0.5 hover:bg-ink-100"
                onClick={() => props.setState({ ...props.state, fitRegion: { lo: 3100, hi: 3600 }, fitComponents: 3, fitProfile: "gauss" })}
              >
                O-H/N-H (3100–3600)
              </button>
            </div>
          </Hint>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field hint="ftir.fitRegion" label="Fit lo cm^-1">
            <input
              className="input w-full"
              type="number"
              value={props.state.fitRegion.lo}
              onChange={(event) => updateRegion("fitRegion", { lo: Number(event.target.value) || 0 })}
            />
          </Field>
          <Field hint="ftir.fitRegion" label="Fit hi cm^-1">
            <input
              className="input w-full"
              type="number"
              value={props.state.fitRegion.hi}
              onChange={(event) => updateRegion("fitRegion", { hi: Number(event.target.value) || 0 })}
            />
          </Field>
          <Field hint="ftir.fitComponents" label="Components">
            <input
              className="input w-full"
              type="number"
              min={1}
              max={6}
              value={props.state.fitComponents}
              onChange={(event) =>
                props.setState({ ...props.state, fitComponents: clampInt(event.target.value, 1, 6) })
              }
            />
          </Field>
          <Field hint="ftir.fitProfile" label="Profile">
            <select
              className="input w-full"
              value={props.state.fitProfile}
              onChange={(event) =>
                props.setState({
                  ...props.state,
                  fitProfile: event.target.value as FTIRQuantState["fitProfile"],
                })
              }
            >
              <option value="gauss">Gaussian</option>
              <option value="lorentz">Lorentzian</option>
              <option value="voigt">Voigt mix</option>
            </select>
          </Field>
          <Field hint="ftir.deconvolute" label="Run">
            <button className="btn-primary h-9 w-full" disabled={props.disabled || props.busy} onClick={props.onFit}>
              Deconvolute
            </button>
          </Field>
          <Field hint="ftir.clearFit" label="Overlay">
            <button
              className="btn-ghost h-9 w-full border border-ink-200 px-2 text-xs"
              disabled={!props.fitResult}
              onClick={props.onClearFit}
            >
              Clear fit
            </button>
          </Field>
        </div>
        {props.fitResult && (
          <div className="mt-3">
            {props.fitResult.converged === false && (
              <div className="mb-2 rounded border border-warning/40 bg-warning-surface px-2 py-1 text-xs text-warning-fg">
                The fit did not converge ({props.fitResult.fit_error}). The components below are only the starting
                guesses, not fitted values — try fewer components, another profile or a narrower region.
              </div>
            )}
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-600">
              <div className="flex flex-wrap gap-2">
                <Metric label="R²" value={props.fitResult.r2 == null ? "-" : props.fitResult.r2.toFixed(4)} />
                <Metric label="RMS Residual" value={formatNumber(props.fitResult.residual_rms)} />
                <Metric label="Profile" value={props.fitResult.profile} />
              </div>
              <Hint id="ftir.fitCsv">
                <button
                  type="button"
                  className="rounded border border-ink-200 bg-surface px-2 py-1 text-xs text-ink-700 hover:bg-ink-100"
                  onClick={() => {
                    if (!props.fitResult) return;
                    const rows = [
                      ["Component", "Center_cm1", "Assignment", "FWHM_cm1", "Amplitude", "Area", "Area_Percent"],
                      ...props.fitResult.components.map((c) => [
                        c.index,
                        c.center.toFixed(2),
                        `"${c.assignment ?? ""}"`,
                        c.fwhm != null ? c.fwhm.toFixed(2) : (c.width * 2.35).toFixed(2),
                        c.amplitude.toFixed(4),
                        c.area.toFixed(4),
                        c.area_percent != null ? c.area_percent.toFixed(2) : "",
                      ]),
                    ];
                    const csv = rows.map((r) => r.join(",")).join("\n");
                    void navigator.clipboard.writeText(csv);
                  }}
                >
                  Copy deconvolution CSV
                </button>
              </Hint>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full border-separate border-spacing-0 text-xs">
                <thead>
                  <tr>
                    <Th>#</Th>
                    <Th align="right">Center (cm⁻¹)</Th>
                    <Th align="left">Assignment / Conformation</Th>
                    <Th align="right">FWHM (cm⁻¹)</Th>
                    <Th align="right">Area</Th>
                    <Th align="right">Area %</Th>
                  </tr>
                </thead>
                <tbody>
                  {props.fitResult.components.map((component) => (
                    <tr key={component.index} className="odd:bg-ink-50/40">
                      <Td>{component.index}</Td>
                      <Td align="right">{component.center.toFixed(1)}</Td>
                      <Td align="left">
                        <span className="rounded bg-brand-50 px-1.5 py-0.5 text-[12px] font-medium text-brand-700">
                          {component.assignment ?? "Band"}
                        </span>
                      </Td>
                      <Td align="right">
                        {component.fwhm != null ? component.fwhm.toFixed(1) : (component.width * 2.35).toFixed(1)}
                      </Td>
                      <Td align="right">
                        <span className="font-semibold text-brand-700">
                          {component.area_percent != null ? `${component.area_percent.toFixed(1)}%` : "-"}
                        </span>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Metric(props: { label: string; value: string }) {
  return (
    <div className="rounded border border-ink-200 bg-surface px-2 py-1">
      <div className="text-caption">{props.label}</div>
      <div className="font-mono text-sm text-ink-800">{props.value}</div>
    </div>
  );
}

function SortButton(props: {
  label: string;
  field: PeakSortKey;
  sortKey: PeakSortKey;
  sortDir: "asc" | "desc";
  setSortKey: (value: PeakSortKey) => void;
  setSortDir: (value: "asc" | "desc") => void;
}) {
  const active = props.sortKey === props.field;
  return (
    <button
      className="text-xs font-semibold"
      onClick={() => {
        if (active) props.setSortDir(props.sortDir === "asc" ? "desc" : "asc");
        else props.setSortKey(props.field);
      }}
    >
      {props.label}{active ? (props.sortDir === "asc" ? " ↑" : " ↓") : ""}
    </button>
  );
}

type PeakSortKey = "wn" | "y" | "prominence" | "score";

type FTIRRegion = "full" | "fingerprint" | "functional" | "amide" | "custom";
const FTIR_REGIONS: Record<Exclude<FTIRRegion, "custom">, [number, number]> = {
  full:       [400, 4000],
  fingerprint:[400, 1500],
  functional: [1500, 4000],
  amide:      [1500, 1750],
};
const FIT_COMPONENT_COLORS = ["#7c3aed", "#0891b2", "#ea580c", "#16a34a", "#db2777", "#4f46e5"];
const GROUP_FREQUENCY_REGIONS = [
  { lo: 3200, hi: 3550, color: "rgba(14, 165, 233, 0.10)" },
  { lo: 2850, hi: 3000, color: "rgba(34, 197, 94, 0.10)" },
  { lo: 1700, hi: 1750, color: "rgba(239, 68, 68, 0.10)" },
  { lo: 1630, hi: 1690, color: "rgba(168, 85, 247, 0.10)" },
  { lo: 1500, hi: 1580, color: "rgba(245, 158, 11, 0.10)" },
  { lo: 1000, hi: 1300, color: "rgba(20, 184, 166, 0.10)" },
];

function SpectrumChart(props: {
  peakTool: ReactNode;
  spectrum: FTIRSpectrumResponse | null;
  overlays: FTIROverlaySpectrum[];
  differenceSpectrum: FTIRSubtractResponse | null;
  selectedReference: FTIRReferenceHit | null;
  fitResult: FTIRFitResponse | null;
  integrationRegion: FTIRBandRegion;
  peaks: FTIRPeak[];
  mode: FTIRYMode;
  title: string;
  activeSessionId: string;
  activePeaks: FTIRPeak[];
  activeAssignments: FTIRAssignment[] | null;
  assignmentsBySession: Record<string, FTIRAssignment[] | null>;
  overlayPeaksBySession: Record<string, FTIRPeak[]>;
  labelEdits: FTIRLabelEdits;
  onLabelEdit: (key: string, patch: FTIRLabelEdit) => void;
  graphSettings: GraphSettings;
  setGraphSettings: (value: GraphSettings) => void;
  peakEditMode: PeakEditMode;
  onChartPeakEdit: (wn: number, y: number) => void;
  showSecondDerivative: boolean;
  setShowSecondDerivative: React.Dispatch<React.SetStateAction<boolean>>;
  showBaselineCurve: boolean;
  setShowBaselineCurve: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  const { mode } = props;
  const toShown = useCallback((values: number[]) => values.map((v) => displayY(v, mode)), [mode]);
  const shownPeaks = useCallback((peaks: FTIRPeak[]) => peaks.map((p) => ({ ...p, y: displayY(p.y, mode) })), [mode]);
  const spectrum = useMemo(
    () =>
      props.spectrum && mode === "transmittance"
        ? {
            ...props.spectrum,
            y: toShown(props.spectrum.y),
            baseline: props.spectrum.baseline ? toShown(props.spectrum.baseline) : props.spectrum.baseline,
          }
        : props.spectrum,
    [mode, props.spectrum, toShown],
  );
  const activePeaksShown = useMemo(() => shownPeaks(props.activePeaks), [props.activePeaks, shownPeaks]);
  const overlayPeaksShown = useMemo(
    () => Object.fromEntries(Object.entries(props.overlayPeaksBySession).map(([sid, peaks]) => [sid, shownPeaks(peaks)])),
    [props.overlayPeaksBySession, shownPeaks],
  );
  // Labels sit above absorbance peaks and below transmittance dips.
  const labelAy = mode === "transmittance" ? 30 : -30;
  const pt = usePlotlyTheme();
  const [region, setRegion] = useState<FTIRRegion>("full");
  const [customMin, setCustomMin] = useState(400);
  const [customMax, setCustomMax] = useState(4000);
  const [showGraphSettings, setShowGraphSettings] = useState(false);
  useRevealPanel({ "ftir.chart.design": () => setShowGraphSettings(true) });
  const plotRef = useRef<unknown>(null);
  const plotContainerRef = useRef<HTMLDivElement>(null);
  const plotSize = useContainerSize(plotContainerRef, 420);
  const xRange: [number, number] | undefined =
    region === "custom" ? [customMin, customMax] : FTIR_REGIONS[region];
  const visibleOverlays = useMemo(
    () =>
      props.overlays
        .filter((overlay) => overlay.session_id !== props.activeSessionId)
        .map((overlay) =>
          mode === "transmittance" ? { ...overlay, spectrum: { ...overlay.spectrum, y: toShown(overlay.spectrum.y) } } : overlay,
        ),
    [mode, props.activeSessionId, props.overlays, toShown],
  );
  const colorRows = useMemo(
    () => [
      { key: `sid:${props.activeSessionId}`, label: props.title, defaultColor: "#1e2636" },
      ...visibleOverlays.map((overlay, idx) => ({
        key: `sid:${overlay.session_id}`,
        label: overlay.display_name,
        defaultColor: OVERLAY_PALETTE[idx % OVERLAY_PALETTE.length],
      })),
    ],
    [props.activeSessionId, props.title, visibleOverlays],
  );

  const resolveTraceColor = useCallback(
    (key: string, fallback: string) => props.graphSettings.traceColors[key] ?? fallback,
    [props.graphSettings.traceColors],
  );

  const data: Data[] = useMemo(() => {
    if (!spectrum) return [];
    const activeColor = resolveTraceColor(`sid:${props.activeSessionId}`, "#1e2636");
    const overlayMode = props.graphSettings.overlayMode ?? "overlay";
    const yOffset = overlayMode === "offset" ? estimateYOffset([spectrum, ...visibleOverlays.map((o) => o.spectrum)]) : 0;
    // Canvas scatter (not WebGL scattergl): SVG/PNG snapshot omits scattergl lines in some layouts.
    const trace: Data = {
      type: "scatter",
      mode: "lines",
      x: spectrum.wn,
      y: spectrum.y,
      line: { color: themeTraceColor(activeColor, pt.theme), width: props.graphSettings.lineWidth },
      ...exportColorMeta(activeColor),
      name: props.title,
      hovertemplate: "%{x:.1f} cm⁻¹<br>%{y:.4g}<extra></extra>",
    };
    const overlayTraces: Data[] = visibleOverlays.map((overlay, idx) => ({
        type: "scatter",
        mode: "lines",
        x: overlay.spectrum.wn,
        y: overlayMode === "offset" ? overlay.spectrum.y.map((v) => v + yOffset * (idx + 1)) : overlay.spectrum.y,
        yaxis: overlayMode === "stacked" ? `y${idx + 2}` : "y",
        line: {
          width: props.graphSettings.lineWidth,
          color: resolveTraceColor(
            `sid:${overlay.session_id}`,
            OVERLAY_PALETTE[idx % OVERLAY_PALETTE.length],
          ),
        },
        name: overlayMode === "offset" ? `${overlay.display_name} +${idx + 1}` : overlay.display_name,
        hovertemplate: `${overlay.display_name}<br>%{x:.1f} cm⁻¹<br>%{y:.4g}<extra></extra>`,
        opacity: 0.72,
      }));
    const differenceTrace: Data[] = props.differenceSpectrum
      ? [
          {
            type: "scatter",
            mode: "lines",
            x: props.differenceSpectrum.wn,
            y: toShown(props.differenceSpectrum.y),
            line: { color: "#dc2626", width: Math.max(1.2, props.graphSettings.lineWidth), dash: "dot" },
            name: `difference k=${props.differenceSpectrum.k.toFixed(3)}`,
            hovertemplate: "difference<br>%{x:.1f} cmג»ֲ¹<br>%{y:.4g}<extra></extra>",
          },
        ]
      : [];
    const referenceTrace: Data[] = props.selectedReference
      ? [
          {
            type: "scatter",
            mode: "lines",
            x: props.selectedReference.reference.wn,
            y: props.selectedReference.reference.y,
            line: { color: "#0d9488", width: Math.max(1.2, props.graphSettings.lineWidth), dash: "dash" },
            name: `ref ${props.selectedReference.name}`,
            yaxis: "y2",
            hovertemplate: `${props.selectedReference.label}<br>%{x:.1f} cmג»ֲ¹<br>ref=%{y:.4g}<extra></extra>`,
            opacity: 0.85,
          },
        ]
      : [];
    const fitTraces: Data[] = props.fitResult
      ? [
          {
            type: "scatter",
            mode: "lines",
            x: props.fitResult.fit.wn,
            y: toShown(props.fitResult.fit.y),
            line: { color: "#7c3aed", width: Math.max(1.4, props.graphSettings.lineWidth), dash: "solid" },
            name: "fit total",
            hovertemplate: "fit total<br>%{x:.1f} cmג»ֲ¹<br>%{y:.4g}<extra></extra>",
          },
          ...props.fitResult.components.map((component, idx) => ({
            type: "scatter" as const,
            mode: "lines" as const,
            x: component.wn,
            y: toShown(component.y),
            line: {
              color: FIT_COMPONENT_COLORS[idx % FIT_COMPONENT_COLORS.length],
              width: Math.max(1, props.graphSettings.lineWidth),
              dash: "dash" as const,
            },
            name: `component ${component.index}`,
            hovertemplate: `component ${component.index}<br>%{x:.1f} cmג»ֲ¹<br>%{y:.4g}<extra></extra>`,
            opacity: 0.82,
          })),
        ]
      : [];
    const activePeaks = activePeaksShown;
    const markerTraces: Data[] = [];
    if (activePeaks.length > 0) {
      markerTraces.push({
      type: "scatter",
      mode: "markers",
      x: activePeaks.map((p) => p.wn),
      y: activePeaks.map((p) => p.y),
      text: activePeaks.map((p) => p.wn.toFixed(0)),
      textposition: mode === "transmittance" ? "bottom center" : "top center",
      textfont: { size: props.graphSettings.peakLabelSize, color: props.graphSettings.peakLabelColor },
      marker: { color: props.graphSettings.peakLabelColor, size: 7, symbol: mode === "transmittance" ? "triangle-up" : "triangle-down" },
      hovertemplate:
        "<b>%{customdata[0]}</b><br>conf %{customdata[1]}<br>%{x:.1f} cm⁻¹<br>I=%{y:.4g}<br>prom %{customdata[2]:.3g}<extra></extra>",
      customdata: activePeaks.map((p) => {
        const assignment = findAssignment(props.activeAssignments, p.wn);
        const top = assignment?.candidates?.[0];
        return [resolvedPeakLabel(props.activeSessionId, p, props.activeAssignments, props.labelEdits) ?? p.wn.toFixed(0), top?.score?.toFixed(0) ?? "-", p.prominence];
      }),
      name: "peaks",
    });
    }
    for (const [idx, overlay] of visibleOverlays.entries()) {
      const overlayPeaks = overlayPeaksShown[overlay.session_id] ?? [];
      if (overlayPeaks.length === 0) continue;
      const color = resolveTraceColor(`sid:${overlay.session_id}`, OVERLAY_PALETTE[idx % OVERLAY_PALETTE.length]);
      markerTraces.push({
        type: "scatter",
        mode: "markers",
        x: overlayPeaks.map((p) => p.wn),
        y: overlayPeaks.map((p) => overlayMode === "offset" ? p.y + yOffset * (idx + 1) : p.y),
        yaxis: overlayMode === "stacked" ? `y${idx + 2}` : "y",
        text: overlayPeaks.map((_, idx) => String(idx + 1)),
        textposition: "top center",
        textfont: { size: Math.max(6, props.graphSettings.peakLabelSize - 1), color },
        marker: { color, size: 6, symbol: "circle-open" },
        hovertemplate:
          `${overlay.display_name} peak #%{text}: %{x:.1f} cm⁻¹<br>y: %{y:.4g}<br>prom: %{customdata:.3g}<extra></extra>`,
        customdata: overlayPeaks.map((p) => p.prominence),
        name: `${overlay.display_name} peaks`,
      });
    }
    const secondDerivativeTrace: Data[] =
      props.showSecondDerivative && spectrum?.inverted_second_derivative
        ? [
            {
              type: "scatter",
              mode: "lines",
              x: spectrum.wn,
              y: spectrum.inverted_second_derivative,
              line: { color: "#8b5cf6", width: 1.3, dash: "dot" },
              yaxis: "y2",
              name: "Inverted 2nd Deriv (-d²A/dν²)",
              hovertemplate: "2nd Deriv<br>%{x:.1f} cm⁻¹<br>-d²A/dν²: %{y:.4g}<extra></extra>",
              opacity: 0.85,
            },
          ]
        : [];
    const baselineTrace: Data[] =
      props.showBaselineCurve && spectrum?.baseline
        ? [
            {
              type: "scatter",
              mode: "lines",
              x: spectrum.wn,
              y: spectrum.baseline,
              line: { color: "#d97706", width: 1.3, dash: "dash" },
              name: "Subtracted Baseline",
              hovertemplate: "Baseline<br>%{x:.1f} cm⁻¹<br>%{y:.4g}<extra></extra>",
              opacity: 0.8,
            },
          ]
        : [];
    return [trace, ...baselineTrace, ...secondDerivativeTrace, ...overlayTraces, ...differenceTrace, ...referenceTrace, ...fitTraces, ...markerTraces];
  }, [
    spectrum,
    props.differenceSpectrum,
    props.fitResult,
    props.selectedReference,
    props.showSecondDerivative,
    props.showBaselineCurve,
    props.title,
    visibleOverlays,
    props.graphSettings.lineWidth,
    props.graphSettings.peakLabelColor,
    props.graphSettings.peakLabelSize,
    props.graphSettings.overlayMode,
    props.activeSessionId,
    props.activeAssignments,
    props.labelEdits,
    activePeaksShown,
    overlayPeaksShown,
    mode,
    toShown,
    resolveTraceColor,
  ]);

  const annotationSpecs = useMemo(() => {
    const items: Array<{ key: string; annotation: Record<string, unknown> }> = [];
    for (const peak of activePeaksShown) {
      const key = peakLabelKey(props.activeSessionId, peak.wn);
      const text = resolvedPeakLabel(props.activeSessionId, peak, props.activeAssignments, props.labelEdits);
      if (!text) continue;
      const edit = props.labelEdits[key];
      items.push({
        key,
        annotation: {
          x: peak.wn,
          y: peak.y,
          text,
          showarrow: true,
          arrowhead: 1,
          arrowwidth: 1,
          arrowcolor: props.graphSettings.peakLabelColor,
          ax: edit?.ax ?? 0,
          ay: edit?.ay ?? labelAy,
          bgcolor: pt.legendBg,
          bordercolor: props.graphSettings.peakLabelColor,
          borderpad: 2,
          font: { size: props.graphSettings.peakLabelSize, color: props.graphSettings.peakLabelColor },
        },
      });
    }
    const overlayMode = props.graphSettings.overlayMode ?? "overlay";
    const yOffset = overlayMode === "offset" && spectrum
      ? estimateYOffset([spectrum, ...visibleOverlays.map((o) => o.spectrum)])
      : 0;
    for (const [idx, overlay] of visibleOverlays.entries()) {
      const overlayPeaks = overlayPeaksShown[overlay.session_id] ?? [];
      const assignments = props.assignmentsBySession[overlay.session_id] ?? null;
      const color = resolveTraceColor(`sid:${overlay.session_id}`, OVERLAY_PALETTE[idx % OVERLAY_PALETTE.length]);
      for (const peak of overlayPeaks) {
        const key = peakLabelKey(overlay.session_id, peak.wn);
        const text = resolvedPeakLabel(overlay.session_id, peak, assignments, props.labelEdits);
        if (!text) continue;
        const edit = props.labelEdits[key];
        items.push({
          key,
          annotation: {
            x: peak.wn,
            y: overlayMode === "offset" ? peak.y + yOffset * (idx + 1) : peak.y,
            yref: overlayMode === "stacked" ? `y${idx + 2}` : "y",
            text,
            showarrow: true,
            arrowhead: 1,
            arrowwidth: 1,
            arrowcolor: color,
            ax: edit?.ax ?? 0,
            ay: edit?.ay ?? (labelAy > 0 ? 24 : -24),
            bgcolor: pt.legendBg,
            bordercolor: color,
            borderpad: 2,
            font: { size: Math.max(6, props.graphSettings.peakLabelSize - 1), color },
          },
        });
      }
    }
    return items;
  }, [
    props.activeAssignments,
    activePeaksShown,
    labelAy,
    props.activeSessionId,
    props.assignmentsBySession,
    props.graphSettings.overlayMode,
    props.graphSettings.peakLabelColor,
    props.graphSettings.peakLabelSize,
    props.labelEdits,
    overlayPeaksShown,
    pt.legendBg,
    resolveTraceColor,
    spectrum,
    visibleOverlays,
  ]);

  const handleRelayout = useCallback(
    (event: Readonly<Record<string, unknown>>) => {
      annotationSpecs.forEach((item, index) => {
        const patch: FTIRLabelEdit = {};
        const ax = event[`annotations[${index}].ax`];
        const ay = event[`annotations[${index}].ay`];
        if (typeof ax === "number" && Number.isFinite(ax)) patch.ax = ax;
        if (typeof ay === "number" && Number.isFinite(ay)) patch.ay = ay;
        if (Object.keys(patch).length > 0) props.onLabelEdit(item.key, patch);
      });
    },
    [annotationSpecs, props.onLabelEdit],
  );

  const axisFrameProps = useMemo(() => {
    if (props.graphSettings.frame === "none") {
      return { showline: false, mirror: false as const };
    }
    if (props.graphSettings.frame === "full") {
      return { showline: true, mirror: true as const };
    }
    return { showline: true, mirror: false as const };
  }, [props.graphSettings.frame]);

  const atmosphericShapes = useMemo(
    () =>
      (spectrum?.atmospheric_regions ?? []).map((region) => ({
        type: "rect" as const,
        xref: "x" as const,
        yref: "paper" as const,
        x0: region.lo,
        x1: region.hi,
        y0: 0,
        y1: 1,
        fillcolor: "rgba(148, 163, 184, 0.16)",
        line: { width: 0 },
        layer: "below" as const,
      })),
    [spectrum?.atmospheric_regions],
  );

  const integrationShape = useMemo(() => {
    const lo = Math.min(props.integrationRegion.lo, props.integrationRegion.hi);
    const hi = Math.max(props.integrationRegion.lo, props.integrationRegion.hi);
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo === hi) return [];
    return [
      {
        type: "rect" as const,
        xref: "x" as const,
        yref: "paper" as const,
        x0: lo,
        x1: hi,
        y0: 0,
        y1: 1,
        fillcolor: "rgba(37, 99, 235, 0.10)",
        line: { width: 0 },
        layer: "below" as const,
      },
    ];
  }, [props.integrationRegion.hi, props.integrationRegion.lo]);

  const groupRegionShapes = useMemo(
    () =>
      props.graphSettings.showGroupRegions
        ? GROUP_FREQUENCY_REGIONS.map((r) => ({
            type: "rect" as const,
            xref: "x" as const,
            yref: "paper" as const,
            x0: r.lo,
            x1: r.hi,
            y0: 0,
            y1: 1,
            fillcolor: r.color,
            line: { width: 0 },
            layer: "below" as const,
          }))
        : [],
    [props.graphSettings.showGroupRegions],
  );

  const layout: Partial<Layout> = useMemo(
    () => {
      const axisTitleSize = props.graphSettings.axisTitleSize;
      const axisTickSize = props.graphSettings.axisTickSize;
      const axisTitleStandoff = Math.max(8, Math.round(axisTickSize * 0.8));
      const bottomMargin = Math.max(45, Math.round(20 + axisTickSize * 1.5 + axisTitleSize * 1.6));
      const leftMargin = Math.max(65, Math.round(34 + axisTickSize * 1.8 + axisTitleSize * 1.2));
      const stackedAxes = buildStackedAxes(
        props.graphSettings.overlayMode ?? "overlay",
        visibleOverlays.length,
        pt.fontColor,
        props.graphSettings.showGrid,
        axisTitleSize,
        axisTickSize,
      );
      return ({
      margin: { l: leftMargin, r: 20, t: props.title ? 28 : 12, b: bottomMargin },
      height: 420,
      xaxis: {
        titlefont: { size: props.graphSettings.axisTitleSize },
        tickfont: { size: props.graphSettings.axisTickSize },
        title: { text: "Wavenumber (cm\u207b\u00b9)", font: { size: axisTitleSize }, standoff: axisTitleStandoff },
        autorange: xRange ? false : "reversed",
        range: xRange ? [xRange[1], xRange[0]] : undefined,
        zeroline: false,
        showgrid: props.graphSettings.showGrid,
        ticks: props.graphSettings.showTicks ? "outside" : "",
        linecolor: pt.fontColor,
        automargin: true,
        ...axisFrameProps,
      },
      yaxis: {
        titlefont: { size: props.graphSettings.axisTitleSize },
        tickfont: { size: props.graphSettings.axisTickSize },
        title: {
          text: mode === "absorbance" ? "Absorbance" : "Transmittance (%)",
          font: { size: axisTitleSize },
          standoff: axisTitleStandoff,
        },
        zeroline: false,
        showgrid: props.graphSettings.showGrid,
        ticks: props.graphSettings.showTicks ? "outside" : "",
        linecolor: pt.fontColor,
        automargin: true,
        ...axisFrameProps,
      },
      yaxis2: {
        overlaying: "y",
        side: "right",
        showgrid: false,
        zeroline: false,
        showticklabels: false,
      },
      ...stackedAxes,
      showlegend: props.overlays.length > 1,
      shapes: [...groupRegionShapes, ...atmosphericShapes, ...integrationShape],
      annotations: annotationSpecs.map((item) => item.annotation),
      font: { color: pt.screenFontColor },
      plot_bgcolor: pt.plot_bgcolor,
      paper_bgcolor: pt.paper_bgcolor,
      colorway: pt.colorway,
    });
    },
    [
      annotationSpecs,
      atmosphericShapes,
      groupRegionShapes,
      integrationShape,
      axisFrameProps,
      mode,
      props.graphSettings.axisTickSize,
      props.graphSettings.axisTitleSize,
      props.graphSettings.showGrid,
      props.graphSettings.overlayMode,
      props.graphSettings.showTicks,
      props.overlays.length,
      pt.plot_bgcolor,
      pt.paper_bgcolor,
      pt.fontColor,
      pt.colorway,
      pt.screenFontColor,
      xRange,
    ],
  );

  const exportPlotImagePaper = useCallback(
    (format: PublicationExportFormat, exportSettings: PublicationExportSettings) => {
      const gd = plotRef.current;
      if (!gd) return;
      const base = sanitizeFilenamePart(props.title, "ftir");
      void exportPlotlyPublicationImage(gd as never, {
        format,
        filename: `${base}_ftir_spectrum_${publicationFilenameSuffix(exportSettings, format)}`,
        ...exportSettings,
      }, {
        layoutOverrides: {
          margin: { l: 58, r: 18, t: props.graphSettings.overlayMode === "stacked" ? 18 : 12, b: 46 },
          font: { family: "Arial, Helvetica, sans-serif", size: 9, color: "#111827" },
          showlegend: props.overlays.length > 1,
        },
      });
    },
    [props.graphSettings.overlayMode, props.overlays.length, props.title],
  );

  return (
    <div className="card shrink-0 p-3">
      <div className="px-1 pb-1.5">
        <ChartCardTitle
          title="Spectrum"
          status={[
            spectrum && `${spectrum.wn.length.toLocaleString()} points`,
            props.overlays.length > 0 && `${props.overlays.length} overlay${props.overlays.length === 1 ? "" : "s"}`,
            props.activePeaks.length > 0 && `${props.activePeaks.length} peaks`,
            region !== "full" && `region: ${region}`,
          ]}
        />
      </div>

      {/* Tier 2: Action Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ink-100/80 px-1 py-1.5">
        {/* Left Cluster: Derivatives, Baseline & Region */}
        <div className="flex flex-wrap items-center gap-1.5">
          {props.peakTool}
          <Hint id="ftir.secondDerivative">
            <ToolbarButton
              icon={Activity}
              label="2nd derivative"
              active={props.showSecondDerivative}
              onClick={() => props.setShowSecondDerivative((prev) => !prev)}
            />
          </Hint>
          <Hint id="ftir.showBaseline">
            <ToolbarButton
              icon={Spline}
              label="Baseline"
              active={props.showBaselineCurve}
              onClick={() => props.setShowBaselineCurve((prev) => !prev)}
            />
          </Hint>

          <Hint id="ftir.region">
            <div className="flex items-center gap-1.5 pl-1">
              <span className="text-caption">Region</span>
              <select
                aria-label="Wavenumber region"
                className="input py-1"
                value={region}
                onChange={(e) => setRegion(e.target.value as FTIRRegion)}
              >
                <option value="full">Full (400–4000 cm⁻¹)</option>
                <option value="fingerprint">Fingerprint (400–1500)</option>
                <option value="functional">Functional groups (1500–4000)</option>
                <option value="amide">Amide I & II (1500–1750)</option>
                <option value="custom">Custom…</option>
              </select>
              {region === "custom" && (
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    className="input w-16 py-1 text-xs"
                    value={customMin}
                    onChange={(e) => setCustomMin(Number(e.target.value) || 400)}
                    placeholder="min"
                  />
                  <span className="text-xs text-ink-500">–</span>
                  <input
                    type="number"
                    className="input w-16 py-1 text-xs"
                    value={customMax}
                    onChange={(e) => setCustomMax(Number(e.target.value) || 4000)}
                    placeholder="max"
                  />
                </div>
              )}
            </div>
          </Hint>
        </div>

        {/* Right Cluster: Graph Settings & Export */}
        <div className="flex items-center gap-1.5 shrink-0">
          <Hint id="ftir.design">
            <ToolbarButton
              icon={Palette}
              label="Design"
              active={showGraphSettings}
              onClick={() => setShowGraphSettings((prev) => !prev)}
            />
          </Hint>
          <PaperFigureExportToolbar disabled={!spectrum} onExport={exportPlotImagePaper} />
        </div>
      </div>
      {showGraphSettings && (
        <div className="mb-3 grid gap-3 rounded-md border border-ink-200 bg-ink-50/50 p-3 md:grid-cols-2 xl:grid-cols-4">
          <Field hint="ftir.lineWidth" label="Line width">
            <input
              type="number"
              min={0.5}
              max={8}
              step={0.1}
              className="input w-full"
              value={props.graphSettings.lineWidth}
              onChange={(e) =>
                props.setGraphSettings({
                  ...props.graphSettings,
                  lineWidth: Math.max(0.5, Math.min(8, Number(e.target.value) || 1.4)),
                })
              }
            />
          </Field>
          <Field hint="ftir.frame" label="Frame">
            <select
              className="input w-full"
              value={props.graphSettings.frame}
              onChange={(e) =>
                props.setGraphSettings({
                  ...props.graphSettings,
                  frame: e.target.value as PlotFrameMode,
                })
              }
            >
              <option value="none">No frame</option>
              <option value="half">Half frame</option>
              <option value="full">Full frame</option>
            </select>
          </Field>
          <Field hint="ftir.ticks" label="Show ticks">
            <label className="flex min-h-9 items-center gap-2 rounded-md border border-ink-200 bg-surface px-2 py-1 text-[13px]">
              <input
                type="checkbox"
                checked={props.graphSettings.showTicks}
                onChange={(e) =>
                  props.setGraphSettings({
                    ...props.graphSettings,
                    showTicks: e.target.checked,
                  })
                }
              />
              Enable axis ticks
            </label>
          </Field>
          <Field hint="ftir.grid" label="Show grid">
            <label className="flex min-h-9 items-center gap-2 rounded-md border border-ink-200 bg-surface px-2 py-1 text-[13px]">
              <input
                type="checkbox"
                checked={props.graphSettings.showGrid}
                onChange={(e) =>
                  props.setGraphSettings({
                    ...props.graphSettings,
                    showGrid: e.target.checked,
                  })
                }
              />
              Enable gridlines
            </label>
          </Field>
          <Field hint="ftir.groupRegions" label="Group regions">
            <label className="flex min-h-9 items-center gap-2 rounded-md border border-ink-200 bg-surface px-2 py-1 text-[13px]">
              <input
                type="checkbox"
                checked={Boolean(props.graphSettings.showGroupRegions)}
                onChange={(e) =>
                  props.setGraphSettings({
                    ...props.graphSettings,
                    showGroupRegions: e.target.checked,
                  })
                }
              />
              Show regions
            </label>
          </Field>
          <Field hint="ftir.labelColor" label="Peak label color">
            <input
              type="color"
              className="h-9 w-full cursor-pointer rounded-md border border-ink-200 bg-surface px-2"
              value={props.graphSettings.peakLabelColor}
              onChange={(e) =>
                props.setGraphSettings({
                  ...props.graphSettings,
                  peakLabelColor: e.target.value,
                })
              }
            />
          </Field>
          <Field hint="ftir.labelSize" label="Peak label size">
            <input
              type="number"
              min={6}
              max={28}
              step={1}
              className="input w-full"
              value={props.graphSettings.peakLabelSize}
              onChange={(e) =>
                props.setGraphSettings({
                  ...props.graphSettings,
                  peakLabelSize: Math.max(6, Math.min(28, Number(e.target.value) || DEFAULT_GRAPH_SETTINGS.peakLabelSize)),
                })
              }
            />
          </Field>
          <Field hint="ftir.axisTitleSize" label="Axis title size">
            <input
              type="number"
              min={8}
              max={28}
              step={1}
              className="input w-full"
              value={props.graphSettings.axisTitleSize}
              onChange={(e) =>
                props.setGraphSettings({
                  ...props.graphSettings,
                  axisTitleSize: Math.max(8, Math.min(28, Number(e.target.value) || DEFAULT_GRAPH_SETTINGS.axisTitleSize)),
                })
              }
            />
          </Field>
          <Field hint="ftir.axisTickSize" label="Axis tick size">
            <input
              type="number"
              min={8}
              max={24}
              step={1}
              className="input w-full"
              value={props.graphSettings.axisTickSize}
              onChange={(e) =>
                props.setGraphSettings({
                  ...props.graphSettings,
                  axisTickSize: Math.max(8, Math.min(24, Number(e.target.value) || DEFAULT_GRAPH_SETTINGS.axisTickSize)),
                })
              }
            />
          </Field>
          <Hint id="ftir.traceColors" className="w-full">
            <div className="md:col-span-2 xl:col-span-4">
              <div className="label mb-1">Trace colors</div>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {colorRows.map((row) => (
                  <label
                    key={row.key}
                    className="flex items-center justify-between gap-2 rounded-md border border-ink-200 bg-surface px-2 py-1.5 text-xs"
                  >
                    <span className="truncate">{row.label}</span>
                    <input
                      type="color"
                      value={resolveTraceColor(row.key, row.defaultColor)}
                      onChange={(event) =>
                        props.setGraphSettings({
                          ...props.graphSettings,
                          traceColors: {
                            ...props.graphSettings.traceColors,
                            [row.key]: event.target.value,
                          },
                        })
                      }
                    />
                  </label>
                ))}
              </div>
            </div>
          </Hint>
        </div>
      )}
      {!spectrum ? (
        <div className="flex h-64 items-center justify-center text-sm text-ink-500">
          Loading spectrum…
        </div>
      ) : (
        <div ref={plotContainerRef} className="min-w-0" style={{ height: 420 }}>
        <Plot
          data={data}
          layout={{ ...layout, width: plotSize.width, height: plotSize.height }}
          revision={plotSize.revision}
          useResizeHandler
          style={{ width: "100%", height: "100%" }}
          config={{
            displaylogo: false,
            responsive: true,
            editable: true,
            edits: {
              annotationPosition: true,
              annotationText: false,
              axisTitleText: false,
              titleText: false,
            },
          }}
          onRelayout={(event) => handleRelayout(event as Readonly<Record<string, unknown>>)}
          onClick={(event) => {
            if (props.peakEditMode === "none") return;
            const point = event.points?.[0];
            const x = Number(point?.x);
            const y = Number(point?.y);
            if (Number.isFinite(x) && Number.isFinite(y)) props.onChartPeakEdit(x, fromDisplayY(y, mode));
          }}
          onInitialized={(_, graphDiv) => {
            plotRef.current = graphDiv;
          }}
          onUpdate={(_, graphDiv) => {
            plotRef.current = graphDiv;
          }}
        />
        </div>
      )}
    </div>
  );
}

function PeaksTable(props: {
  sessionId: string;
  title?: string;
  peaks: FTIRPeak[];
  assignments: FTIRAssignment[] | null;
  labelEdits: FTIRLabelEdits;
  onLabelEdit: (key: string, patch: FTIRLabelEdit) => void;
  mode: FTIRYMode;
}) {
  const { peaks, assignments } = props;
  const [showLowConf, setShowLowConf] = useState(true);
  const [copied, setCopied] = useState(false);
  const [sortKey, setSortKey] = useState<PeakSortKey>("wn");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [filterText, setFilterText] = useState("");

  const assignmentsByWn = useMemo(() => {
    const m = new Map<number, FTIRAssignment>();
    for (const a of assignments ?? []) m.set(a.wn, a);
    return m;
  }, [assignments]);

  const visiblePeaks = useMemo(() => {
    const filtered = peaks.filter((p) => {
      const top = assignmentsByWn.get(p.wn)?.candidates?.[0];
      const textOk = !filterText.trim() || (top?.label ?? "").toLowerCase().includes(filterText.trim().toLowerCase());
      const confOk = showLowConf || !assignments || top == null || top.score >= 40;
      return textOk && confOk;
    });
    return [...filtered].sort((a, b) => {
      const topA = assignmentsByWn.get(a.wn)?.candidates?.[0]?.score ?? -Infinity;
      const topB = assignmentsByWn.get(b.wn)?.candidates?.[0]?.score ?? -Infinity;
      const av = sortKey === "score" ? topA : sortKey === "y" ? displayY(a.y, props.mode) : Number(a[sortKey]);
      const bv = sortKey === "score" ? topB : sortKey === "y" ? displayY(b.y, props.mode) : Number(b[sortKey]);
      return (av - bv) * (sortDir === "asc" ? 1 : -1);
    });
  }, [peaks, assignments, assignmentsByWn, showLowConf, filterText, sortKey, sortDir, props.mode]);

  const copyCSV = () => {
    const esc = (v: string | number | null | undefined) => {
      const t = v == null ? "" : String(v);
      return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    };
    const rows = [
      ["wn", "y", "prominence", "width_cm1", "top_assignment", "score", "selected_band_id", "plot_label", "label_hidden"],
      ...peaks.map((p) => {
        const top = assignmentsByWn.get(p.wn)?.candidates?.[0];
        const edit = props.labelEdits[peakLabelKey(props.sessionId, p.wn)];
        return [
          p.wn,
          displayY(p.y, props.mode),
          p.prominence,
          p.width_cm1 ?? "",
          top?.label ?? "",
          top?.score ?? "",
          edit?.bandId ?? "",
          edit?.text ?? "",
          edit?.hidden ? "true" : "",
        ];
      }),
    ];
    void navigator.clipboard.writeText(rows.map((r) => r.map(esc).join(",")).join("\n")).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="card shrink-0">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-200 px-4 py-2">
        <h3 className="text-sm font-semibold">
          Peaks
          {props.title ? <span className="ml-1 text-xs font-normal text-ink-500">{props.title}</span> : null}
          <span className="ml-1 text-xs font-normal text-ink-500">({visiblePeaks.length}/{peaks.length})</span>
        </h3>
        <div className="flex items-center gap-2">
          {assignments && (
            <Hint id="ftir.peakFilter">
              <input
                className="input h-7 w-44 py-0.5 text-xs"
                placeholder="Filter assignment"
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
              />
            </Hint>
          )}
          {assignments && (
            <Hint id="ftir.lowConf">
              <label className="flex cursor-pointer items-center gap-1.5 text-xs text-ink-600">
                <input
                  type="checkbox"
                  checked={showLowConf}
                  onChange={(e) => setShowLowConf(e.target.checked)}
                />
                Show low-confidence
              </label>
            </Hint>
          )}
          <Hint id="ftir.copyCsv">
            <button className="btn-ghost border border-ink-200 px-2 py-0.5 text-xs" onClick={copyCSV}>
              {copied ? "✓ Copied" : "Copy CSV"}
            </button>
          </Hint>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full border-separate border-spacing-0 text-xs">
          <thead className="bg-surface">
            <tr>
              <Th>#</Th>
              <Th align="right">Wavenumber (cm⁻¹)</Th>
              <Th align="right"><SortButton label={props.mode === "transmittance" ? "%T" : "Y"} field="y" sortKey={sortKey} sortDir={sortDir} setSortKey={setSortKey} setSortDir={setSortDir} /></Th>
              <Th align="right"><SortButton label="Prominence" field="prominence" sortKey={sortKey} sortDir={sortDir} setSortKey={setSortKey} setSortDir={setSortDir} /></Th>
              <Th align="right">Width (cm⁻¹)</Th>
              {assignments && <Th>Top candidate</Th>}
              {assignments && <Th>
                <Hint id="ftir.labelChoice" placement="bottom">Label source</Hint>
              </Th>}
              <Th>
                <Hint id="ftir.labelText" placement="bottom">Plot label</Hint>
              </Th>
              <Th>
                <Hint id="ftir.hideLabel" placement="bottom">Hide label</Hint>
              </Th>
              {assignments && <Th align="right"><SortButton label="Score" field="score" sortKey={sortKey} sortDir={sortDir} setSortKey={setSortKey} setSortDir={setSortDir} /></Th>}
              {assignments && <Th>Alternates</Th>}
            </tr>
          </thead>
          <tbody>
            {visiblePeaks.map((p, i) => {
              const a = assignmentsByWn.get(p.wn);
              const top = a?.candidates?.[0];
              const alts = a?.candidates?.slice(1) ?? [];
              const labelKey = peakLabelKey(props.sessionId, p.wn);
              const edit = props.labelEdits[labelKey] ?? {};
              const defaultLabel = top?.label ?? p.wn.toFixed(0);
              return (
                <tr key={i} className="odd:bg-ink-50/40">
                  <Td>{i + 1}</Td>
                  <Td align="right">{p.wn.toFixed(1)}</Td>
                  <Td align="right">{formatNumber(displayY(p.y, props.mode))}</Td>
                  <Td align="right">{formatNumber(p.prominence)}</Td>
                  <Td align="right">
                    {p.width_cm1 == null ? "—" : p.width_cm1.toFixed(1)}
                  </Td>
                  {assignments && (
                    <Td>
                      <div className="flex flex-col">
                        <span className="font-medium">{top?.label ?? "—"}</span>
                        {top && (
                          <span className="text-[12px] text-ink-500">
                            {top.reasons.slice(0, 2).join(" · ")}
                          </span>
                        )}
                      </div>
                    </Td>
                  )}
                  {assignments && (
                    <Td>
                      <select
                        className="input w-52 py-1 text-xs"
                        value={edit.hidden ? "__hidden" : edit.bandId ?? "__auto"}
                        onChange={(event) => {
                          const value = event.target.value;
                          if (value === "__hidden") {
                            props.onLabelEdit(labelKey, { hidden: true, text: "", bandId: null });
                          } else if (value === "__auto") {
                            props.onLabelEdit(labelKey, { hidden: false, text: "", bandId: null });
                          } else {
                            props.onLabelEdit(labelKey, { hidden: false, text: "", bandId: value });
                          }
                        }}
                      >
                        <option value="__auto">Auto: {defaultLabel}</option>
                        {a?.candidates?.map((candidate) => {
                          const bandId = candidate.band_id ?? candidate.id;
                          return (
                            <option key={bandId} value={bandId}>
                              {candidate.label} ({candidate.score.toFixed(0)})
                            </option>
                          );
                        })}
                        <option value="__hidden">Hidden</option>
                      </select>
                    </Td>
                  )}
                  <Td>
                    <input
                      className="input w-48 py-1 text-xs"
                      value={edit.text ?? ""}
                      placeholder={defaultLabel}
                      onChange={(event) =>
                        props.onLabelEdit(labelKey, { text: event.target.value, hidden: false, bandId: null })
                      }
                    />
                  </Td>
                  <Td>
                    <input
                      type="checkbox"
                      checked={Boolean(edit.hidden)}
                      onChange={(event) =>
                        props.onLabelEdit(labelKey, { hidden: event.target.checked })
                      }
                    />
                  </Td>
                  {assignments && (
                    <Td align="right">
                      {top ? (
                        <span
                          className={clsx(
                            "inline-block rounded px-1.5 py-0.5 text-[12px] font-semibold",
                            top.score >= 70
                              ? "bg-success-surface text-success-fg"
                              : top.score >= 40
                                ? "bg-warning-surface text-warning-fg"
                                : "bg-ink-100 text-ink-600",
                          )}
                        >
                          {top.score.toFixed(0)}
                        </span>
                      ) : (
                        "—"
                      )}
                    </Td>
                  )}
                  {assignments && (
                    <Td>
                      {alts.length === 0 ? (
                        <span className="text-ink-500">—</span>
                      ) : (
                        <div className="flex flex-col gap-0.5">
                          {alts.map((c) => (
                            <span key={c.id} className="text-[12px]">
                              {c.label}{" "}
                              <span className="text-ink-500">({c.score.toFixed(0)})</span>
                            </span>
                          ))}
                        </div>
                      )}
                    </Td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PeakTablesTabs(props: {
  sessions: Array<{ session_id: string; display_name: string }>;
  activeSid: string;
  peaksBySession: Record<string, FTIRPeak[]>;
  onSelect: (sid: string) => void;
  children: ReactNode;
}) {
  if (props.sessions.length <= 1) return <>{props.children}</>;
  return (
    <div className="flex shrink-0 flex-col gap-2">
      <div className="flex flex-wrap gap-1 border-b border-ink-200">
        {props.sessions.map((session) => {
          const active = session.session_id === props.activeSid;
          const count = props.peaksBySession[session.session_id]?.length ?? 0;
          return (
            <button
              key={session.session_id}
              type="button"
              className={clsx(
                "rounded-t-md border border-b-0 px-3 py-1.5 text-xs font-medium",
                active
                  ? "border-ink-300 bg-surface text-ink-900"
                  : "border-transparent text-ink-500 hover:bg-ink-50 hover:text-ink-800",
              )}
              onClick={() => props.onSelect(session.session_id)}
            >
              <span className="max-w-[16rem] truncate align-bottom">{session.display_name}</span>
              <span className="ml-1 text-ink-500">({count})</span>
            </button>
          );
        })}
      </div>
      {props.children}
    </div>
  );
}

// ------------------------------ tiny UI utils ------------------------------

const OVERLAY_PALETTE = [
  "#0ea5e9",
  "#16a34a",
  "#ea580c",
  "#7c3aed",
  "#e11d48",
  "#0891b2",
];

function Field(props: { label: string; children: React.ReactNode; className?: string; hint?: string }) {
  const field = (
    <div className={clsx("min-w-0", props.hint && "flex-1", props.className)}>
      <div className="label">{props.label}</div>
      {props.children}
    </div>
  );
  return props.hint ? (
    <Hint id={props.hint} className="min-w-0 w-full">
      {field}
    </Hint>
  ) : (
    field
  );
}

function Th(props: { children: React.ReactNode; align?: "left" | "right" }) {
  return (
    <th
      className={clsx(
        "border-b border-ink-200 bg-ink-50 px-2 py-1.5 font-medium text-ink-600",
        props.align === "right" ? "text-right" : "text-left",
      )}
    >
      {props.children}
    </th>
  );
}

function Td(props: { children: React.ReactNode; align?: "left" | "right" }) {
  return (
    <td
      className={clsx(
        "border-b border-ink-100 px-2 py-1",
        props.align === "right" ? "text-right tabular-nums" : "text-left",
      )}
    >
      {props.children}
    </td>
  );
}

function formatRange(a: number | null, b: number | null) {
  if (a == null || b == null) return "—";
  return `${a.toFixed(1)}–${b.toFixed(1)}`;
}

function formatNumber(v: number) {
  if (!Number.isFinite(v)) return "—";
  if (Math.abs(v) >= 1000 || (Math.abs(v) > 0 && Math.abs(v) < 0.001)) {
    return v.toExponential(3);
  }
  return v.toFixed(4);
}

function clampInt(raw: string, lo: number, hi: number) {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}
