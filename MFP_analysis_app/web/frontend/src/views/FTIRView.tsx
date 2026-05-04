import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Plot from "react-plotly.js";
import Plotly from "plotly.js-dist-min";
import type { Data, Layout } from "plotly.js";
import clsx from "clsx";
import { useLocation } from "react-router-dom";
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
import { HelpOpenButton, HelpShell } from "../help/HelpShell";
import { getHelpModule } from "../help/registry";
import { usePlotlyTheme } from "../theme/ThemeProvider";
import { AlertBanner } from "../components/AlertBanner";
import { Tooltip } from "../components/Tooltip";

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
  mode: "transmittance",
  smoothing_window: 0,
  poly_order: 2,
  baseline: "none",
  normalize: "none",
  baseline_lambda: 100000,
  baseline_p: 0.01,
  mask_atmospheric: false,
  atr_correction: false,
  atr_n_crystal: 1.5,
};

const FTIR_PRESETS: Record<string, Partial<FTIRPreprocessOptions>> = {
  "KBr disc": { mode: "transmittance", smoothing_window: 5, poly_order: 2, baseline: "asls", normalize: "max", baseline_lambda: 100000, baseline_p: 0.01, mask_atmospheric: true },
  "ATR sample": { mode: "absorbance", smoothing_window: 5, poly_order: 2, baseline: "rubberband", normalize: "vector", atr_correction: true, atr_n_crystal: 1.5 },
  "Polymer thin film": { mode: "absorbance", smoothing_window: 5, poly_order: 2, baseline: "airpls", normalize: "snv", mask_atmospheric: true },
  "Raw film": { mode: "absorbance", smoothing_window: 0, poly_order: 2, baseline: "none", normalize: "none" },
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

function estimateYOffset(spectra: FTIRSpectrumResponse[]): number {
  const ranges = spectra.map((s) => {
    const min = Math.min(...s.y);
    const max = Math.max(...s.y);
    return Number.isFinite(max - min) ? max - min : 0;
  });
  return Math.max(...ranges, 1) * 1.15;
}

function buildStackedAxes(mode: GraphSettings["overlayMode"], count: number, color: string, showGrid: boolean): Partial<Layout> {
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
      title: i === 0 ? { text: "Active" } : undefined,
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
  const [sessions, setSessions] = useState<FTIRSessionSummary[]>([]);
  const [activeSid, setActiveSid] = useStoredState<string | null>(
    `${FTIR_STORAGE_PREFIX}.activeSessionId`,
    null,
    (value) => (typeof value === "string" ? value : null),
  );
  const [pre, setPre] = useStoredState<FTIRPreprocessOptions>(
    `${FTIR_STORAGE_PREFIX}.preprocess`,
    DEFAULT_PRE,
    (value) => ({ ...DEFAULT_PRE, ...value }),
  );
  const [pk, setPk] = useStoredState<PeakPickOptions>(
    `${FTIR_STORAGE_PREFIX}.peakPick`,
    DEFAULT_PEAK,
    (value) => ({ ...DEFAULT_PEAK, ...value }),
  );
  const [spectrum, setSpectrum] = useState<FTIRSpectrumResponse | null>(null);
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
  const [manualPeakEdits, setManualPeakEdits] = useState<Record<string, ManualPeakEdits>>({});
  const [peakEditMode, setPeakEditMode] = useState<PeakEditMode>("none");
  const [activePeakTableSid, setActivePeakTableSid] = useState<string | null>(null);
  const [labelEdits, setLabelEdits] = useState<FTIRLabelEdits>({});
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

  const location = useLocation();
  const [helpOpen, setHelpOpen] = useState(false);
  const helpModule = useMemo(() => getHelpModule(location.pathname), [location.pathname]);

  const active = useMemo(
    () => sessions.find((s) => s.session_id === activeSid) ?? null,
    [sessions, activeSid],
  );

  useEffect(() => {
    api.ftir.list().then(setSessions).catch((e) => setError(String(e)));
    api.ftir.library().then(setLibMeta).catch(() => undefined);
    api.ftir.libraryCategories().then(setLibraryCategories).catch(() => undefined);
  }, []);

  // Retry library categories if the initial fetch failed (e.g. backend not ready on mount).
  useEffect(() => {
    if (libraryCategories !== null) return;
    api.ftir.libraryCategories().then(setLibraryCategories).catch(() => undefined);
  }, [sessions, libraryCategories]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)) return;
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
    setBusy(true);
    api.ftir
      .spectrum(activeSid, { ...pre, max_points: 4000 })
      .then(setSpectrum)
      .catch((e) => setError(String(e)))
      .finally(() => setBusy(false));
  }, [activeSid, pre, sessions]);

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

  const onUpload = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const s = await api.ftir.upload(file, pre.mode);
      setSessions((prev) => [...prev, s]);
      setActiveSid(s.session_id);
      setPeaks([]);
      setAssignments(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

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
        path: session.path,
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
      setPre({ ...DEFAULT_PRE, ...(workspace.viewState.preprocess ?? {}) });
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
          peak.y,
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
    const lines = [
      "##TITLE=" + active.display_name,
      "##JCAMP-DX=5.00",
      "##DATA TYPE=INFRARED SPECTRUM",
      "##ORIGIN=MFP Analysis App",
      "##XUNITS=1/CM",
      `##YUNITS=${pre.mode === "absorbance" ? "ABSORBANCE" : "TRANSMITTANCE"}`,
      `##FIRSTX=${spectrum.wn[0] ?? ""}`,
      `##LASTX=${spectrum.wn[spectrum.wn.length - 1] ?? ""}`,
      `##NPOINTS=${spectrum.wn.length}`,
      "##XYDATA=(X++(Y..Y))",
      ...spectrum.wn.map((wn, i) => `${formatJcampNumber(wn)} ${formatJcampNumber(spectrum.y[i] ?? 0)}`),
      "##END=",
    ];
    downloadBlob(new Blob([lines.join("\n")], { type: "chemical/x-jcamp-dx" }), `${safeFilename(active.display_name)}.jdx`);
  };

  const exportHTMLReport = () => {
    if (!active) return;
    const assignmentRows = peaks.slice(0, 200).map((peak) => {
      const top = assignments?.find((item) => Math.abs(item.wn - peak.wn) < 0.01)?.candidates?.[0];
      return `<tr><td>${peak.wn.toFixed(1)}</td><td>${formatNumber(peak.y)}</td><td>${formatNumber(peak.prominence)}</td><td>${escapeHtml(top?.label ?? "")}</td><td>${top?.score?.toFixed(0) ?? ""}</td></tr>`;
    }).join("");
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(active.display_name)} FTIR report</title><style>body{font-family:Arial,sans-serif;margin:32px;color:#111827}table{border-collapse:collapse;width:100%;font-size:12px}td,th{border:1px solid #d1d5db;padding:6px;text-align:left}h1{font-size:22px}.meta{color:#4b5563;font-size:13px}</style></head><body><h1>${escapeHtml(active.display_name)}</h1><p class="meta">Generated ${new Date().toLocaleString()} · ${peaks.length} peaks · mode ${pre.mode}</p><h2>Preprocessing</h2><p class="meta">baseline ${pre.baseline}, normalize ${pre.normalize}, smoothing ${pre.smoothing_window}</p><h2>Peak assignments</h2><table><thead><tr><th>cm^-1</th><th>Y</th><th>Prominence</th><th>Top assignment</th><th>Score</th></tr></thead><tbody>${assignmentRows}</tbody></table></body></html>`;
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
          <HelpOpenButton onClick={() => setHelpOpen(true)} />
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.txt,.tsv,.dx,.jdx,.spc"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onUpload(f);
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
          <Tooltip content={sessions.length === 0 ? "Load a session first" : "Save workspace as JSON"}>
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
          <Tooltip content={peaks.length === 0 ? "Pick peaks first" : "Export peaks as CSV"}>
            <span>
              <button
                className="rounded-md border border-ink-200 bg-surface px-3 py-2 text-sm text-ink-700 transition-colors hover:bg-ink-100 disabled:cursor-not-allowed disabled:text-ink-400"
                disabled={busy || peaks.length === 0}
                onClick={exportPeaksCSV}
              >
                Export peaks CSV
              </button>
            </span>
          </Tooltip>
          <Tooltip content={!spectrum ? "Load a spectrum first" : "Export spectrum as JCAMP-DX"}>
            <span>
              <button
                className="rounded-md border border-ink-200 bg-surface px-3 py-2 text-sm text-ink-700 transition-colors hover:bg-ink-100 disabled:cursor-not-allowed disabled:text-ink-400"
                disabled={busy || !spectrum}
                onClick={exportJCAMP}
              >
                Export JDX
              </button>
            </span>
          </Tooltip>
          <Tooltip content={!active ? "Load a session first" : "Export printable HTML report"}>
            <span>
              <button
                className="rounded-md border border-ink-200 bg-surface px-3 py-2 text-sm text-ink-700 transition-colors hover:bg-ink-100 disabled:cursor-not-allowed disabled:text-ink-400"
                disabled={busy || !active}
                onClick={exportHTMLReport}
              >
                Report HTML
              </button>
            </span>
          </Tooltip>
          <button
            className="btn-primary"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            {busy ? "Working…" : "Open FTIR file…"}
          </button>
        </>
      }
    />,
  );

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) void onUpload(f);
  };

  const setControlPanelOpen = (key: FTIRControlPanelKey, open: boolean) => {
    setControlPanels((prev) => ({ ...prev, [key]: open }));
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
            <div className="text-3xl">📁</div>
            <div className="mt-2 text-sm font-medium text-brand-700">Drop your FTIR file here</div>
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

        <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-auto p-6">
          {!active && <EmptyState onPick={() => fileRef.current?.click()} />}

          {active && (
            <>
              <SummaryCard active={active} spectrum={spectrum} peaks={peaks} />

              <div className="flex shrink-0 flex-col gap-2">
                <CollapsiblePanel
                  title="Reprocess"
                  summary={`${pre.mode}, ${pre.baseline} baseline, ${pre.normalize} normalize`}
                  open={controlPanels.preprocess}
                  onOpenChange={(open) => setControlPanelOpen("preprocess", open)}
                >
                  <PreprocessCard pre={pre} setPre={setPre} />
                </CollapsiblePanel>

                <CollapsiblePanel
                  title="Overlay"
                  summary={overlayEnabled ? `${overlaySessionIds.length} selected` : "Off"}
                  open={controlPanels.overlay}
                  onOpenChange={(open) => setControlPanelOpen("overlay", open)}
                >
                  <OverlayCard
                    sessions={sessions}
                    enabled={overlayEnabled}
                    setEnabled={setOverlayEnabled}
                    selectedIds={overlaySessionIds}
                    setSelectedIds={setOverlaySessionIds}
                    overlayMode={graphSettings.overlayMode}
                    setOverlayMode={(overlayMode) => setGraphSettings((prev) => ({ ...prev, overlayMode }))}
                  />
                </CollapsiblePanel>

                <CollapsiblePanel
                  title="Assignments"
                  summary={`${pk.top_n || "all"} peaks, ${pk.assign ? "library on" : "library off"}`}
                  open={controlPanels.peaks}
                  onOpenChange={(open) => setControlPanelOpen("peaks", open)}
                >
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
                    peakEditMode={peakEditMode}
                    setPeakEditMode={setPeakEditMode}
                    onClearManualPeaks={clearManualPeaks}
                    manualPeakCount={(manualPeakEdits[active.session_id]?.added.length ?? 0) + (manualPeakEdits[active.session_id]?.removed.length ?? 0)}
                  />
                </CollapsiblePanel>

                <CollapsiblePanel
                  title="Constraints"
                  summary={`${assignmentConstraints.excluded_categories.length + assignmentConstraints.excluded_subcategories.length} exclusions`}
                  open={controlPanels.assignments}
                  onOpenChange={(open) => setControlPanelOpen("assignments", open)}
                >
                  <AssignmentConstraintsCard
                    categories={libraryCategories}
                    constraints={assignmentConstraints}
                    setConstraints={setAssignmentConstraints}
                    onApply={runPick}
                    disabled={!spectrum || picking}
                  />
                </CollapsiblePanel>

                <CollapsiblePanel
                  title="Quant/tools"
                  summary={`Integrate ${formatRange(quantState.integrationRegion.lo, quantState.integrationRegion.hi)} cm^-1`}
                  open={controlPanels.quant}
                  onOpenChange={(open) => setControlPanelOpen("quant", open)}
                >
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
                </CollapsiblePanel>
              </div>

              <SpectrumChart
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
                  />
                </PeakTablesTabs>
              )}
            </>
          )}
        </div>
      </div>
      {helpModule ? (
        <HelpShell open={helpOpen} module={helpModule} onClose={() => setHelpOpen(false)} />
      ) : null}
    </div>
  );
}

// ------------------------------ components ------------------------------

function CollapsiblePanel(props: {
  title: string;
  summary?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
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
        <span
          className={clsx(
            "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded border border-ink-200 text-xs text-ink-600 transition-transform",
            props.open && "rotate-90",
          )}
          aria-hidden="true"
        >
          {">"}
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
    <aside className="flex w-64 shrink-0 flex-col gap-1 border-r border-ink-200 bg-ink-50/50 p-3">
      <div className="label px-2 pb-1">Sessions</div>
      {props.sessions.length === 0 && (
        <div className="px-2 text-xs text-ink-500">No files loaded.</div>
      )}
      {props.sessions.map((s) => {
        const isActive = s.session_id === props.activeSid;
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
                {s.n_points.toLocaleString()} pts · {formatRange(s.wn_min, s.wn_max)} cm⁻¹
              </div>
            </div>
            <button
              className="invisible rounded px-1 text-xs text-ink-500 hover:bg-ink-200 group-hover:visible"
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
    </aside>
  );
}

function EmptyState(props: { onPick: () => void }) {
  return (
    <div className="card flex shrink-0 flex-col items-center justify-center gap-3 p-12 text-center">
      <div className="text-4xl">🧪</div>
      <div className="text-lg font-semibold">Open an FTIR file</div>
      <div className="max-w-md text-sm text-ink-500">
        CSV, TXT/TSV or JASCO-style files with <code>XYDATA</code> blocks. The backend
        uses the same parser as the desktop app and ignores header text automatically.
        Supported formats: .spa, .csv, .txt, .dpt
      </div>
      <button className="btn-primary mt-2" onClick={props.onPick}>
        Choose file…
      </button>
    </div>
  );
}

function SummaryCard(props: {
  active: FTIRSessionSummary;
  spectrum: FTIRSpectrumResponse | null;
  peaks: FTIRPeak[];
}) {
  const { active, spectrum, peaks } = props;
  return (
    <div className="card flex shrink-0 flex-wrap items-end gap-6 px-4 py-3">
      <div>
        <div className="label">File</div>
        <div className="text-sm font-medium">{active.display_name}</div>
      </div>
      <div>
        <div className="label">Points</div>
        <div className="text-sm">
          {active.n_points.toLocaleString()}
          {spectrum ? (
            <span className="ml-1 text-ink-500">
              · plotting {spectrum.n_points_returned.toLocaleString()}
            </span>
          ) : null}
        </div>
      </div>
      <div>
        <div className="label">Wavenumber range</div>
        <div className="text-sm">{formatRange(active.wn_min, active.wn_max)} cm⁻¹</div>
      </div>
      <div>
        <div className="label">Y-range (raw)</div>
        <div className="text-sm">{formatRange(active.y_min, active.y_max)}</div>
      </div>
      <div>
        <div className="label">Peaks</div>
        <div className="text-sm">{peaks.length}</div>
      </div>
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
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="text-sm font-semibold">Preprocess</h3>
        <div className="flex items-center gap-1">
          <span className="mr-2 text-xs text-ink-400">Presets:</span>
          {Object.entries(FTIR_PRESETS).map(([name, preset]) => (
            <button
              key={name}
              className="btn-ghost rounded border border-ink-200 px-2 py-0.5 text-xs"
              onClick={() => setPre({ ...pre, ...preset })}
            >
              {name}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Field label="Mode">
          <select
            className="input w-full"
            value={pre.mode}
            onChange={(e) => setPre({ ...pre, mode: e.target.value as FTIRYMode })}
          >
            <option value="absorbance">absorbance</option>
            <option value="transmittance">transmittance</option>
          </select>
        </Field>
        <Field label="Smoothing window">
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
        <Field label="SavGol poly order">
          <input
            type="number"
            className="input w-full"
            min={0}
            max={5}
            value={pre.poly_order}
            onChange={(e) => setPre({ ...pre, poly_order: clampInt(e.target.value, 0, 5) })}
          />
        </Field>
        <Field label="Baseline">
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
        <Field label="Normalize">
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
            <option value="msc">MSC fallback</option>
          </select>
        </Field>
        <Field label="Baseline lambda">
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
        <Field label="Asymmetry p">
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
        <Field label="Atmospheric mask">
          <Tooltip content="Exclude CO2 and H2O atmospheric regions from peak picking and shade them on the chart">
            <label className="flex h-9 items-center gap-2 rounded-md border border-ink-200 bg-surface px-2 text-sm">
              <input
                type="checkbox"
                checked={pre.mask_atmospheric}
                onChange={(e) => setPre({ ...pre, mask_atmospheric: e.target.checked })}
              />
              Mask CO2/H2O
            </label>
          </Tooltip>
        </Field>
        <Field label="ATR correction">
          <Tooltip content="Apply a gentle wavenumber-dependent ATR penetration-depth correction">
            <label className="flex h-9 items-center gap-2 rounded-md border border-ink-200 bg-surface px-2 text-sm">
              <input
                type="checkbox"
                checked={pre.atr_correction}
                onChange={(e) => setPre({ ...pre, atr_correction: e.target.checked })}
              />
              Correct ATR
            </label>
          </Tooltip>
        </Field>
        <Field label="ATR n crystal">
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
        <label className="flex items-center gap-2 text-sm text-ink-700">
          <input
            type="checkbox"
            checked={props.enabled}
            onChange={(e) => props.setEnabled(e.target.checked)}
          />
          Show selected spectra
        </label>
      </div>
      <div className="mb-3 flex items-center gap-2 text-xs text-ink-600">
        <span>Mode</span>
        <select className="input py-1 text-xs" value={props.overlayMode ?? "overlay"} onChange={(e) => props.setOverlayMode(e.target.value as GraphSettings["overlayMode"])}>
          <option value="overlay">overlay</option>
          <option value="offset">offset</option>
          <option value="stacked">stacked</option>
        </select>
      </div>
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
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
  peakEditMode: PeakEditMode;
  setPeakEditMode: (value: PeakEditMode) => void;
  onClearManualPeaks: () => void;
  manualPeakCount: number;
}) {
  const { pk, setPk } = props;
  return (
    <div className="card shrink-0 p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="text-sm font-semibold">Peak picking</h3>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-ink-600">
            <input
              type="checkbox"
              checked={props.pickAcrossOverlay}
              disabled={!props.overlayEnabled || props.overlayCount < 2}
              onChange={(e) => props.setPickAcrossOverlay(e.target.checked)}
            />
            Pick on overlayed spectra
          </label>
          <button
            className="btn-primary"
            onClick={props.onRun}
            disabled={props.disabled || props.picking}
          >
            {props.picking ? "Picking…" : "Pick peaks"}
          </button>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
        <Field label="Min prominence" className="flex flex-col justify-end">
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
        <Field label="Min height" className="flex flex-col justify-end">
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
        <Field label="Min distance (cm⁻¹)" className="flex flex-col justify-end">
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
        <Field label="Top N (0 = all)" className="flex flex-col justify-end">
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
        <Field label="Assign bonds" className="flex flex-col justify-end">
          <label className="flex h-9 items-center gap-2 rounded-md border border-ink-200 bg-surface px-2 text-sm">
            <input
              type="checkbox"
              checked={pk.assign}
              onChange={(e) => setPk({ ...pk, assign: e.target.checked })}
            />
            Use library v3
          </label>
        </Field>
        <Field label="2nd derivative" className="flex flex-col justify-end">
          <Tooltip content="Use second-derivative minima to pick shoulders and overlapping bands">
            <label className="flex h-9 items-center gap-2 rounded-md border border-ink-200 bg-surface px-2 text-sm">
              <input
                type="checkbox"
                checked={pk.second_derivative}
                onChange={(e) => setPk({ ...pk, second_derivative: e.target.checked })}
              />
              Shoulder mode
            </label>
          </Tooltip>
        </Field>
        <Field label="Assign top N" className="flex flex-col justify-end">
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
        <Field label="Assign min score" className="flex flex-col justify-end">
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
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-ink-200 pt-3">
        <span className="text-xs font-medium text-ink-500">Manual peak edit:</span>
        {(["none", "add", "remove"] as PeakEditMode[]).map((mode) => (
          <Tooltip key={mode} content={mode === "none" ? "Disable chart click editing" : `${mode === "add" ? "Add" : "Remove"} peaks by clicking the chart`}>
            <button
              className={clsx(
                "rounded-md border px-2 py-1 text-xs transition-colors",
                props.peakEditMode === mode
                  ? "border-brand-500 bg-brand-500/10 text-brand-700"
                  : "border-ink-200 bg-surface text-ink-700 hover:bg-ink-100",
              )}
              onClick={() => props.setPeakEditMode(mode)}
            >
              {mode}
            </button>
          </Tooltip>
        ))}
        <button
          className="btn-ghost border border-ink-200 px-2 py-1 text-xs"
          disabled={props.manualPeakCount === 0}
          onClick={props.onClearManualPeaks}
        >
          Clear manual edits{props.manualPeakCount ? ` (${props.manualPeakCount})` : ""}
        </button>
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
          <h3 className="text-sm font-semibold">Assignment constraints</h3>
          <p className="mt-0.5 text-xs text-ink-500">
            Rule out functional groups before re-labeling peaks.
          </p>
        </div>
        <Tooltip content="Re-run peak picking and library assignment with these exclusions">
          <span>
            <button className="btn-primary" onClick={props.onApply} disabled={props.disabled}>
              Apply & re-label
            </button>
          </span>
        </Tooltip>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.3fr_1.7fr_160px]">
        <Field label="Exclude categories">
          <div className="max-h-36 overflow-auto rounded-md border border-ink-200 bg-surface p-2">
            {categories.length === 0 ? (
              <div className="text-xs text-ink-500">Library categories unavailable.</div>
            ) : (
              <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                {categories.map((category) => (
                  <label key={category} className="flex items-center gap-2 text-xs text-ink-700">
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
        <Field label="Exclude subcategories">
          <div className="max-h-36 overflow-auto rounded-md border border-ink-200 bg-surface p-2">
            {subcategories.length === 0 ? (
              <div className="text-xs text-ink-500">No subcategories loaded.</div>
            ) : (
              <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                {subcategories.map(({ category, value }) => (
                  <label key={`${category}:${value}`} className="flex items-center gap-2 text-xs text-ink-700">
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
        <Field label="Ambiguity ratio">
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
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="rounded-md border border-ink-200 bg-surface-raised p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">Band integration</div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Field label="Lo cm^-1">
              <input
                className="input w-full"
                type="number"
                value={props.state.integrationRegion.lo}
                onChange={(event) => updateRegion("integrationRegion", { lo: Number(event.target.value) || 0 })}
              />
            </Field>
            <Field label="Hi cm^-1">
              <input
                className="input w-full"
                type="number"
                value={props.state.integrationRegion.hi}
                onChange={(event) => updateRegion("integrationRegion", { hi: Number(event.target.value) || 0 })}
              />
            </Field>
            <Field label="Baseline">
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
            <Field label="Run">
              <button className="btn-primary h-9 w-full" disabled={props.disabled || props.busy} onClick={props.onIntegrate}>
                Integrate
              </button>
            </Field>
          </div>
          {props.integrationResult && (
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
              <Metric label="Area" value={formatNumber(props.integrationResult.area)} />
              <Metric label="Height" value={formatNumber(props.integrationResult.height)} />
              <Metric label="FWHM" value={props.integrationResult.fwhm == null ? "-" : props.integrationResult.fwhm.toFixed(1)} />
              <Metric label="Peak" value={`${props.integrationResult.peak_wn.toFixed(1)} cm^-1`} />
            </div>
          )}
        </div>

        <div className="rounded-md border border-ink-200 bg-surface-raised p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">Difference spectrum</div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Field label="Subtract session">
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
            <Field label="Scale k">
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
            <Field label="Auto-fit region">
              <label className="flex h-9 items-center gap-2 rounded-md border border-ink-200 bg-surface px-2 text-sm">
                <input
                  type="checkbox"
                  checked={props.state.subtractUseRegion}
                  onChange={(event) => props.setState({ ...props.state, subtractUseRegion: event.target.checked })}
                />
                Use region
              </label>
            </Field>
            <Field label="Run">
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
                <Field label="Fit lo cm^-1">
                  <input
                    className="input w-full"
                    type="number"
                    value={props.state.subtractRegion.lo}
                    onChange={(event) => updateRegion("subtractRegion", { lo: Number(event.target.value) || 0 })}
                  />
                </Field>
                <Field label="Fit hi cm^-1">
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
              <button className="btn-ghost border border-ink-200 px-2 py-0.5 text-xs" onClick={props.onClearDifference}>
                Clear difference
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="mt-4 rounded-md border border-ink-200 bg-surface-raised p-3">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">Reference matching</div>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
          <Field label="Match lo cm^-1">
            <input
              className="input w-full"
              type="number"
              value={props.state.matchRegion.lo}
              onChange={(event) => updateAnyRegion("matchRegion", { lo: Number(event.target.value) || 650 })}
            />
          </Field>
          <Field label="Match hi cm^-1">
            <input
              className="input w-full"
              type="number"
              value={props.state.matchRegion.hi}
              onChange={(event) => updateAnyRegion("matchRegion", { hi: Number(event.target.value) || 1800 })}
            />
          </Field>
          <Field label="Derivative">
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
          <Field label="Top N">
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
          <Field label="Run">
            <button className="btn-primary h-9 w-full" disabled={props.disabled || props.busy} onClick={props.onMatch}>
              Match
            </button>
          </Field>
          <Field label="Overlay">
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
          <div className="mt-3 grid grid-cols-1 gap-2 lg:grid-cols-2">
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
                      <div className="truncate text-[10px] text-ink-500">{hit.ranking_method}</div>
                    </div>
                    <div className="font-mono text-sm text-ink-700">{hit.correlation.toFixed(3)}</div>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink-100">
                    <div className="h-full rounded-full bg-brand-500" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="mt-1 truncate text-[10px] text-ink-400">{hit.source}</div>
                </button>
              );
            })}
          </div>
        )}
      </div>
      <div className="mt-4 rounded-md border border-ink-200 bg-surface-raised p-3">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">Peak fitting</div>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
          <Field label="Fit lo cm^-1">
            <input
              className="input w-full"
              type="number"
              value={props.state.fitRegion.lo}
              onChange={(event) => updateRegion("fitRegion", { lo: Number(event.target.value) || 0 })}
            />
          </Field>
          <Field label="Fit hi cm^-1">
            <input
              className="input w-full"
              type="number"
              value={props.state.fitRegion.hi}
              onChange={(event) => updateRegion("fitRegion", { hi: Number(event.target.value) || 0 })}
            />
          </Field>
          <Field label="Components">
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
          <Field label="Profile">
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
          <Field label="Run">
            <button className="btn-primary h-9 w-full" disabled={props.disabled || props.busy} onClick={props.onFit}>
              Fit
            </button>
          </Field>
          <Field label="Overlay">
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
            <div className="mb-2 flex flex-wrap gap-2 text-xs text-ink-600">
              <Metric label="R2" value={props.fitResult.r2 == null ? "-" : props.fitResult.r2.toFixed(4)} />
              <Metric label="RMS" value={formatNumber(props.fitResult.residual_rms)} />
              <Metric label="Profile" value={props.fitResult.profile} />
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full border-separate border-spacing-0 text-xs">
                <thead>
                  <tr>
                    <Th>#</Th>
                    <Th align="right">Center</Th>
                    <Th align="right">Width</Th>
                    <Th align="right">Amplitude</Th>
                    <Th align="right">Area</Th>
                  </tr>
                </thead>
                <tbody>
                  {props.fitResult.components.map((component) => (
                    <tr key={component.index} className="odd:bg-ink-50/40">
                      <Td>{component.index}</Td>
                      <Td align="right">{component.center.toFixed(1)}</Td>
                      <Td align="right">{component.width.toFixed(1)}</Td>
                      <Td align="right">{formatNumber(component.amplitude)}</Td>
                      <Td align="right">{formatNumber(component.area)}</Td>
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
      <div className="text-[10px] uppercase tracking-wide text-ink-400">{props.label}</div>
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

type FTIRRegion = "full" | "fingerprint" | "functional" | "custom";
const FTIR_REGIONS: Record<Exclude<FTIRRegion, "custom">, [number, number]> = {
  full:       [400, 4000],
  fingerprint:[400, 1500],
  functional: [1500, 4000],
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
}) {
  const { spectrum, mode } = props;
  const pt = usePlotlyTheme();
  const [region, setRegion] = useState<FTIRRegion>("full");
  const [customMin, setCustomMin] = useState(400);
  const [customMax, setCustomMax] = useState(4000);
  const [showGraphSettings, setShowGraphSettings] = useState(false);
  const plotRef = useRef<unknown>(null);
  const xRange: [number, number] | undefined =
    region === "custom" ? [customMin, customMax] : FTIR_REGIONS[region];
  const visibleOverlays = useMemo(
    () => props.overlays.filter((overlay) => overlay.session_id !== props.activeSessionId),
    [props.activeSessionId, props.overlays],
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
    const trace: Data = {
      type: "scattergl",
      mode: "lines",
      x: spectrum.wn,
      y: spectrum.y,
      line: { color: activeColor, width: props.graphSettings.lineWidth },
      name: props.title,
      hovertemplate: "%{x:.1f} cm⁻¹<br>%{y:.4g}<extra></extra>",
    };
    const overlayTraces: Data[] = visibleOverlays.map((overlay, idx) => ({
        type: "scattergl",
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
            type: "scattergl",
            mode: "lines",
            x: props.differenceSpectrum.wn,
            y: props.differenceSpectrum.y,
            line: { color: "#dc2626", width: Math.max(1.2, props.graphSettings.lineWidth), dash: "dot" },
            name: `difference k=${props.differenceSpectrum.k.toFixed(3)}`,
            hovertemplate: "difference<br>%{x:.1f} cmג»ֲ¹<br>%{y:.4g}<extra></extra>",
          },
        ]
      : [];
    const referenceTrace: Data[] = props.selectedReference
      ? [
          {
            type: "scattergl",
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
            y: props.fitResult.fit.y,
            line: { color: "#7c3aed", width: Math.max(1.4, props.graphSettings.lineWidth), dash: "solid" },
            name: "fit total",
            hovertemplate: "fit total<br>%{x:.1f} cmג»ֲ¹<br>%{y:.4g}<extra></extra>",
          },
          ...props.fitResult.components.map((component, idx) => ({
            type: "scatter" as const,
            mode: "lines" as const,
            x: component.wn,
            y: component.y,
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
    const activePeaks = props.activePeaks;
    const markerTraces: Data[] = [];
    if (activePeaks.length > 0) {
      markerTraces.push({
      type: "scatter",
      mode: "markers",
      x: activePeaks.map((p) => p.wn),
      y: activePeaks.map((p) => p.y),
      text: activePeaks.map((p) => p.wn.toFixed(0)),
      textposition: "top center",
      textfont: { size: props.graphSettings.peakLabelSize, color: props.graphSettings.peakLabelColor },
      marker: { color: props.graphSettings.peakLabelColor, size: 7, symbol: "triangle-down" },
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
      const overlayPeaks = props.overlayPeaksBySession[overlay.session_id] ?? [];
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
    return [trace, ...overlayTraces, ...differenceTrace, ...referenceTrace, ...fitTraces, ...markerTraces];
  }, [
    spectrum,
    props.differenceSpectrum,
    props.fitResult,
    props.selectedReference,
    props.title,
    visibleOverlays,
    props.graphSettings.lineWidth,
    props.graphSettings.peakLabelColor,
    props.graphSettings.peakLabelSize,
    props.graphSettings.overlayMode,
    props.activeSessionId,
    props.activeAssignments,
    props.labelEdits,
    props.activePeaks,
    props.overlayPeaksBySession,
    resolveTraceColor,
  ]);

  const annotationSpecs = useMemo(() => {
    const items: Array<{ key: string; annotation: Record<string, unknown> }> = [];
    for (const peak of props.activePeaks) {
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
          ay: edit?.ay ?? -30,
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
      const overlayPeaks = props.overlayPeaksBySession[overlay.session_id] ?? [];
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
            ay: edit?.ay ?? -24,
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
    props.activePeaks,
    props.activeSessionId,
    props.assignmentsBySession,
    props.graphSettings.overlayMode,
    props.graphSettings.peakLabelColor,
    props.graphSettings.peakLabelSize,
    props.labelEdits,
    props.overlayPeaksBySession,
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
      const stackedAxes = buildStackedAxes(props.graphSettings.overlayMode ?? "overlay", visibleOverlays.length, pt.fontColor, props.graphSettings.showGrid);
      return ({
      margin: { l: 50, r: 20, t: 8, b: 40 },
      height: 420,
      xaxis: {
        titlefont: { size: props.graphSettings.axisTitleSize },
        tickfont: { size: props.graphSettings.axisTickSize },
        title: { text: "Wavenumber (cm⁻¹)" },
        autorange: xRange ? false : "reversed",
        range: xRange ? [xRange[1], xRange[0]] : undefined,
        zeroline: false,
        showgrid: props.graphSettings.showGrid,
        ticks: props.graphSettings.showTicks ? "outside" : "",
        linecolor: pt.fontColor,
        ...axisFrameProps,
      },
      yaxis: {
        titlefont: { size: props.graphSettings.axisTitleSize },
        tickfont: { size: props.graphSettings.axisTickSize },
        title: { text: mode === "absorbance" ? "Absorbance" : "Transmittance" },
        zeroline: false,
        showgrid: props.graphSettings.showGrid,
        ticks: props.graphSettings.showTicks ? "outside" : "",
        linecolor: pt.fontColor,
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
      xRange,
    ],
  );

  const exportPlotImage = useCallback((format: "svg" | "png") => {
    if (!plotRef.current) return;
    const base = props.title.trim().replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "_") || "ftir";
    void Plotly.downloadImage(plotRef.current as never, {
      format,
      filename: `${base}.spectrum`,
      width: 1200,
      height: 600,
      scale: format === "png" ? 2 : 1,
    });
  }, [props.title]);

  return (
    <div className="card shrink-0 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1 pb-2">
        <h3 className="text-sm font-semibold">Spectrum</h3>
        <div className="flex items-center gap-2">
          <Tooltip content="Toggle chart display settings">
            <button
              className="rounded-md border border-ink-200 bg-surface px-2 py-1 text-xs text-ink-700 transition-colors hover:bg-ink-100"
              onClick={() => setShowGraphSettings((prev) => !prev)}
            >
              Graph settings
            </button>
          </Tooltip>
          <Tooltip content={!spectrum ? "Load a spectrum first" : "Export chart as SVG"}>
            <span>
              <button
                className="rounded-md border border-ink-200 bg-surface px-2 py-1 text-xs text-ink-700 transition-colors hover:bg-ink-100"
                onClick={() => exportPlotImage("svg")}
                disabled={!spectrum}
              >
                Export SVG
              </button>
            </span>
          </Tooltip>
          <Tooltip content={!spectrum ? "Load a spectrum first" : "Export chart as PNG"}>
            <span>
              <button
                className="rounded-md border border-ink-200 bg-surface px-2 py-1 text-xs text-ink-700 transition-colors hover:bg-ink-100"
                onClick={() => exportPlotImage("png")}
                disabled={!spectrum}
              >
                Export PNG
              </button>
            </span>
          </Tooltip>
          <span className="text-xs text-ink-400">Region:</span>
          <select
            className="input py-0.5 text-xs"
            value={region}
            onChange={(e) => setRegion(e.target.value as FTIRRegion)}
          >
            <option value="full">Full (400–4000 cm⁻¹)</option>
            <option value="fingerprint">Fingerprint (400–1500)</option>
            <option value="functional">Functional groups (1500–4000)</option>
            <option value="custom">Custom…</option>
          </select>
          {region === "custom" && (
            <>
              <input
                type="number"
                className="input w-20 py-0.5 text-xs"
                value={customMin}
                onChange={(e) => setCustomMin(Number(e.target.value) || 400)}
                placeholder="min"
              />
              <span className="text-xs text-ink-400">–</span>
              <input
                type="number"
                className="input w-20 py-0.5 text-xs"
                value={customMax}
                onChange={(e) => setCustomMax(Number(e.target.value) || 4000)}
                placeholder="max"
              />
            </>
          )}
          <span className="text-xs text-ink-400">· {props.activePeaks.length} peaks</span>
        </div>
      </div>
      {showGraphSettings && (
        <div className="mb-3 grid gap-3 rounded-md border border-ink-200 bg-ink-50/50 p-3 md:grid-cols-2 xl:grid-cols-4">
          <Field label="Line width">
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
          <Field label="Frame">
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
          <Field label="Show ticks">
            <label className="flex h-9 items-center gap-2 rounded-md border border-ink-200 bg-surface px-2 text-sm">
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
          <Field label="Show grid">
            <label className="flex h-9 items-center gap-2 rounded-md border border-ink-200 bg-surface px-2 text-sm">
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
          <Field label="Group regions">
            <label className="flex h-9 items-center gap-2 rounded-md border border-ink-200 bg-surface px-2 text-sm">
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
          <Field label="Peak label color">
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
          <Field label="Peak label size">
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
          <Field label="Axis title size">
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
          <Field label="Axis tick size">
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
        </div>
      )}
      {!spectrum ? (
        <div className="flex h-64 items-center justify-center text-sm text-ink-500">
          Loading spectrum…
        </div>
      ) : (
        <Plot
          data={data}
          layout={layout}
          useResizeHandler
          style={{ width: "100%", height: 420 }}
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
            if (Number.isFinite(x) && Number.isFinite(y)) props.onChartPeakEdit(x, y);
          }}
          onInitialized={(_, graphDiv) => {
            plotRef.current = graphDiv;
          }}
          onUpdate={(_, graphDiv) => {
            plotRef.current = graphDiv;
          }}
        />
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
      const av = sortKey === "score" ? topA : Number(a[sortKey]);
      const bv = sortKey === "score" ? topB : Number(b[sortKey]);
      return (av - bv) * (sortDir === "asc" ? 1 : -1);
    });
  }, [peaks, assignments, assignmentsByWn, showLowConf, filterText, sortKey, sortDir]);

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
          p.y,
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
          <span className="ml-1 text-xs font-normal text-ink-400">({visiblePeaks.length}/{peaks.length})</span>
        </h3>
        <div className="flex items-center gap-2">
          {assignments && (
            <input
              className="input h-7 w-44 py-0.5 text-xs"
              placeholder="Filter assignment"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
            />
          )}
          {assignments && (
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-ink-600">
              <input
                type="checkbox"
                checked={showLowConf}
                onChange={(e) => setShowLowConf(e.target.checked)}
              />
              Show low-confidence
            </label>
          )}
          <button className="btn-ghost border border-ink-200 px-2 py-0.5 text-xs" onClick={copyCSV}>
            {copied ? "✓ Copied" : "Copy CSV"}
          </button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full border-separate border-spacing-0 text-xs">
          <thead className="bg-surface">
            <tr>
              <Th>#</Th>
              <Th align="right">Wavenumber (cm⁻¹)</Th>
              <Th align="right"><SortButton label="Y" field="y" sortKey={sortKey} sortDir={sortDir} setSortKey={setSortKey} setSortDir={setSortDir} /></Th>
              <Th align="right"><SortButton label="Prominence" field="prominence" sortKey={sortKey} sortDir={sortDir} setSortKey={setSortKey} setSortDir={setSortDir} /></Th>
              <Th align="right">Width (cm⁻¹)</Th>
              {assignments && <Th>Top candidate</Th>}
              {assignments && <Th>Label source</Th>}
              <Th>Plot label</Th>
              <Th>Hide label</Th>
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
                  <Td align="right">{formatNumber(p.y)}</Td>
                  <Td align="right">{formatNumber(p.prominence)}</Td>
                  <Td align="right">
                    {p.width_cm1 == null ? "—" : p.width_cm1.toFixed(1)}
                  </Td>
                  {assignments && (
                    <Td>
                      <div className="flex flex-col">
                        <span className="font-medium">{top?.label ?? "—"}</span>
                        {top && (
                          <span className="text-[10px] text-ink-500">
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
                            "inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold",
                            top.score >= 70
                              ? "bg-emerald-100 text-emerald-800"
                              : top.score >= 40
                                ? "bg-amber-100 text-amber-800"
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
                        <span className="text-ink-400">—</span>
                      ) : (
                        <div className="flex flex-col gap-0.5">
                          {alts.map((c) => (
                            <span key={c.id} className="text-[11px]">
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
              <span className="ml-1 text-ink-400">({count})</span>
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

function Field(props: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={clsx("min-w-0", props.className)}>
      <div className="label">{props.label}</div>
      {props.children}
    </div>
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
