import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Plot from "react-plotly.js";
import Plotly from "plotly.js-dist-min";
import type { Data, Layout } from "plotly.js";
import clsx from "clsx";
import {
  api,
  FTIRAssignment,
  FTIRBaseline,
  FTIRNormalize,
  FTIRPeak,
  FTIRPeaksRequest,
  FTIRPreprocessOptions,
  FTIRSessionSummary,
  FTIRSpectrumResponse,
  FTIRYMode,
} from "../api";
import { PageHeaderContent, usePageHeader } from "../layout/PageHeader";

// --- types local to this view ---

interface PeakPickOptions {
  min_prominence: number;
  min_height: number | null;
  min_distance_cm1: number;
  top_n: number;
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
};

const FTIR_PRESETS: Record<string, Partial<FTIRPreprocessOptions>> = {
  "KBr disc": { mode: "transmittance", smoothing_window: 5, poly_order: 2, baseline: "polyfit", normalize: "max" },
  "ATR":      { mode: "absorbance",    smoothing_window: 5, poly_order: 2, baseline: "polyfit", normalize: "max" },
  "Film":     { mode: "absorbance",    smoothing_window: 0, poly_order: 2, baseline: "none",    normalize: "none" },
};

const DEFAULT_PEAK: PeakPickOptions = {
  min_prominence: 0.01,
  min_height: null,
  min_distance_cm1: 8.0,
  top_n: 15,
  assign: true,
  assign_top_n: 3,
  assign_min_score: 35.0,
};

type PlotFrameMode = "none" | "half" | "full";

interface GraphSettings {
  lineWidth: number;
  frame: PlotFrameMode;
  showTicks: boolean;
  showGrid: boolean;
  showScaleBars?: boolean;
  peakLabelColor: string;
  traceColors: Record<string, string>;
}

interface FTIRLabelEdit {
  text?: string;
  hidden?: boolean;
  ax?: number;
  ay?: number;
}

type FTIRLabelEdits = Record<string, FTIRLabelEdit>;

const DEFAULT_GRAPH_SETTINGS: GraphSettings = {
  lineWidth: 1.4,
  frame: "half",
  showTicks: true,
  showGrid: true,
  peakLabelColor: "#dc2626",
  traceColors: {},
};

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
  };
  analysisState: {
    peaks: FTIRPeak[];
    assignments: FTIRAssignment[] | null;
    assignmentsBySession?: Record<string, FTIRAssignment[] | null>;
    overlayPeaksBySession?: Record<string, FTIRPeak[]>;
    pickAcrossOverlay?: boolean;
    labelEdits?: FTIRLabelEdits;
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

function topAssignmentLabel(assignments: FTIRAssignment[] | null | undefined, wn: number): string | null {
  const assignment = assignments?.find((item) => Math.abs(item.wn - wn) < 0.01);
  return assignment?.candidates?.[0]?.label ?? null;
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
  return override || topAssignmentLabel(assignments, peak.wn) || peak.wn.toFixed(0);
}

export function FTIRView() {
  const [sessions, setSessions] = useState<FTIRSessionSummary[]>([]);
  const [activeSid, setActiveSid] = useState<string | null>(null);
  const [pre, setPre] = useState<FTIRPreprocessOptions>(DEFAULT_PRE);
  const [pk, setPk] = useState<PeakPickOptions>(DEFAULT_PEAK);
  const [spectrum, setSpectrum] = useState<FTIRSpectrumResponse | null>(null);
  const [overlayEnabled, setOverlayEnabled] = useState(false);
  const [overlaySessionIds, setOverlaySessionIds] = useState<string[]>([]);
  const [overlaySpectra, setOverlaySpectra] = useState<FTIROverlaySpectrum[]>([]);
  const [peaks, setPeaks] = useState<FTIRPeak[]>([]);
  const [assignmentsBySession, setAssignmentsBySession] = useState<Record<string, FTIRAssignment[] | null>>({});
  const [overlayPeaksBySession, setOverlayPeaksBySession] = useState<Record<string, FTIRPeak[]>>({});
  const [labelEdits, setLabelEdits] = useState<FTIRLabelEdits>({});
  const [graphSettings, setGraphSettings] = useState<GraphSettings>(DEFAULT_GRAPH_SETTINGS);
  const [assignments, setAssignments] = useState<FTIRAssignment[] | null>(null);
  const [pickAcrossOverlay, setPickAcrossOverlay] = useState(false);
  const [libMeta, setLibMeta] = useState<{ version: string; n_entries: number } | null>(null);
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

  useEffect(() => {
    api.ftir.list().then(setSessions).catch((e) => setError(String(e)));
    api.ftir.library().then(setLibMeta).catch(() => undefined);
  }, []);

  useEffect(() => {
    setOverlaySessionIds((prev) => {
      const available = new Set(sessions.map((session) => session.session_id));
      const kept = prev.filter((sid) => available.has(sid));
      if (kept.length > 0 || sessions.length === 0) return kept;
      return sessions.map((session) => session.session_id);
    });
  }, [sessions]);

  // Refetch spectrum whenever session or preprocessing changes.
  useEffect(() => {
    if (!activeSid) {
      setSpectrum(null);
      setPeaks([]);
      setAssignmentsBySession({});
      setOverlayPeaksBySession({});
      setAssignments(null);
      return;
    }
    setBusy(true);
    api.ftir
      .spectrum(activeSid, { ...pre, max_points: 4000 })
      .then(setSpectrum)
      .catch((e) => setError(String(e)))
      .finally(() => setBusy(false));
  }, [activeSid, pre]);

  useEffect(() => {
    if (!activeSid) return;
    const sessionPeaks = overlayPeaksBySession[activeSid];
    if (sessionPeaks) {
      setPeaks(sessionPeaks);
      setAssignments(assignmentsBySession[activeSid] ?? null);
    }
  }, [activeSid, overlayPeaksBySession, assignmentsBySession]);

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
      setAssignmentsBySession({});
      setOverlayPeaksBySession({});
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
    if (activeSid === sid) {
      setActiveSid(null);
      setSpectrum(null);
      setPeaks([]);
      setAssignmentsBySession({});
      setOverlayPeaksBySession({});
      setAssignments(null);
    }
  };

  const runPick = useCallback(async () => {
    if (!activeSid) return;
    setPicking(true);
    setError(null);
    try {
      const body: FTIRPeaksRequest = { ...pre, ...pk };
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
      for (const item of results) bySession[item.sid] = item.result.peaks;
      for (const item of results) assignmentMap[item.sid] = item.result.assignments ?? null;
      setAssignmentsBySession(assignmentMap);
      setOverlayPeaksBySession(bySession);
      const activeResult = results.find((item) => item.sid === activeSid)?.result;
      setPeaks(activeResult?.peaks ?? []);
      setAssignments(activeResult?.assignments ?? null);
    } catch (err) {
      setError(String(err));
    } finally {
      setPicking(false);
    }
  }, [activeSid, pre, pk, pickAcrossOverlay, overlayEnabled, overlaySessionIds, sessions]);

  const updateLabelEdit = useCallback((key: string, patch: FTIRLabelEdit) => {
    setLabelEdits((prev) => ({
      ...prev,
      [key]: { ...(prev[key] ?? {}), ...patch },
    }));
  }, []);

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
      },
      analysisState: {
        peaks,
        assignments,
        assignmentsBySession,
        overlayPeaksBySession,
        pickAcrossOverlay,
        labelEdits,
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
      setPre(workspace.viewState.preprocess ?? DEFAULT_PRE);
      setPk({ ...DEFAULT_PEAK, ...(workspace.viewState.peakPick ?? {}) });
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
      setPeaks(workspace.analysisState.peaks ?? []);
      setAssignments(workspace.analysisState.assignments ?? null);
      setAssignmentsBySession(workspace.analysisState.assignmentsBySession ?? {});
      setOverlayPeaksBySession(workspace.analysisState.overlayPeaksBySession ?? {});
      setPickAcrossOverlay(Boolean(workspace.analysisState.pickAcrossOverlay));
      setLabelEdits(workspace.analysisState.labelEdits ?? {});
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
      ["wn", "y", "prominence", "width_cm1", "top_assignment", "score", "plot_label", "label_hidden"],
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
          <button
            className="rounded-md border border-ink-200 bg-white px-3 py-2 text-sm text-ink-700 transition-colors hover:bg-ink-100"
            disabled={busy}
            onClick={() => workspaceFileRef.current?.click()}
          >
            Load workspace
          </button>
          <button
            className="rounded-md border border-ink-200 bg-white px-3 py-2 text-sm text-ink-700 transition-colors hover:bg-ink-100 disabled:cursor-not-allowed disabled:text-ink-400"
            disabled={busy || sessions.length === 0}
            onClick={saveWorkspace}
          >
            Save workspace
          </button>
          <button
            className="rounded-md border border-ink-200 bg-white px-3 py-2 text-sm text-ink-700 transition-colors hover:bg-ink-100 disabled:cursor-not-allowed disabled:text-ink-400"
            disabled={busy || peaks.length === 0}
            onClick={exportPeaksCSV}
          >
            Export peaks CSV
          </button>
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

  return (
    <div
      className="flex h-full flex-col"
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      {dragOver && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-brand-500/10 backdrop-blur-sm">
          <div className="rounded-xl border-2 border-dashed border-brand-500 bg-white px-10 py-8 text-center shadow-xl">
            <div className="text-3xl">📁</div>
            <div className="mt-2 text-sm font-medium text-brand-700">Drop your FTIR file here</div>
          </div>
        </div>
      )}
      {error && (
        <div className="border-b border-red-200 bg-red-50 px-6 py-2 text-sm text-red-700">
          {error}{" "}
          <button className="underline" onClick={() => setError(null)}>
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
          {!active && <EmptyState onPick={() => fileRef.current?.click()} />}

          {active && (
            <>
              <SummaryCard active={active} spectrum={spectrum} peaks={peaks} />

              <PreprocessCard pre={pre} setPre={setPre} />

              <OverlayCard
                sessions={sessions}
                enabled={overlayEnabled}
                setEnabled={setOverlayEnabled}
                selectedIds={overlaySessionIds}
                setSelectedIds={setOverlaySessionIds}
              />

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

              <SpectrumChart
                spectrum={spectrum}
                overlays={overlaySpectra}
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
              />

              {peaks.length > 0 && (
                <PeaksTable
                  sessionId={active.session_id}
                  peaks={peaks}
                  assignments={assignments}
                  labelEdits={labelEdits}
                  onLabelEdit={updateLabelEdit}
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ------------------------------ components ------------------------------

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
              isActive ? "bg-white shadow-card" : "hover:bg-ink-100",
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
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-5">
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
          </select>
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
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {props.sessions.map((session) => (
          <label
            key={session.session_id}
            className="flex min-w-0 items-center gap-2 rounded-md border border-ink-200 bg-white px-2 py-1.5 text-xs"
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
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
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
          <label className="flex h-9 items-center gap-2 rounded-md border border-ink-200 bg-white px-2 text-sm">
            <input
              type="checkbox"
              checked={pk.assign}
              onChange={(e) => setPk({ ...pk, assign: e.target.checked })}
            />
            Use library v2
          </label>
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
    </div>
  );
}

type FTIRRegion = "full" | "fingerprint" | "functional" | "custom";
const FTIR_REGIONS: Record<Exclude<FTIRRegion, "custom">, [number, number]> = {
  full:       [400, 4000],
  fingerprint:[400, 1500],
  functional: [1500, 4000],
};

function SpectrumChart(props: {
  spectrum: FTIRSpectrumResponse | null;
  overlays: FTIROverlaySpectrum[];
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
}) {
  const { spectrum, mode } = props;
  const [region, setRegion] = useState<FTIRRegion>("full");
  const [customMin, setCustomMin] = useState(400);
  const [customMax, setCustomMax] = useState(4000);
  const [showGraphSettings, setShowGraphSettings] = useState(false);
  const plotRef = useRef<unknown>(null);
  const xRange: [number, number] | undefined =
    region === "custom" ? [customMin, customMax] : FTIR_REGIONS[region];
  const visibleOverlays = useMemo(
    () => props.overlays.filter((overlay) => overlay.display_name !== props.title),
    [props.overlays, props.title],
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
        y: overlay.spectrum.y,
        line: {
          width: props.graphSettings.lineWidth,
          color: resolveTraceColor(
            `sid:${overlay.session_id}`,
            OVERLAY_PALETTE[idx % OVERLAY_PALETTE.length],
          ),
        },
        name: overlay.display_name,
        hovertemplate: `${overlay.display_name}<br>%{x:.1f} cm⁻¹<br>%{y:.4g}<extra></extra>`,
        opacity: 0.72,
      }));
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
      textfont: { size: 10, color: props.graphSettings.peakLabelColor },
      marker: { color: props.graphSettings.peakLabelColor, size: 7, symbol: "triangle-down" },
      hovertemplate:
        "peak: %{x:.1f} cm⁻¹<br>y: %{y:.4g}<br>prom: %{customdata:.3g}<extra></extra>",
      customdata: activePeaks.map((p) => p.prominence),
      name: "peaks",
    });
    }
    for (const overlay of visibleOverlays) {
      const overlayPeaks = props.overlayPeaksBySession[overlay.session_id] ?? [];
      if (overlayPeaks.length === 0) continue;
      const color = resolveTraceColor(`sid:${overlay.session_id}`, OVERLAY_PALETTE[0]);
      markerTraces.push({
        type: "scatter",
        mode: "markers",
        x: overlayPeaks.map((p) => p.wn),
        y: overlayPeaks.map((p) => p.y),
        text: overlayPeaks.map((_, idx) => String(idx + 1)),
        textposition: "top center",
        textfont: { size: 10, color },
        marker: { color, size: 6, symbol: "circle-open" },
        hovertemplate:
          `${overlay.display_name} peak #%{text}: %{x:.1f} cm⁻¹<br>y: %{y:.4g}<br>prom: %{customdata:.3g}<extra></extra>`,
        customdata: overlayPeaks.map((p) => p.prominence),
        name: `${overlay.display_name} peaks`,
      });
    }
    return [trace, ...overlayTraces, ...markerTraces];
  }, [
    spectrum,
    props.title,
    visibleOverlays,
    props.graphSettings.lineWidth,
    props.graphSettings.peakLabelColor,
    props.activeSessionId,
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
          bgcolor: "rgba(255,255,255,0.85)",
          bordercolor: props.graphSettings.peakLabelColor,
          borderpad: 2,
          font: { size: 10, color: props.graphSettings.peakLabelColor },
        },
      });
    }
    for (const overlay of visibleOverlays) {
      const overlayPeaks = props.overlayPeaksBySession[overlay.session_id] ?? [];
      const assignments = props.assignmentsBySession[overlay.session_id] ?? null;
      const color = resolveTraceColor(`sid:${overlay.session_id}`, OVERLAY_PALETTE[0]);
      for (const peak of overlayPeaks) {
        const key = peakLabelKey(overlay.session_id, peak.wn);
        const text = resolvedPeakLabel(overlay.session_id, peak, assignments, props.labelEdits);
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
            arrowcolor: color,
            ax: edit?.ax ?? 0,
            ay: edit?.ay ?? -24,
            bgcolor: "rgba(255,255,255,0.78)",
            bordercolor: color,
            borderpad: 2,
            font: { size: 9, color },
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
    props.graphSettings.peakLabelColor,
    props.labelEdits,
    props.overlayPeaksBySession,
    resolveTraceColor,
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

  const layout: Partial<Layout> = useMemo(
    () => ({
      margin: { l: 50, r: 20, t: 8, b: 40 },
      height: 420,
      xaxis: {
        title: { text: "Wavenumber (cm⁻¹)" },
        autorange: xRange ? false : "reversed",
        range: xRange ? [xRange[1], xRange[0]] : undefined,
        zeroline: false,
        showgrid: props.graphSettings.showGrid,
        ticks: props.graphSettings.showTicks ? "outside" : "",
        linecolor: "#475569",
        ...axisFrameProps,
      },
      yaxis: {
        title: { text: mode === "absorbance" ? "Absorbance" : "Transmittance" },
        zeroline: false,
        showgrid: props.graphSettings.showGrid,
        ticks: props.graphSettings.showTicks ? "outside" : "",
        linecolor: "#475569",
        ...axisFrameProps,
      },
      showlegend: props.overlays.length > 1,
      annotations: annotationSpecs.map((item) => item.annotation),
    }),
    [
      annotationSpecs,
      axisFrameProps,
      mode,
      props.graphSettings.showGrid,
      props.graphSettings.showTicks,
      props.overlays.length,
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
          <button
            className="rounded-md border border-ink-200 bg-white px-2 py-1 text-xs text-ink-700 transition-colors hover:bg-ink-100"
            onClick={() => setShowGraphSettings((prev) => !prev)}
          >
            Graph settings
          </button>
          <button
            className="rounded-md border border-ink-200 bg-white px-2 py-1 text-xs text-ink-700 transition-colors hover:bg-ink-100"
            onClick={() => exportPlotImage("svg")}
            disabled={!spectrum}
          >
            Export SVG
          </button>
          <button
            className="rounded-md border border-ink-200 bg-white px-2 py-1 text-xs text-ink-700 transition-colors hover:bg-ink-100"
            onClick={() => exportPlotImage("png")}
            disabled={!spectrum}
          >
            Export PNG
          </button>
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
            <label className="flex h-9 items-center gap-2 rounded-md border border-ink-200 bg-white px-2 text-sm">
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
            <label className="flex h-9 items-center gap-2 rounded-md border border-ink-200 bg-white px-2 text-sm">
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
          <Field label="Peak label color">
            <input
              type="color"
              className="h-9 w-full cursor-pointer rounded-md border border-ink-200 bg-white px-2"
              value={props.graphSettings.peakLabelColor}
              onChange={(e) =>
                props.setGraphSettings({
                  ...props.graphSettings,
                  peakLabelColor: e.target.value,
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
                  className="flex items-center justify-between gap-2 rounded-md border border-ink-200 bg-white px-2 py-1.5 text-xs"
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
  peaks: FTIRPeak[];
  assignments: FTIRAssignment[] | null;
  labelEdits: FTIRLabelEdits;
  onLabelEdit: (key: string, patch: FTIRLabelEdit) => void;
}) {
  const { peaks, assignments } = props;
  const [showLowConf, setShowLowConf] = useState(true);
  const [copied, setCopied] = useState(false);

  const assignmentsByWn = useMemo(() => {
    const m = new Map<number, FTIRAssignment>();
    for (const a of assignments ?? []) m.set(a.wn, a);
    return m;
  }, [assignments]);

  const visiblePeaks = useMemo(() => {
    if (showLowConf || !assignments) return peaks;
    return peaks.filter((p) => {
      const top = assignmentsByWn.get(p.wn)?.candidates?.[0];
      return top == null || top.score >= 40;
    });
  }, [peaks, assignments, assignmentsByWn, showLowConf]);

  const copyCSV = () => {
    const esc = (v: string | number | null | undefined) => {
      const t = v == null ? "" : String(v);
      return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    };
    const rows = [
      ["wn", "y", "prominence", "width_cm1", "top_assignment", "score", "plot_label", "label_hidden"],
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
        <h3 className="text-sm font-semibold">Peaks <span className="text-xs font-normal text-ink-400">({visiblePeaks.length}/{peaks.length})</span></h3>
        <div className="flex items-center gap-2">
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
          <thead className="bg-white">
            <tr>
              <Th>#</Th>
              <Th align="right">Wavenumber (cm⁻¹)</Th>
              <Th align="right">Y</Th>
              <Th align="right">Prominence</Th>
              <Th align="right">Width (cm⁻¹)</Th>
              {assignments && <Th>Top candidate</Th>}
              <Th>Plot label</Th>
              <Th>Hide label</Th>
              {assignments && <Th align="right">Score</Th>}
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
                  <Td>
                    <input
                      className="input w-48 py-1 text-xs"
                      value={edit.text ?? ""}
                      placeholder={defaultLabel}
                      onChange={(event) =>
                        props.onLabelEdit(labelKey, { text: event.target.value })
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
