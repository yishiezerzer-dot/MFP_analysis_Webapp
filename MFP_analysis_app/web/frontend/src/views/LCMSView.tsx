import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PlotMouseEvent } from "plotly.js";
import clsx from "clsx";
import { useLocation } from "react-router-dom";
import { api, LCMSEICData, LCMSRegionSpectrumData, LCMSTICOverlayTrace, LCMSFindMzResponse, LCMSSessionSummary, PolymerSettings, SpectrumData, SpectrumLabel, TICData, UVChromatogramResponse } from "../api";
import { PageHeaderContent, usePageHeader } from "../layout/PageHeader";
import { HelpOpenButton, HelpShell } from "../help/HelpShell";
import { getHelpModule } from "../help/registry";
import { AlertBanner } from "../components/AlertBanner";
import { Tooltip } from "../components/Tooltip";
import { useBrowserAutomation } from "../automation/BrowserBridge";
import { useAutomationDispatch } from "../automation/registry";
import { useStoredState } from "../hooks/useStoredState";
import { useUndoRedo } from "../hooks/useUndoRedo";
import { useWorkspace } from "../context/WorkspaceContext";
import { useRegisterFileIngest } from "../context/FileIngestionContext";
import { buildExpectedProductHits, buildKendrickPoints, eicSourceFile, eicSourceSessionId, loadPolymerUiSettings, savePolymerMonomerPresets, savePolymerUiSettingsDefault, groupFeatureRowsForMatrix, integrateEICPeak, integrateTraceRegion, polymerMonomerText, toApiPolymerSettings, type FeatureMatrixGroupMode, type FeatureMatrixMetric, type IntegratedTraceRegion, type LCMSFeatureRow, type LCMSEICMetadata, type LCMSEICPlot, type PolymerUiSettings } from "../lcms/analysis";
import { loadGraphSettingsDefault, mergeGraphSettings, saveGraphSettingsDefault, type GraphSettings, type SpectrumOverlayMode } from "../lcms/settings";
import { FeatureTableDialog } from "../components/lcms/FeatureTableDialog";
import { ComparisonMatrixDialog } from "../components/lcms/ComparisonMatrixDialog";
import { KendrickDialog } from "../components/lcms/KendrickDialog";
import { ExpectedProductsDialog } from "../components/lcms/ExpectedProductsDialog";
import { GraphSettingsDialog } from "../components/lcms/GraphSettingsDialog";
import { SinglePlotDesignDialog } from "../components/lcms/SinglePlotDesignDialog";
import { PolymerDialog } from "../components/lcms/PolymerDialog";
import { PolymerStudioModal } from "../components/lcms/PolymerStudioDrawer";
import { PeakContextPopover, type PeakContextData } from "../components/common/PeakContextPopover";
import { DeconvolutionDialog } from "../components/lcms/DeconvolutionDialog";
import { Polarity, RtUnit, UvTimeUnit, TabId, GraphId, UVLabelOrientation, UVTextLabel, UVLabelAnchor, LCMSUVOverlayTrace, LCMSUVOverlayChartTrace, LCMSSpectrumOverlayTrace, CustomUvLabelDraft, UVLabelLayoutOffset, LCMSProject, LCMSActiveProjectId, LCMSWorkspaceEnvelope, splitDualResults, LCMS_STORAGE_PREFIX, isPolarity, isRtUnit, isTabId, UV_PEAK_FETCH_LIMIT, UV_LABEL_STAIR_X_STEP_MIN, UV_LABEL_STAIR_Y_STEP_PX, makeUvLabelId, makeCustomUvLabelId, normalizeUvBunchText, matchUvFilesToSessions, makeProjectId, sessionsForProject, loadProjectPersistence, saveProjectPersistence, spectrumLabelsForUv, arrangeUvLabelsAsSeriesStairs, nearestIndex, formatBytes, downloadBlob, downloadJson, readJsonFile, parseRegionIgnoredMasses, filterIgnoredRegionSpectrum } from "../lcms/viewShared";
import { SessionsSidebar } from "../components/lcms/SessionsSidebar";
import { DatasetRibbon, ToolsPanel } from "../components/lcms/ToolsPanel";
import { TICChart } from "../components/lcms/TICChart";
import { EICChart } from "../components/lcms/EICChart";
import { UVChromatogramChart } from "../components/lcms/UVChromatogramChart";
import { SpectrumChart } from "../components/lcms/SpectrumChart";
import { EmptyState, StatusBar, FindMzDialog, CustomUvLabelDialog, EICDialog } from "../components/lcms/LCMSViewDialogs";

export function LCMSView() {
  const browserAutomation = useBrowserAutomation();
  const actionDispatch = useAutomationDispatch();
  const { activeWorkspaceId } = useWorkspace();
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
  const [ticPos, setTicPos] = useState<TICData | null>(null);
  const [ticNeg, setTicNeg] = useState<TICData | null>(null);
  const [spectrum, setSpectrum] = useState<SpectrumData | null>(null);
  const [spectrumPos, setSpectrumPos] = useState<SpectrumData | null>(null);
  const [spectrumNeg, setSpectrumNeg] = useState<SpectrumData | null>(null);
  const [regionIntegrationPos, setRegionIntegrationPos] = useState<IntegratedTraceRegion | null>(null);
  const [regionIntegrationNeg, setRegionIntegrationNeg] = useState<IntegratedTraceRegion | null>(null);
  const [polymerStudioPolarity, setPolymerStudioPolarity] = useState<"positive" | "negative">("positive");
  const [deconvolutionPolarity, setDeconvolutionPolarity] = useState<"positive" | "negative">("positive");
  const [deconvolutionSpectrum, setDeconvolutionSpectrum] = useState<SpectrumData | null>(null);
  const [uv, setUv] = useState<UVChromatogramResponse | null>(null);
  const {
    state: eicPlots,
    set: setEicPlots,
    undo: undoEic,
    redo: redoEic,
    canUndo: canUndoEic,
    canRedo: canRedoEic,
  } = useUndoRedo<LCMSEICPlot[]>([]);
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
  const [dualLayout, setDualLayout] = useStoredState<"stacked" | "grid">(
    `${LCMS_STORAGE_PREFIX}.dualLayout`,
    "stacked",
    (value) => (value === "stacked" || value === "grid" ? value : "stacked"),
  );
  const [uvTimeUnit, setUvTimeUnit] = useStoredState<UvTimeUnit>(
    `${LCMS_STORAGE_PREFIX}.uvTimeUnit`,
    "auto",
    (value) => (value === "minutes" || value === "seconds" ? value : "auto"),
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
  const [showPolymerControls, setShowPolymerControls] = useStoredState(`${LCMS_STORAGE_PREFIX}.showPolymerControls`, true);
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
  const [uvOffsetBySessionId, setUvOffsetBySessionId] = useStoredState<Record<string, number>>(
    `${LCMS_STORAGE_PREFIX}.uvOffsetBySessionId`,
    {},
  );
  const [autoAlignUv, setAutoAlignUv] = useStoredState(`${LCMS_STORAGE_PREFIX}.autoAlignUv`, false);
  const [syncChromatogramZoom, setSyncChromatogramZoom] = useStoredState(`${LCMS_STORAGE_PREFIX}.syncChromatogramZoom`, false);
  const [syncedRtRange, setSyncedRtRange] = useState<[number, number] | null>(null);

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
  const [polymerSettingsBySessionId, setPolymerSettingsBySessionId] =
    useStoredState<Record<string, PolymerUiSettings>>(
      `${LCMS_STORAGE_PREFIX}.polymerSettingsBySessionId`,
      {},
      (value) => (value && typeof value === "object" ? value : {}),
    );
  const getPolymerSettingsForSession = useCallback(
    (sid: string | null): PolymerUiSettings => {
      if (sid && polymerSettingsBySessionId[sid]) {
        return polymerSettingsBySessionId[sid];
      }
      return loadPolymerUiSettings();
    },
    [polymerSettingsBySessionId],
  );
  const activePolymerUiSettings = useMemo(
    () => getPolymerSettingsForSession(activeSid),
    [activeSid, getPolymerSettingsForSession],
  );
  const polymerSettings = activePolymerUiSettings;
  const polymerSettingsRef = useRef(activePolymerUiSettings);
  useEffect(() => {
    polymerSettingsRef.current = activePolymerUiSettings;
  }, [activePolymerUiSettings]);
  const setPolymerSettingsForSession = useCallback(
    (
      sid: string | null,
      next: PolymerUiSettings | ((prev: PolymerUiSettings) => PolymerUiSettings),
    ) => {
      if (!sid) return;
      setPolymerSettingsBySessionId((prev) => {
        const current = prev[sid] ?? loadPolymerUiSettings();
        const updated = typeof next === "function" ? next(current) : next;
        return { ...prev, [sid]: updated };
      });
    },
    [setPolymerSettingsBySessionId],
  );
  const setPolymerSettings = useCallback(
    (next: PolymerUiSettings | ((prev: PolymerUiSettings) => PolymerUiSettings)) => {
      if (!activeSid) return;
      setPolymerSettingsForSession(activeSid, next);
    },
    [activeSid, setPolymerSettingsForSession],
  );
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
  const {
    state: selectedRegion,
    set: setSelectedRegion,
    undo: undoRegion,
    redo: redoRegion,
    canUndo: canUndoRegion,
    canRedo: canRedoRegion,
    reset: resetRegion,
  } = useUndoRedo<{ rtMin: number; rtMax: number } | null>(null, { enableKeyShortcuts: true });
  const [regionIntegration, setRegionIntegration] = useState<IntegratedTraceRegion | null>(null);

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
  const [uploadProgress, setUploadProgress] = useState<{
    filename: string;
    fileIndex: number;
    totalFiles: number;
    percent: number;
    loadedBytes: number;
    totalBytes: number;
    phase: "uploading" | "indexing";
  } | null>(null);

  const copyPolymerSettingsFromSession = useCallback(
    (sourceSid: string, targetSid?: string) => {
      const target = targetSid ?? activeSid;
      if (!target || target === sourceSid) return;
      const sourceSettings = getPolymerSettingsForSession(sourceSid);
      setPolymerSettingsForSession(
        target,
        JSON.parse(JSON.stringify(sourceSettings)) as PolymerUiSettings,
      );
      const sourceName =
        sessions.find((s) => s.session_id === sourceSid)?.display_name ?? sourceSid;
      setInfo(`Copied polymer settings from ${sourceName}.`);
    },
    [activeSid, getPolymerSettingsForSession, sessions, setPolymerSettingsForSession],
  );

  const applyPolymerSettingsToAllSessions = useCallback(
    (sourceSid?: string) => {
      const source = sourceSid ?? activeSid;
      if (!source) return;
      const sourceSettings = getPolymerSettingsForSession(source);
      setPolymerSettingsBySessionId((prev) => {
        const next: Record<string, PolymerUiSettings> = { ...prev };
        for (const s of sessions) {
          next[s.session_id] = JSON.parse(JSON.stringify(sourceSettings)) as PolymerUiSettings;
        }
        return next;
      });
      setInfo(`Applied polymer settings to all ${sessions.length} open files.`);
    },
    [activeSid, getPolymerSettingsForSession, sessions, setPolymerSettingsBySessionId],
  );

  // Dialog / modal state
  const [findMzOpen, setFindMzOpen] = useState(false);
  const [eicOpen, setEicOpen] = useState(false);
  const [graphSettingsOpen, setGraphSettingsOpen] = useState(false);
  const [designPlotId, setDesignPlotId] = useState<GraphId | null>(null);
  const [reloadPulse, setReloadPulse] = useState(0);
  const [graphSettings, setGraphSettings] = useState<GraphSettings>(() =>
    loadGraphSettingsDefault(),
  );

  const updateGraphOverlayMode = useCallback(
    (graphId: "tic" | "uv" | "spectrum", mode: any) => {
      setGraphSettings((prev) => ({
        ...prev,
        [graphId]: {
          ...prev[graphId],
          overlaySettings: {
            ...(prev[graphId].overlaySettings ?? {}),
            mode,
            ...(graphId === "spectrum" ? { spectrumMode: mode } : { chromatogramMode: mode }),
          },
        },
      }));
    },
    [],
  );
  const [polymerDialogOpen, setPolymerDialogOpen] = useState(false);
  const [polymerStudioOpen, setPolymerStudioOpen] = useState(false);
  const [activePeakContext, setActivePeakContext] = useState<PeakContextData | null>(null);
  const [expectedProductsOpen, setExpectedProductsOpen] = useState(false);
  const [kendrickOpen, setKendrickOpen] = useState(false);
  const [deconvolutionOpen, setDeconvolutionOpen] = useState(false);
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

  const prevActiveSidForSpectrumRef = useRef<string | null>(activeSid);
  useEffect(() => {
    if (prevActiveSidForSpectrumRef.current !== activeSid) {
      prevActiveSidForSpectrumRef.current = activeSid;
      setSpectrum(null);
      setSelectedRt(null);
      setSelectedUvRt(null);
      setSyncedRtRange(null);
      if (activeSid && activeSid in uvOffsetBySessionId) {
        const off = uvOffsetBySessionId[activeSid] ?? 0;
        setUvOffset(off);
        setUvOffsetText(off.toFixed(3));
      }
    }
  }, [activeSid, setUvOffset, setUvOffsetText, uvOffsetBySessionId]);

  const pol = polarity === "positive" || polarity === "negative" ? polarity : undefined;

  const getApiPolymerSettingsForSession = useCallback(
    (sid: string | null, polOverride?: "positive" | "negative"): PolymerSettings | undefined => {
      const targetPol = polOverride ?? (polarity === "positive" || polarity === "negative" ? polarity : undefined);
      if (!sid || !targetPol) return undefined;
      const pSettings = getPolymerSettingsForSession(sid);
      if (!pSettings.shared.enabled) return undefined;
      return toApiPolymerSettings(pSettings, targetPol);
    },
    [getPolymerSettingsForSession, polarity],
  );

  const activePolymerSettings = useMemo(
    () => getApiPolymerSettingsForSession(activeSid),
    [activeSid, getApiPolymerSettingsForSession],
  );

  const activePolymerSettingsPos = useMemo(
    () => getApiPolymerSettingsForSession(activeSid, "positive"),
    [activeSid, getApiPolymerSettingsForSession],
  );

  const activePolymerSettingsNeg = useMemo(
    () => getApiPolymerSettingsForSession(activeSid, "negative"),
    [activeSid, getApiPolymerSettingsForSession],
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
    let cancelled = false;
    api.lcms
      .list()
      .then(async (list) => {
        if (cancelled) return;
        setSessions(list);
        setSessionsHydrated(true);

        // Try to restore saved workspace state
        let restoredSid: string | null = null;
        try {
          const res = await api.workspaces.getState(activeWorkspaceId, "lcms");
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
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [activeWorkspaceId]);

  useEffect(() => {
    savePolymerMonomerPresets(polymerSettings.monomers);
  }, [polymerSettings.monomers]);

  const savePolymerDefaults = useCallback(() => {
    savePolymerUiSettingsDefault(polymerSettings);
    setInfo("Saved polymer matching defaults.");
  }, [polymerSettings]);

  useEffect(() => {
    if (!sessionsHydrated || !activeWorkspaceId) return;
    const timer = window.setTimeout(() => {
      api.workspaces
        .saveState(activeWorkspaceId, "lcms", {
          activeSid,
          polarity,
          activeTab,
        })
        .catch(() => undefined);
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [activeWorkspaceId, activeSid, polarity, activeTab, sessionsHydrated]);

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
      setTicPos(null);
      setTicNeg(null);
      return;
    }
    if (polarity === "dual") {
      let cancelled = false;
      api.lcms
        .tic(activeSid, "positive")
        .then((data) => {
          if (!cancelled) setTicPos(data);
        })
        .catch((err) => {
          if (!cancelled) setTicPos(null);
        });
      api.lcms
        .tic(activeSid, "negative")
        .then((data) => {
          if (!cancelled) setTicNeg(data);
        })
        .catch((err) => {
          if (!cancelled) setTicNeg(null);
        });
      return () => {
        cancelled = true;
      };
    } else {
      api.lcms
        .tic(activeSid, pol)
        .then(setTic)
        .catch((err) => setError(String(err)));
    }
  }, [activeSid, pol, polarity]);

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
        offset: uvOffsetBySessionId[trace.session_id] ?? 0,
        labels: uvLabelsBySessionId[trace.session_id] ?? [],
      })),
    [uvLabelsBySessionId, uvOffsetBySessionId, uvOverlay],
  );

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

      if (polarity === "dual") {
        Promise.allSettled([
          api.lcms.spectrum(activeSid, {
            rt_min: rtMin,
            polarity: "positive",
            top_n: Math.max(1, spectrumTopN),
            min_rel: Math.max(0, spectrumMinRel),
            polymer: getApiPolymerSettingsForSession(activeSid, "positive"),
          }),
          api.lcms.spectrum(activeSid, {
            rt_min: rtMin,
            polarity: "negative",
            top_n: Math.max(1, spectrumTopN),
            min_rel: Math.max(0, spectrumMinRel),
            polymer: getApiPolymerSettingsForSession(activeSid, "negative"),
          }),
        ])
          .then((results) => {
            const { pos: spPos, neg: spNeg, notice, bothFailed } = splitDualResults(results);
            if (bothFailed) {
              setError(notice);
              return;
            }
            if (notice) setInfo(notice);
            setSpectrumPos(spPos);
            setSpectrumNeg(spNeg);
            setSpectrum(spPos ?? spNeg);
            if (spPos && (transferMsToUv || options?.forceUvTransfer)) {
              storeUvLabelsFromSpectrum(spPos, options?.uvRtMin ?? rtMin - uvOffset, {
                snap: snapUvLabels,
              });
            }
          })
          .catch((err) => setError(String(err)))
          .finally(() => setBusy(false));
      } else {
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
      }
    },
    [
      activeSid,
      pol,
      polarity,
      spectrumTopN,
      spectrumMinRel,
      activePolymerSettings,
      getApiPolymerSettingsForSession,
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
          polymer: polymerSettingsOverride ?? getApiPolymerSettingsForSession(sid),
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
    activeSid,
    addSpectrumLabelsToUv,
    getApiPolymerSettingsForSession,
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

      const totalBytes = files.reduce((acc, f) => acc + (f.size || 0), 0);
      const loadedByFile = new Map<number, number>();

      const updateProgress = (fileIdx: number, loaded: number) => {
        loadedByFile.set(fileIdx, loaded);
        let sumLoaded = 0;
        for (const bytes of loadedByFile.values()) {
          sumLoaded += bytes;
        }
        const pct = totalBytes > 0 ? (sumLoaded / totalBytes) * 100 : 0;
        const currentFile = files[fileIdx];
        setUploadProgress({
          filename: currentFile.name,
          fileIndex: fileIdx + 1,
          totalFiles: files.length,
          percent: pct,
          loadedBytes: sumLoaded,
          totalBytes,
          phase: pct >= 99.5 ? "indexing" : "uploading",
        });
      };

      setUploadProgress({
        filename: files[0].name,
        fileIndex: 1,
        totalFiles: files.length,
        percent: 0,
        loadedBytes: 0,
        totalBytes,
        phase: "uploading",
      });

      const uploadPromises = files.map((file, idx) =>
        api.lcms.upload(file, (loaded) => updateProgress(idx, loaded)),
      );

      const uploaded = await Promise.all(uploadPromises);

      if (uploaded.length > 0) {
        setSessions((prev) => [...prev, ...uploaded]);
        setPolymerSettingsBySessionId((prev) => {
          const next = { ...prev };
          uploaded.forEach((session) => {
            if (!next[session.session_id]) {
              next[session.session_id] = loadPolymerUiSettings();
            }
          });
          return next;
        });
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
        setInfo(`Loaded ${uploaded.length} mzML files in parallel.`);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
      setUploadProgress(null);
    }
  };

  useRegisterFileIngest("/lcms", onUpload);

  const onRemove = async (sid: string) => {
    await api.lcms.remove(sid).catch((err) => setError(String(err)));
    setSessions((prev) => prev.filter((s) => s.session_id !== sid));
    setSessionProjectById((prev) => {
      if (!(sid in prev)) return prev;
      const next = { ...prev };
      delete next[sid];
      return next;
    });
    setPolymerSettingsBySessionId((prev) => {
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
      const summary = await api.lcms.uploadUV(activeSid, file, uvTimeUnit);
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
        summaries.push(await api.lcms.uploadUV(match.session.session_id, match.file, uvTimeUnit));
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

  const goToIndex = useCallback(
    (i: number) => {
      if (i < 0 || i >= rtList.length) return;
      loadSpectrum(rtList[i]);
    },
    [rtList, loadSpectrum],
  );
  const goFirst = useCallback(() => goToIndex(0), [goToIndex]);
  const goLast = useCallback(
    () => goToIndex(rtList.length - 1),
    [goToIndex, rtList.length],
  );
  const goPrev = useCallback(() => {
    if (rtList.length === 0) return;
    if (selectedRt == null) return goLast();
    const i = nearestIndex(rtList, selectedRt);
    goToIndex(Math.max(0, i - 1));
  }, [rtList, selectedRt, goLast, goToIndex]);
  const goNext = useCallback(() => {
    if (rtList.length === 0) return;
    if (selectedRt == null) return goFirst();
    const i = nearestIndex(rtList, selectedRt);
    goToIndex(Math.min(rtList.length - 1, i + 1));
  }, [rtList, selectedRt, goFirst, goToIndex]);

  // Keyboard navigation: Left/Right arrow keys step through MS1 scans
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (
        findMzOpen ||
        eicOpen ||
        graphSettingsOpen ||
        designPlotId !== null ||
        polymerDialogOpen ||
        polymerStudioOpen ||
        expectedProductsOpen ||
        kendrickOpen ||
        deconvolutionOpen ||
        featureTableOpen ||
        comparisonMatrixOpen ||
        helpOpen ||
        customUvLabelDraft !== null
      ) {
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goPrev();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goNext();
      } else if (e.key === "b" || e.key === "B") {
        e.preventDefault();
        setGraphSettings((prev) => {
          const current = prev.spectrum.overlaySettings?.spectrumMode ?? "overlay";
          const cycle: Record<SpectrumOverlayMode, SpectrumOverlayMode> = {
            overlay: "butterfly",
            butterfly: "butterfly_normalized",
            butterfly_normalized: "normalized",
            normalized: "overlay",
          };
          const nextMode = cycle[current] ?? "overlay";
          return {
            ...prev,
            spectrum: {
              ...prev.spectrum,
              overlaySettings: {
                ...(prev.spectrum.overlaySettings ?? {}),
                mode: nextMode,
                spectrumMode: nextMode,
              },
            },
          };
        });
      } else if (e.key === "o" || e.key === "O") {
        e.preventDefault();
        setOverlaySpectrumEnabled((v) => !v);
      } else if (e.key === "Escape") {
        e.preventDefault();
        setRegionSelect(false);
        setSelectedRegion(null);
        setSyncedRtRange(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    goPrev,
    goNext,
    findMzOpen,
    eicOpen,
    graphSettingsOpen,
    designPlotId,
    polymerDialogOpen,
    polymerStudioOpen,
    expectedProductsOpen,
    kendrickOpen,
    deconvolutionOpen,
    featureTableOpen,
    comparisonMatrixOpen,
    helpOpen,
    customUvLabelDraft,
    setGraphSettings,
    setOverlaySpectrumEnabled,
    setSelectedRegion,
  ]);
  // Find m/z: scan every MS1 at current filter for the most intense near m/z
  const [findMzInput, setFindMzInput] = useState("");
  const [findMzTol, setFindMzTol] = useState(0.01);
  const [findMzUnit, setFindMzUnit] = useState<"da" | "ppm">("da");
  const [eicInput, setEicInput] = useState("");
  const [eicTol, setEicTol] = useState(0.01);
  const [eicUnit, setEicUnit] = useState<"da" | "ppm">("da");
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
        tolerance_unit: findMzUnit,
        polarity: pol,
      }) as unknown as LCMSFindMzResponse;
      const bestRt = result.best.rt_min;
      if (bestRt == null) {
        setInfo(`No match found for m/z ${target.toFixed(4)} within ${findMzTol} ${findMzUnit.toUpperCase()}.`);
        return;
      }
      setFindMzOpen(false);
      loadSpectrum(bestRt);
      setInfo(
        `Strongest match for m/z ${target.toFixed(4)} ± ${findMzTol} ${findMzUnit.toUpperCase()}: RT ${bestRt.toFixed(3)} min`,
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
      toleranceUnitOverride?: "da" | "ppm",
      sessionIdOverride?: string,
    ) => {
      const sourceSid = sessionIdOverride ?? activeSid;
      if (!sourceSid) return;
      if (!Number.isFinite(target)) {
        setInfo("Enter a valid m/z before generating an EIC.");
        return;
      }
      const tolerance = Math.max(0.000001, toleranceOverride ?? eicTol);
      const toleranceUnit = toleranceUnitOverride ?? eicUnit;
      const targetSession = sessions.find((s) => s.session_id === sourceSid);
      const sourceFile = targetSession?.display_name ?? active?.display_name ?? "LCMS session";
      setBusy(true);
      setError(null);
      try {
        await actionDispatch("lcms.create_eic_and_show", {
          session_id: sourceSid,
          mz: target,
          tolerance,
          tolerance_unit: toleranceUnit,
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
          `Generated EIC for ${sourceFile}: m/z ${target.toFixed(4)} ± ${tolerance} ${toleranceUnit.toUpperCase()}.`,
        );
      } catch (err) {
        setError(String(err));
      } finally {
        setBusy(false);
      }
    },
    [actionDispatch, active?.display_name, activeSid, eicTol, eicUnit, pol, sessions],
  );

  const runEIC = async () => {
    await createEICForMz(parseFloat(eicInput), "dialog");
  };

  const onSpectrumPeakClick = useCallback(
    (
      mz: number,
      intensity?: number,
      mouseEvent?: MouseEvent,
      target?: { sessionId?: string; displayName?: string },
    ) => {
      const clientX = mouseEvent?.clientX ?? (window.innerWidth / 2 - 140);
      const clientY = mouseEvent?.clientY ?? (window.innerHeight / 2);
      const targetSid = target?.sessionId ?? activeSid;
      const targetSession = sessions.find((s) => s.session_id === targetSid);
      const targetFile =
        target?.displayName ?? targetSession?.display_name ?? active?.display_name ?? "LCMS session";

      let matchedLabel: SpectrumLabel | undefined;
      if (!target?.sessionId || target.sessionId === activeSid) {
        matchedLabel = spectrum?.labels.find((l) => Math.abs(l.mz - mz) < 0.05);
      } else {
        const trace = spectrumOverlay.find((t) => t.session_id === target.sessionId);
        matchedLabel = trace?.spectrum.labels.find((l) => Math.abs(l.mz - mz) < 0.05);
      }

      setActivePeakContext({
        mz,
        intensity: intensity ?? matchedLabel?.intensity ?? 0,
        label: matchedLabel?.text,
        source: matchedLabel?.source,
        sessionId: targetSid ?? undefined,
        fileName: targetFile,
        x: clientX,
        y: clientY,
      });
    },
    [active?.display_name, activeSid, sessions, spectrum, spectrumOverlay],
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
    if (activeSid) {
      setUvOffsetBySessionId((prev) => ({ ...prev, [activeSid]: offset }));
    }
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

  useEffect(() => {
    const ids = overlaySessionIds.filter((sid) => sid !== activeSid);
    const shouldOverlay = overlaySpectrumEnabled && ids.length > 0;
    if (!shouldOverlay) {
      setSpectrumOverlay([]);
      return;
    }

    let cancelled = false;
    const hasRegion =
      selectedRegion != null &&
      Number.isFinite(selectedRegion.rtMin) &&
      Number.isFinite(selectedRegion.rtMax) &&
      selectedRegion.rtMin !== selectedRegion.rtMax;

    if (hasRegion && selectedRegion != null) {
      const lo = Math.min(selectedRegion.rtMin, selectedRegion.rtMax);
      const hi = Math.max(selectedRegion.rtMin, selectedRegion.rtMax);
      Promise.all(
        ids.map(async (sid) => {
          const session = sessions.find((item) => item.session_id === sid);
          try {
            const payload = await api.lcms.regionSpectrum(sid, {
              rt_min: lo,
              rt_max: hi,
              polarity: pol,
              bin_width: 0.01,
              min_rel: 0.0,
              polymer: getApiPolymerSettingsForSession(sid),
            });
            const sp = spectrumFromRegionData(payload, lo, hi);
            return {
              session_id: sid,
              display_name: session?.display_name ?? sid,
              spectrum: sp,
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
    } else if (selectedRt != null) {
      const snapApex = Boolean(graphSettings.spectrum.overlaySettings?.snapApex);
      const snapTolerance = graphSettings.spectrum.overlaySettings?.snapToleranceMin ?? 0.05;

      Promise.all(
        ids.map(async (sid) => {
          const session = sessions.find((item) => item.session_id === sid);
          let targetRt = selectedRt;
          if (snapApex && Number.isFinite(selectedRt)) {
            const trace = ticOverlay.find((t) => t.session_id === sid);
            if (trace && trace.rt_min.length > 0) {
              let maxTic = -Infinity;
              let bestRt = selectedRt;
              const minRt = selectedRt - snapTolerance;
              const maxRt = selectedRt + snapTolerance;
              for (let i = 0; i < trace.rt_min.length; i += 1) {
                const rt = trace.rt_min[i];
                if (rt >= minRt && rt <= maxRt) {
                  if (trace.tic[i] > maxTic) {
                    maxTic = trace.tic[i];
                    bestRt = rt;
                  }
                }
              }
              if (Number.isFinite(bestRt)) {
                targetRt = bestRt;
              }
            }
          }
          try {
            const payload = await api.lcms.spectrum(sid, {
              rt_min: targetRt,
              polarity: pol,
              top_n: spectrumTopN,
              min_rel: spectrumMinRel,
              polymer: getApiPolymerSettingsForSession(sid),
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
    } else {
      setSpectrumOverlay([]);
    }

    return () => {
      cancelled = true;
    };
  }, [
    activeSid,
    getApiPolymerSettingsForSession,
    graphSettings.spectrum.overlaySettings?.snapApex,
    graphSettings.spectrum.overlaySettings?.snapToleranceMin,
    overlaySessionIds,
    overlaySpectrumEnabled,
    pol,
    polymerSettingsBySessionId,
    reloadPulse,
    selectedRegion,
    selectedRt,
    sessions,
    spectrumFromRegionData,
    spectrumMinRel,
    spectrumTopN,
    ticOverlay,
  ]);

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
    setRegionIntegration(null);
  }, [setSelectedRegion]);

  const loadRegionData = useCallback(
    async (region: { rtMin: number; rtMax: number } | null) => {
      if (!activeSid || !region) {
        setRegionIntegration(null);
        setRegionIntegrationPos(null);
        setRegionIntegrationNeg(null);
        return;
      }
      const lo = Math.min(region.rtMin, region.rtMax);
      const hi = Math.max(region.rtMin, region.rtMax);
      if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) {
        setRegionIntegration(null);
        setRegionIntegrationPos(null);
        setRegionIntegrationNeg(null);
        return;
      }
      setSelectedRt((lo + hi) / 2);

      if (polarity === "dual") {
        if (ticPos && ticPos.rt_min && ticPos.rt_min.length > 0) {
          setRegionIntegrationPos(integrateTraceRegion(ticPos.rt_min, ticPos.tic, lo, hi));
        } else {
          setRegionIntegrationPos(null);
        }
        if (ticNeg && ticNeg.rt_min && ticNeg.rt_min.length > 0) {
          setRegionIntegrationNeg(integrateTraceRegion(ticNeg.rt_min, ticNeg.tic, lo, hi));
        } else {
          setRegionIntegrationNeg(null);
        }

        setBusy(true);
        setError(null);
        try {
          const results = await Promise.allSettled([
            api.lcms.regionSpectrum(activeSid, {
              rt_min: lo,
              rt_max: hi,
              polarity: "positive",
              bin_width: 0.01,
              min_rel: 0.0,
              polymer: getApiPolymerSettingsForSession(activeSid, "positive"),
            }),
            api.lcms.regionSpectrum(activeSid, {
              rt_min: lo,
              rt_max: hi,
              polarity: "negative",
              bin_width: 0.01,
              min_rel: 0.0,
              polymer: getApiPolymerSettingsForSession(activeSid, "negative"),
            }),
          ]);
          const { pos: dataPos, neg: dataNeg, notice, bothFailed } = splitDualResults(results);
          if (bothFailed) throw new Error(notice ?? "No MS1 scans in this region.");
          const spPos = dataPos ? spectrumFromRegionData(dataPos, lo, hi) : null;
          const spNeg = dataNeg ? spectrumFromRegionData(dataNeg, lo, hi) : null;
          setSpectrumPos(spPos);
          setSpectrumNeg(spNeg);
          setSpectrum(spPos ?? spNeg);
          setShowSpectrum(true);
          setInfo(
            `Sliced & summed Dual MS1: ${dataPos?.n_scans ?? 0} ESI+ scans, ${dataNeg?.n_scans ?? 0} ESI- scans (${lo.toFixed(3)}-${hi.toFixed(3)} min).` +
              (notice ? ` ${notice}` : ""),
          );
        } catch (err) {
          setError(String(err));
        } finally {
          setBusy(false);
        }
      } else {
        // Instantaneous baseline-corrected trapezoidal integration of chromatogram
        if (tic && tic.rt_min && tic.rt_min.length > 0) {
          const integrated = integrateTraceRegion(tic.rt_min, tic.tic, lo, hi);
          setRegionIntegration(integrated);
        } else {
          setRegionIntegration(null);
        }

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
              ? `Sliced & summed MS1 from ${data.n_scans} scans (${lo.toFixed(3)}-${hi.toFixed(3)} min).`
              : `No MS1 scans found in ${lo.toFixed(3)}-${hi.toFixed(3)} min.`,
          );
        } catch (err) {
          setError(String(err));
        } finally {
          setBusy(false);
        }
      }
    },
    [
      activeSid,
      pol,
      polarity,
      activePolymerSettings,
      getApiPolymerSettingsForSession,
      spectrumFromRegionData,
      tic,
      ticPos,
      ticNeg,
      setSelectedRt,
    ],
  );

  const onRegionSelected = useCallback(
    (rtMin: number, rtMax: number) => {
      if (!activeSid) return;
      const lo = Math.min(rtMin, rtMax);
      const hi = Math.max(rtMin, rtMax);
      if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return;
      const nextRegion = { rtMin: lo, rtMax: hi };
      setSelectedRegion(nextRegion);
      void loadRegionData(nextRegion);
    },
    [activeSid, setSelectedRegion, loadRegionData],
  );

  // Sync when selectedRegion is undone or redone
  const prevRegionRef = useRef<{ rtMin: number; rtMax: number } | null>(null);
  useEffect(() => {
    if (selectedRegion !== prevRegionRef.current) {
      prevRegionRef.current = selectedRegion;
      void loadRegionData(selectedRegion);
    }
  }, [selectedRegion, loadRegionData]);

  // Reset region history on session switch
  useEffect(() => {
    resetRegion(null);
  }, [activeSid, resetRegion]);

  // Live re-match active MS1 spectrum when active polymer settings change
  useEffect(() => {
    if (!activeSid) return;
    if (selectedRegion != null) {
      void loadRegionData(selectedRegion);
    } else if (selectedRt != null) {
      loadSpectrum(selectedRt);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePolymerSettings]);

  // Reload spectra when switching polarity mode if RT or region is selected
  useEffect(() => {
    if (!activeSid) return;
    if (selectedRegion != null) {
      void loadRegionData(selectedRegion);
    } else if (selectedRt != null) {
      loadSpectrum(selectedRt);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [polarity]);

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
        uv: session.uv ? { available: Boolean(session.uv.available), filename: session.uv.filename } : { available: false },
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
        polymerSettingsBySessionId,
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

      // Sessions are kept on the server, so a workspace can only re-link sessions that still
      // exist there; files that were removed must be re-uploaded (the server no longer opens
      // arbitrary file paths).
      const idMap = new Map<string, string>();
      let failed = 0;

      for (const wsSession of workspace.sessions) {
        if (availableIds.has(wsSession.session_id)) {
          idMap.set(wsSession.session_id, wsSession.session_id);
        } else {
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
      if (analysis.polymerSettingsBySessionId) {
        const nextPolymerSettingsBySessionId: Record<string, PolymerUiSettings> = {};
        for (const [sid, pSettings] of Object.entries(analysis.polymerSettingsBySessionId)) {
          const newSid = idMap.get(sid) ?? sid;
          if (newAvailableIds.has(newSid) && pSettings && typeof pSettings === "object") {
            nextPolymerSettingsBySessionId[newSid] = pSettings;
          }
        }
        setPolymerSettingsBySessionId(nextPolymerSettingsBySessionId);
      } else if (analysis.polymerSettings) {
        const fallback: Record<string, PolymerUiSettings> = {};
        for (const sid of newAvailableIds) {
          fallback[sid] = JSON.parse(JSON.stringify(analysis.polymerSettings)) as PolymerUiSettings;
        }
        setPolymerSettingsBySessionId(fallback);
      }
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
      if (failed > 0) infoMsg += ` ${failed} session(s) are no longer on the server; re-upload those files.`;
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
      else if (dialog === "deconvolution") setDeconvolutionOpen(true);
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
    if (rtMin != null) {
      setSelectedRegion(null);
      setRegionIntegration(null);
      loadSpectrum(rtMin);
    }
  };

  const onUVClick = (ev: Readonly<PlotMouseEvent>) => {
    const displayedRtMin = rtFromPlotClick(ev);
    if (displayedRtMin != null) {
      const uvRtMin = displayedRtMin - uvOffset;
      loadSpectrum(displayedRtMin, { uvRtMin });
    }
  };

  const handleReloadTIC = useCallback(() => {
    if (activeSid) {
      if (polarity === "dual") {
        api.lcms.tic(activeSid, "positive").then(setTicPos).catch((err) => setError(String(err)));
        api.lcms.tic(activeSid, "negative").then(setTicNeg).catch((err) => setError(String(err)));
      } else {
        api.lcms.tic(activeSid, pol).then(setTic).catch((err) => setError(String(err)));
      }
      if (overlayTicEnabled && overlaySessionIds.length > 1) {
        api.lcms
          .ticOverlay({ session_ids: overlaySessionIds, polarity: pol })
          .then((payload) => setTicOverlay(payload.traces))
          .catch((err) => setError(String(err)));
      }
    }
    setReloadPulse((p) => p + 1);
    window.dispatchEvent(new Event("resize"));
  }, [activeSid, overlaySessionIds, overlayTicEnabled, pol, polarity]);

  const handleReloadUV = useCallback(() => {
    if (activeSid) {
      api.lcms
        .uv(activeSid, {
          top_n: UV_PEAK_FETCH_LIMIT,
          min_rel: uvProminence,
          min_distance_min: uvMinDistance,
        })
        .then(setUv)
        .catch((err) => setError(String(err)));
    }
    setReloadPulse((p) => p + 1);
    window.dispatchEvent(new Event("resize"));
  }, [activeSid, uvMinDistance, uvProminence]);

  const handleReloadSpectrum = useCallback(() => {
    if (selectedRegion != null) {
      void loadRegionData(selectedRegion);
    } else if (selectedRt != null) {
      loadSpectrum(selectedRt);
    }
    setReloadPulse((p) => p + 1);
    window.dispatchEvent(new Event("resize"));
  }, [loadRegionData, loadSpectrum, selectedRegion, selectedRt]);

  const handleReloadEIC = useCallback(() => {
    setReloadPulse((p) => p + 1);
    window.dispatchEvent(new Event("resize"));
  }, []);

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
            accept=".mzML,.mzml,.mzML.gz,.mzml.gz"
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

  const handleTagUpdated = (newTag: string) => {
    setSessions((prev) =>
      prev.map((s) => (s.session_id === activeSid ? { ...s, experiment_tag: newTag } : s)),
    );
  };

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
          {uploadProgress && (
            <div className="rounded-lg border border-brand-300 bg-brand-50/90 p-4 shadow-sm animate-in fade-in duration-200">
              <div className="flex items-center justify-between text-xs font-semibold text-brand-900 mb-2">
                <div className="flex items-center gap-2">
                  <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
                  <span className="text-sm">
                    {uploadProgress.phase === "indexing"
                      ? `Indexing MS1 scans & building TIC index (${uploadProgress.totalFiles > 1 ? `${uploadProgress.fileIndex}/${uploadProgress.totalFiles}: ` : ""}${uploadProgress.filename})... large files can take a minute or two`
                      : `Uploading ${uploadProgress.totalFiles > 1 ? `(${uploadProgress.fileIndex}/${uploadProgress.totalFiles}) ` : ""}${uploadProgress.filename} · ${formatBytes(uploadProgress.loadedBytes)} / ${formatBytes(uploadProgress.totalBytes)}`}
                  </span>
                </div>
                <span className="font-mono text-xs text-brand-700 font-bold">{Math.round(uploadProgress.percent)}%</span>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-brand-200/70">
                <div
                  className="h-full bg-brand-600 transition-all duration-150 rounded-full"
                  style={{ width: `${Math.max(2, Math.min(100, uploadProgress.percent))}%` }}
                />
              </div>
            </div>
          )}
          <DatasetRibbon
            active={active}
            onTagUpdated={handleTagUpdated}
            polarity={polarity}
            setPolarity={setPolarity}
            dualLayout={dualLayout}
            setDualLayout={setDualLayout}
          />

          {!active && <EmptyState onPick={() => fileRef.current?.click()} />}

          {active && (
            <>
              {showTIC && (
                polarity === "dual" ? (
                  <div className={dualLayout === "grid" ? "grid grid-cols-1 xl:grid-cols-2 gap-4" : "flex flex-col gap-4"}>
                    <TICChart
                      activeSid={activeSid}
                      activeDisplayName={active?.display_name}
                      title="Total Ion Chromatogram (ESI+)"
                      polarityBadge="ESI+"
                      colorOverride="#2563eb"
                      emptyMessage="No positive mode (ESI+) chromatogram available in this file."
                      tic={ticPos}
                      overlayTraces={ticOverlay}
                      onClick={onTICClick}
                      onRegionSelected={onRegionSelected}
                      onUndoRegion={undoRegion}
                      onRedoRegion={redoRegion}
                      canUndoRegion={canUndoRegion}
                      canRedoRegion={canRedoRegion}
                      selectedRt={selectedRt}
                      selectedRegion={selectedRegion}
                      regionIntegration={regionIntegrationPos}
                      selectedScanId={
                        spectrumPos?.meta.spectrum_id && !spectrumPos.meta.spectrum_id.startsWith("summed:")
                          ? spectrumPos.meta.spectrum_id
                          : null
                      }
                      rtUnit={rtUnit}
                      regionSelect={regionSelect}
                      onToggleRegionSelect={handleSetRegionSelect}
                      settings={graphSettings.tic}
                      onOpenDesign={() => setDesignPlotId("tic")}
                      onReload={handleReloadTIC}
                      onUpdateOverlayMode={(mode) => updateGraphOverlayMode("tic", mode)}
                      syncZoom={syncChromatogramZoom}
                      onToggleSyncZoom={() => {
                        setSyncChromatogramZoom((v) => !v);
                        if (syncChromatogramZoom) setSyncedRtRange(null);
                      }}
                      syncedRtRange={syncChromatogramZoom ? syncedRtRange : null}
                      onZoomChange={(range) => {
                        if (syncChromatogramZoom) setSyncedRtRange(range);
                      }}
                    />
                    <TICChart
                      activeSid={activeSid}
                      activeDisplayName={active?.display_name}
                      title="Total Ion Chromatogram (ESI-)"
                      polarityBadge="ESI-"
                      colorOverride="#e11d48"
                      emptyMessage="No negative mode (ESI-) chromatogram available in this file."
                      tic={ticNeg}
                      overlayTraces={ticOverlay}
                      onClick={onTICClick}
                      onRegionSelected={onRegionSelected}
                      onUndoRegion={undoRegion}
                      onRedoRegion={redoRegion}
                      canUndoRegion={canUndoRegion}
                      canRedoRegion={canRedoRegion}
                      selectedRt={selectedRt}
                      selectedRegion={selectedRegion}
                      regionIntegration={regionIntegrationNeg}
                      selectedScanId={
                        spectrumNeg?.meta.spectrum_id && !spectrumNeg.meta.spectrum_id.startsWith("summed:")
                          ? spectrumNeg.meta.spectrum_id
                          : null
                      }
                      rtUnit={rtUnit}
                      regionSelect={regionSelect}
                      onToggleRegionSelect={handleSetRegionSelect}
                      settings={graphSettings.tic}
                      onOpenDesign={() => setDesignPlotId("tic")}
                      onReload={handleReloadTIC}
                      onUpdateOverlayMode={(mode) => updateGraphOverlayMode("tic", mode)}
                      syncZoom={syncChromatogramZoom}
                      onToggleSyncZoom={() => {
                        setSyncChromatogramZoom((v) => !v);
                        if (syncChromatogramZoom) setSyncedRtRange(null);
                      }}
                      syncedRtRange={syncChromatogramZoom ? syncedRtRange : null}
                      onZoomChange={(range) => {
                        if (syncChromatogramZoom) setSyncedRtRange(range);
                      }}
                    />
                  </div>
                ) : (
                  <TICChart
                    activeSid={activeSid}
                    activeDisplayName={active?.display_name}
                    tic={tic}
                    overlayTraces={ticOverlay}
                    onClick={onTICClick}
                    onRegionSelected={onRegionSelected}
                    onUndoRegion={undoRegion}
                    onRedoRegion={redoRegion}
                    canUndoRegion={canUndoRegion}
                    canRedoRegion={canRedoRegion}
                    selectedRt={selectedRt}
                    selectedRegion={selectedRegion}
                    regionIntegration={regionIntegration}
                    selectedScanId={
                      spectrum?.meta.spectrum_id && !spectrum.meta.spectrum_id.startsWith("summed:")
                        ? spectrum.meta.spectrum_id
                        : null
                    }
                    rtUnit={rtUnit}
                    regionSelect={regionSelect}
                    onToggleRegionSelect={handleSetRegionSelect}
                    settings={graphSettings.tic}
                    onOpenDesign={() => setDesignPlotId("tic")}
                    onReload={handleReloadTIC}
                    onUpdateOverlayMode={(mode) => updateGraphOverlayMode("tic", mode)}
                    syncZoom={syncChromatogramZoom}
                    onToggleSyncZoom={() => {
                      setSyncChromatogramZoom((v) => !v);
                      if (syncChromatogramZoom) setSyncedRtRange(null);
                    }}
                    syncedRtRange={syncChromatogramZoom ? syncedRtRange : null}
                    onZoomChange={(range) => {
                      if (syncChromatogramZoom) setSyncedRtRange(range);
                    }}
                  />
                )
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
                  onUndoEic={undoEic}
                  onRedoEic={redoEic}
                  canUndoEic={canUndoEic}
                  canRedoEic={canRedoEic}
                  clearLabel="Clear file"
                  settings={graphSettings.eic}
                  overlaySettings={graphSettings.eicOverlay}
                  onOpenDesign={() => setDesignPlotId("eic")}
                  onReload={handleReloadEIC}
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
                      onUndoEic={undoEic}
                      onRedoEic={redoEic}
                      canUndoEic={canUndoEic}
                      canRedoEic={canRedoEic}
                      settings={graphSettings.eic}
                      overlaySettings={graphSettings.eicOverlay}
                      onOpenDesign={() => setDesignPlotId("eic")}
                      onReload={handleReloadEIC}
                    />
                  </div>
                ))
              )}
              {showUV && (
                <UVChromatogramChart
                  uv={uv}
                  overlayTraces={uvOverlayWithLabels}
                  showOverlayLabels={showOverlayLabels}
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
                  onOpenDesign={() => setDesignPlotId("uv")}
                  onReload={handleReloadUV}
                  onAutoLabelUV={() => dispatchUiAction("lcms.auto_label_uv")}
                  onLabelSelectedRT={transferSelectedSpectrumToUv}
                  onCustomUvLabel={() => dispatchUiAction("lcms.open_custom_uv_label")}
                  onAutoArrangeLabels={autoArrangeUvLabels}
                  uvProminence={uvProminence}
                  setUvProminence={setUvProminence}
                  uvMinDistance={uvMinDistance}
                  setUvMinDistance={setUvMinDistance}
                  transferMsToUv={transferMsToUv}
                  setTransferMsToUv={setTransferMsToUv}
                  uvTransferCount={uvTransferCount}
                  setUvTransferCount={setUvTransferCount}
                  snapUvLabels={snapUvLabels}
                  setSnapUvLabels={setSnapUvLabels}
                  setUvLabelOrientation={setUvLabelOrientation}
                  setUvBunchLabels={setUvBunchLabels}
                  setUvBunchHubOffset={setUvBunchHubOffset}
                  uvLabelStairXStep={uvLabelStairXStep}
                  setUvLabelStairXStep={setUvLabelStairXStep}
                  uvLabelStairYStep={uvLabelStairYStep}
                  setUvLabelStairYStep={setUvLabelStairYStep}
                  uvOffsetText={uvOffsetText}
                  setUvOffsetText={setUvOffsetText}
                  onApplyOffset={() => {
                    const v = parseFloat(uvOffsetText);
                    const parsed = Number.isFinite(v) ? v : 0;
                    setUvOffset(parsed);
                    if (activeSid) {
                      setUvOffsetBySessionId((prev) => ({ ...prev, [activeSid]: parsed }));
                    }
                  }}
                  autoAlignUv={autoAlignUv}
                  setAutoAlignUv={setAutoAlignUv}
                  onAutoAlignUV={() => dispatchUiAction("lcms.auto_align_uv")}
                  onUpdateOverlayMode={(mode) => updateGraphOverlayMode("uv", mode)}
                  syncZoom={syncChromatogramZoom}
                  onToggleSyncZoom={() => {
                    setSyncChromatogramZoom((v) => !v);
                    if (syncChromatogramZoom) setSyncedRtRange(null);
                  }}
                  syncedRtRange={syncChromatogramZoom ? syncedRtRange : null}
                  onZoomChange={(range) => {
                    if (syncChromatogramZoom) setSyncedRtRange(range);
                  }}
                />
              )}
              {showSpectrum && (
                polarity === "dual" ? (
                  <div className={dualLayout === "grid" ? "grid grid-cols-1 xl:grid-cols-2 gap-4" : "flex flex-col gap-4"}>
                    <SpectrumChart
                      title="MS1 Spectrum (ESI+)"
                      polarityBadge="ESI+"
                      colorOverride="#2563eb"
                      emptyMessage="Click a point on the TIC to view positive mode (ESI+) spectrum."
                      spectrum={spectrumPos}
                      overlayTraces={spectrumOverlay}
                      annotate={annotateSpectrum}
                      showOverlayLabels={showOverlayLabels}
                      showDragHint={enableDragLabels}
                      selectedRt={selectedRt}
                      rtUnit={rtUnit}
                      settings={graphSettings.spectrum}
                      polymerEnabled={Boolean(activePolymerSettingsPos)}
                      polymerStudioOpen={polymerStudioOpen && polymerStudioPolarity === "positive"}
                      onTogglePolymerStudio={() => {
                        setPolymerStudioPolarity("positive");
                        setPolymerStudioOpen((v) => !v);
                      }}
                      onPeakClick={onSpectrumPeakClick}
                      onDeconvolution={() => {
                        setDeconvolutionPolarity("positive");
                        setDeconvolutionSpectrum(spectrumPos);
                        setDeconvolutionOpen(true);
                      }}
                      onOpenDesign={() => setDesignPlotId("spectrum")}
                      onReload={handleReloadSpectrum}
                      onUpdateOverlayMode={(mode) => updateGraphOverlayMode("spectrum", mode)}
                    />
                    <SpectrumChart
                      title="MS1 Spectrum (ESI-)"
                      polarityBadge="ESI-"
                      colorOverride="#e11d48"
                      emptyMessage="Click a point on the TIC to view negative mode (ESI-) spectrum."
                      spectrum={spectrumNeg}
                      overlayTraces={spectrumOverlay}
                      annotate={annotateSpectrum}
                      showOverlayLabels={showOverlayLabels}
                      showDragHint={enableDragLabels}
                      selectedRt={selectedRt}
                      rtUnit={rtUnit}
                      settings={graphSettings.spectrum}
                      polymerEnabled={Boolean(activePolymerSettingsNeg)}
                      polymerStudioOpen={polymerStudioOpen && polymerStudioPolarity === "negative"}
                      onTogglePolymerStudio={() => {
                        setPolymerStudioPolarity("negative");
                        setPolymerStudioOpen((v) => !v);
                      }}
                      onPeakClick={onSpectrumPeakClick}
                      onDeconvolution={() => {
                        setDeconvolutionPolarity("negative");
                        setDeconvolutionSpectrum(spectrumNeg);
                        setDeconvolutionOpen(true);
                      }}
                      onOpenDesign={() => setDesignPlotId("spectrum")}
                      onReload={handleReloadSpectrum}
                      onUpdateOverlayMode={(mode) => updateGraphOverlayMode("spectrum", mode)}
                    />
                  </div>
                ) : (
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
                    polymerStudioOpen={polymerStudioOpen}
                    onTogglePolymerStudio={() => setPolymerStudioOpen((v) => !v)}
                    onPeakClick={onSpectrumPeakClick}
                    onDeconvolution={() => setDeconvolutionOpen(true)}
                    onOpenDesign={() => setDesignPlotId("spectrum")}
                    onReload={handleReloadSpectrum}
                    onUpdateOverlayMode={(mode) => updateGraphOverlayMode("spectrum", mode)}
                  />
                )
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
          dualLayout={dualLayout}
          setDualLayout={setDualLayout}
          setRtUnit={setRtUnit}
          uvTimeUnit={uvTimeUnit}
          setUvTimeUnit={setUvTimeUnit}
          uvOffsetText={uvOffsetText}
          setUvOffsetText={setUvOffsetText}
          onApplyOffset={() => {
            const v = parseFloat(uvOffsetText);
            const parsed = Number.isFinite(v) ? v : 0;
            setUvOffset(parsed);
            if (activeSid) {
              setUvOffsetBySessionId((prev) => ({ ...prev, [activeSid]: parsed }));
            }
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

      <PeakContextPopover
        peak={activePeakContext}
        onClose={() => setActivePeakContext(null)}
        onExtractEic={(mz, sessionId) => {
          const sid = sessionId ?? activePeakContext?.sessionId;
          setEicInput(mz.toFixed(4));
          void createEICForMz(
            mz,
            "spectrum",
            undefined,
            {
              label: activePeakContext?.label ?? `MS1 peak ${mz.toFixed(4)}`,
              annotation: activePeakContext?.source,
            },
            undefined,
            sid,
          );
        }}
        onDeconvolute={() => setDeconvolutionOpen(true)}
        onMatchPolymer={() => setPolymerStudioOpen(true)}
      />

      {findMzOpen && (
        <FindMzDialog
          input={findMzInput}
          setInput={setFindMzInput}
          tol={findMzTol}
          setTol={setFindMzTol}
          unit={findMzUnit}
          setUnit={setFindMzUnit}
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
          unit={eicUnit}
          setUnit={setEicUnit}
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
      {designPlotId != null && (
        <SinglePlotDesignDialog
          graphId={designPlotId}
          settings={graphSettings}
          onChange={setGraphSettings}
          overlayEicEnabled={overlayEicEnabled}
          setOverlayEicEnabled={setOverlayEicEnabled}
          overlayTraceNames={
            designPlotId === "tic"
              ? ticOverlay.map((t) => t.display_name)
              : designPlotId === "spectrum"
              ? spectrumOverlay.map((t) => t.display_name)
              : designPlotId === "uv"
              ? uvOverlayWithLabels.map((t) => t.display_name)
              : designPlotId === "eic" && visibleEicPlots.length > 1
              ? visibleEicPlots.map((p) => `${eicSourceFile(p)} m/z ${p.eic.target_mz.toFixed(4)}`)
              : []
          }
          overlaySessions={
            designPlotId === "tic"
              ? ticOverlay.map((t) => ({ sessionId: t.session_id, displayName: t.display_name }))
              : designPlotId === "spectrum"
              ? spectrumOverlay.map((t) => ({ sessionId: t.session_id, displayName: t.display_name }))
              : designPlotId === "uv"
              ? uvOverlayWithLabels.map((t) => ({ sessionId: t.session_id, displayName: t.display_name }))
              : undefined
          }
          onSetDefault={() => {
            saveGraphSettingsDefault(graphSettings);
            setInfo(`Saved current ${designPlotId.toUpperCase()} settings as the default.`);
          }}
          onReset={() => setGraphSettings(loadGraphSettingsDefault())}
          onClose={() => setDesignPlotId(null)}
        />
      )}
      {polymerStudioOpen && (
        <PolymerStudioModal
          open={polymerStudioOpen}
          onClose={() => setPolymerStudioOpen(false)}
          polarity={polarity === "dual" ? polymerStudioPolarity : polarity}
          settings={polymerSettings}
          onChange={setPolymerSettings}
          onExpectedProducts={() => void openExpectedProductsWithCompute()}
          onKendrick={() => void openKendrickWithCompute()}
          canOpenExpectedProducts={Boolean(
            (polarity === "dual" ? (polymerStudioPolarity === "positive" ? spectrumPos : spectrumNeg) : spectrum) &&
            polarity !== "all" &&
            polymerMonomerText(polymerSettings),
          )}
          canOpenKendrick={Boolean(polarity === "dual" ? (spectrumPos || spectrumNeg) : spectrum)}
          onSaveDefaults={savePolymerDefaults}
          spectrumAvailable={Boolean(polarity === "dual" ? (spectrumPos || spectrumNeg) : spectrum)}
          sessions={sessions}
          activeSessionId={activeSid}
          onSelectSession={setActiveSid}
          onCopyFromSession={copyPolymerSettingsFromSession}
          onApplyToAllSessions={applyPolymerSettingsToAllSessions}
        />
      )}
      {polymerDialogOpen && (
        <PolymerDialog
          polarity={polarity === "dual" ? polymerStudioPolarity : polarity}
          settings={polymerSettings}
          onChange={setPolymerSettings}
          onClose={() => setPolymerDialogOpen(false)}
          sessions={sessions}
          activeSessionId={activeSid}
          onSelectSession={setActiveSid}
          onCopyFromSession={copyPolymerSettingsFromSession}
          onApplyToAllSessions={applyPolymerSettingsToAllSessions}
        />
      )}
      {expectedProductsOpen && polarity !== "all" && (
        <ExpectedProductsDialog
          polarity={polarity === "dual" ? polymerStudioPolarity : polarity}
          settings={polymerSettings}
          spectrum={polarity === "dual" ? (polymerStudioPolarity === "positive" ? spectrumPos : spectrumNeg) : spectrum}
          tic={polarity === "dual" ? (polymerStudioPolarity === "positive" ? ticPos : ticNeg) : tic}
          activeSid={activeSid}
          onCreateEic={(mz, tolerance, metadata) => void createEICForMz(mz, "expected", tolerance, metadata)}
          onClose={() => setExpectedProductsOpen(false)}
        />
      )}
      {kendrickOpen && (
        <KendrickDialog
          spectrum={polarity === "dual" ? (spectrumPos ?? spectrumNeg) : spectrum}
          settings={polymerSettings}
          onCreateEic={(mz, tolerance) => void createEICForMz(mz, "spectrum", tolerance)}
          onClose={() => setKendrickOpen(false)}
        />
      )}
      {deconvolutionOpen && (
        <DeconvolutionDialog
          activeSid={activeSid}
          spectrum={polarity === "dual" ? (deconvolutionSpectrum ?? spectrumPos ?? spectrumNeg) : spectrum}
          polarity={polarity === "dual" ? deconvolutionPolarity : (polarity === "negative" ? "negative" : "positive")}
          onCreateEic={(mz, tolerance, metadata) => void createEICForMz(mz, "spectrum", tolerance, metadata)}
          onClose={() => setDeconvolutionOpen(false)}
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
