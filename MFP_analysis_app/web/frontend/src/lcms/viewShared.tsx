import { DependencyList, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import type { LucideIcon } from "lucide-react";
import type { PlotlyHTMLElement } from "plotly.js";
import { LCMSEICData, LCMSSessionSummary, SpectrumData, SpectrumLabel, UVChromatogramResponse } from "../api";
import { type LCMSFeatureRow, type LCMSEICPlot, type PolymerUiSettings } from "./analysis";
import { type ChartSettings, type GraphSettings } from "./settings";

let pendingPlotResizeFrame: number | null = null;

export interface IgnoredRegionMass {
  mz: number;
  tolerance: number;
}

export function schedulePlotResize() {
  if (typeof window === "undefined" || pendingPlotResizeFrame !== null) return;
  pendingPlotResizeFrame = window.requestAnimationFrame(() => {
    pendingPlotResizeFrame = null;
    window.dispatchEvent(new Event("resize"));
  });
}

export function useContainerSize(
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

export function usePlotResizePulses(
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

export function resizePlotlyElement(graphDiv: PlotlyHTMLElement | null) {
  if (!graphDiv) return;
  void import("plotly.js-dist-min").then((plotlyModule) => {
    void plotlyModule.default.Plots.resize(graphDiv);
  });
}

export function queuePlotlyElementResize(graphDiv: PlotlyHTMLElement | null) {
  resizePlotlyElement(graphDiv);
  [0, 80, 240, 500].forEach((delay) => {
    window.setTimeout(() => resizePlotlyElement(graphDiv), delay);
  });
}

export type Polarity = "all" | "positive" | "negative" | "dual";
export type RtUnit = "minutes" | "seconds";
export type UvTimeUnit = "auto" | RtUnit;
export type TabId = "navigate" | "view" | "annotate" | "polymer";
export type GraphId = "tic" | "uv" | "spectrum" | "eic";
export type UVLabelOrientation = "horizontal" | "vertical";

export interface UVTextLabel {
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

export interface UVLabelAnchor {
  uv_rt_min: number;
  signal: number;
  source_peak_index?: number;
}

export type AvailableUVChromatogram = Extract<UVChromatogramResponse, { available: true }>;

export interface LCMSUVOverlayTrace {
  session_id: string;
  display_name: string;
  uv: AvailableUVChromatogram;
  offset?: number;
}

export interface LCMSUVOverlayChartTrace extends LCMSUVOverlayTrace {
  labels: UVTextLabel[];
  offset?: number;
}

export interface LCMSSpectrumOverlayTrace {
  session_id: string;
  display_name: string;
  spectrum: SpectrumData;
}

export interface CustomUvLabelDraft {
  id?: string;
  text: string;
  rtText: string;
  snap: boolean;
}

export interface UVLabelLayoutOffset {
  id: string;
  ax: number;
  ay: number;
  axRef?: "pixel" | "x";
  ayRef?: "pixel" | "y";
}

export interface LCMSProject {
  id: string;
  name: string;
  createdAt: string;
}

export type LCMSActiveProjectId = "__all" | "__unassigned" | string;

export interface LCMSWorkspaceEnvelope {
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
    polymerSettingsBySessionId?: Record<string, PolymerUiSettings>;
    eic?: LCMSEICData | null;
    eics?: LCMSEICPlot[];
    features?: LCMSFeatureRow[];
  };
}

export interface LCMSProjectPersistenceEnvelope {
  version: 1;
  projects: LCMSProject[];
  sessionProjectById: Record<string, string | null>;
  activeProjectId: LCMSActiveProjectId;
}


// Dual-polarity requests: a file may contain only one polarity, in which case the backend
// rejects the other request; show what exists and report the missing side.
export function splitDualResults<T>(results: [PromiseSettledResult<T>, PromiseSettledResult<T>]) {
  const [pos, neg] = results;
  const failures = [
    pos.status === "rejected" ? `ESI+: ${String(pos.reason)}` : null,
    neg.status === "rejected" ? `ESI−: ${String(neg.reason)}` : null,
  ].filter((msg): msg is string => msg != null);
  return {
    pos: pos.status === "fulfilled" ? pos.value : null,
    neg: neg.status === "fulfilled" ? neg.value : null,
    notice: failures.length > 0 ? failures.join(" · ") : null,
    bothFailed: failures.length === 2,
  };
}
export const LCMS_PROJECTS_STORAGE_KEY = "mfp.lcms.projects";
export const KENDRICK_SETTINGS_STORAGE_KEY = "mfp.lcms.kendrickSettings";
export const LCMS_STORAGE_PREFIX = "mfp.lcms";

export function isPolarity(value: unknown): value is Polarity {
  return value === "all" || value === "positive" || value === "negative" || value === "dual";
}

export function isRtUnit(value: unknown): value is RtUnit {
  return value === "minutes" || value === "seconds";
}

export function isTabId(value: unknown): value is TabId {
  return value === "navigate" || value === "view" || value === "annotate" || value === "polymer";
}
export const UV_PEAK_FETCH_LIMIT = 250;
export const UV_LABEL_STAIR_X_STEP_MIN = 0.5;
export const UV_LABEL_STAIR_Y_STEP_PX = 5;
export const UV_LABEL_STAIR_BASE_Y_PX = 24;

export function makeUvLabelId(sourceMsRt: number, uvRt: number, text: string, index: number): string {
  return `${sourceMsRt.toFixed(6)}:${uvRt.toFixed(6)}:${index}:${text}`;
}

export function makeCustomUvLabelId(uvRt: number, text: string): string {
  return `custom:${uvRt.toFixed(6)}:${Date.now()}:${text}`;
}

export function cleanLabelText(text: string): string {
  return text.replace(/\s+z=1\b/gi, "").replace(/\s{2,}/g, " ").trim();
}

export function normalizeUvBunchText(text: string): string {
  return cleanLabelText(text).toLowerCase();
}

export interface UvPlotAnnotation {
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

export interface UvPlotShape {
  type: "line";
  xref: "x";
  yref: "y" | "paper";
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  line: { color: string; width: number; dash?: "dot" | "solid" };
}

export interface UvBunchOptions {
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

export function buildBunchedAnnotations(
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

export function normalizeLinkName(name: string): string {
  return name
    .replace(/^.*[\\/]/, "")
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .replace(/\b(uv|dad|pda|chrom|chromatogram|trace|lcms|mzml|csv|export)\b/g, " ")
    .replace(/[_\-.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function linkNameTokens(name: string): string[] {
  return normalizeLinkName(name)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length > 1);
}

export function scoreUvSessionMatch(file: File, session: LCMSSessionSummary): number {
  const fileName = normalizeLinkName(file.name);
  const sessionName = normalizeLinkName(session.display_name || session.session_id);
  if (!fileName || !sessionName) return 0;
  if (fileName === sessionName) return 1;

  const fileCompact = fileName.replace(/\s+/g, "");
  const sessionCompact = sessionName.replace(/\s+/g, "");
  const contains =
    fileCompact.includes(sessionCompact) || sessionCompact.includes(fileCompact)
      ? Math.min(fileCompact.length, sessionCompact.length) / Math.max(fileCompact.length, sessionCompact.length)
      : 0;

  const fileTokens = new Set(linkNameTokens(file.name));
  const sessionTokens = new Set(linkNameTokens(session.display_name));
  const shared = [...fileTokens].filter((token) => sessionTokens.has(token)).length;
  const union = new Set([...fileTokens, ...sessionTokens]).size || 1;
  return Math.max(contains, shared / union);
}

export function matchUvFilesToSessions(
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

export function makeProjectId(): string {
  return `project:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
}

export function sessionsForProject(
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

export function normalizeProjectPersistence(
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

export function loadProjectPersistence(): LCMSProjectPersistenceEnvelope {
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

export function saveProjectPersistence(state: LCMSProjectPersistenceEnvelope) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LCMS_PROJECTS_STORAGE_KEY, JSON.stringify(state));
}

export type LabeledSpectrumLabel = SpectrumLabel & { text: string };

export function spectrumLabelsForUv(sp: SpectrumData): LabeledSpectrumLabel[] {
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

export function parsePolymerLabelGroup(text: string): string {
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

export function parseHydroxyCount(text: string, hydroxyAbbreviations: Set<string>): number {
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

export function arrangeUvLabelsAsSeriesStairs(
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

export function withAlpha(color: string, alpha: number): string {
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

export function nearestIndex(arr: number[], value: number): number {
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

export function formatUploaded(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

// Full name, upload time and content hash: tells apart sessions with the same (truncated) name.
export function sessionTooltip(session: LCMSSessionSummary): string {
  const uploaded = formatUploaded(session.uploaded_at);
  return [
    session.display_name,
    uploaded && `Uploaded ${uploaded}`,
    session.file_id && `File #${session.file_id} (identical files share this)`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatRange(a: number | null, b: number | null): string {
  if (a == null || b == null) return "—";
  return `${a.toFixed(2)} – ${b.toFixed(2)}`;
}

export function formatRt(rtMin: number, unit: RtUnit): string {
  return unit === "seconds" ? `${(rtMin * 60).toFixed(2)} s` : `${rtMin.toFixed(3)} min`;
}

export function formatScanId(spectrumId: string): string {
  const m = /scan=(\d+)/i.exec(spectrumId);
  if (m) return m[1];
  const m2 = /scan\s+(\d+)/i.exec(spectrumId);
  if (m2) return m2[1];
  return spectrumId;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function axisRange(min: number | null, max: number | null): [number, number] | undefined {
  return min != null && max != null ? [min, max] : undefined;
}

export function maxFinite(values: number[], fallback = 0): number {
  let max = -Infinity;
  for (const value of values) {
    if (Number.isFinite(value) && value > max) max = value;
  }
  return max === -Infinity ? fallback : max;
}

export function axisTitle(text: string, size: number) {
  return { text, font: { size } };
}

export function axisFrame(settings: ChartSettings) {
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

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadJson(value: unknown, filename: string) {
  downloadBlob(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
    filename,
  );
}

export function readJsonFile<T>(file: File): Promise<T> {
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

export function parseRegionIgnoredMasses(text: string, tolerance: number): IgnoredRegionMass[] {
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

export function isIgnoredRegionMz(mz: number, ignored: IgnoredRegionMass[]): boolean {
  return ignored.some((item) => Math.abs(mz - item.mz) <= item.tolerance);
}

export function filterIgnoredRegionSpectrum(
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

export const ICON_PROPS = { size: 15, strokeWidth: 1.8, "aria-hidden": true } as const;

// Quiet card-toolbar action: line icon + label, no border. `active` marks a toggled-on state.
export function ToolbarButton({
  icon: Icon,
  label,
  title,
  onClick,
  active,
  disabled,
}: {
  icon: LucideIcon;
  label: string;
  title?: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={clsx(
        "btn-ghost whitespace-nowrap px-2 py-1 disabled:cursor-not-allowed disabled:opacity-40",
        active && "bg-brand-50 text-brand-800 hover:bg-brand-100",
      )}
      title={title}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon {...ICON_PROPS} />
      <span>{label}</span>
    </button>
  );
}

// Card title plus one grey status line ("ESI+ · 1,554 points · RT 4.69 min") instead of chips.
export function ChartCardTitle({ title, status }: { title: string; status: Array<string | false | null | undefined> }) {
  const line = status.filter(Boolean).join(" · ");
  return (
    <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <h3 className="text-card-title whitespace-nowrap">{title}</h3>
      {line && <span className="text-caption min-w-0 truncate">{line}</span>}
    </div>
  );
}
