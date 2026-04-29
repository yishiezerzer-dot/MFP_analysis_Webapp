import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Plot from "react-plotly.js";
import Plotly from "plotly.js-dist-min";
import type { Data, PlotlyHTMLElement } from "plotly.js";
import clsx from "clsx";
import {
  api,
  MICControlStyle,
  MICPlotType,
  MICResult,
  PlatePreview,
  PlateSessionSummary,
} from "../api";
import { PageHeaderContent, usePageHeader } from "../layout/PageHeader";
import { usePlotlyTheme } from "../theme/ThemeProvider";

type RowRole = "none" | "sample" | "control" | "blank";

interface MICChartSettings {
  sampleColor: string;
  controlColor: string;
  blankColor: string;
  lineWidth: number;
  markerSize: number;
  barWidth: number;
  height: number;
  showGrid: boolean;
  showLegend: boolean;
}

const DEFAULT_MIC_CHART_SETTINGS: MICChartSettings = {
  sampleColor: "#5573b9",
  controlColor: "#1e2636",
  blankColor: "#a16207",
  lineWidth: 1.8,
  markerSize: 7,
  barWidth: 0.26,
  height: 380,
  showGrid: true,
  showLegend: true,
};

interface PlateWorkspaceEnvelope {
  version: 1;
  module: "Plate Reader";
  createdAt: string;
  sessions: PlateSessionSummary[];
  sessionNames: Record<string, string>;
  activeSessionId: string | null;
  viewState: {
    sheet: string | null;
    useHeader: boolean;
    rowRoles: Record<number, RowRole>;
    concCols: string[];
    tickText: string;
    autoPow2: boolean;
    subtractBlank: boolean;
    title: string;
    xLabel: string;
    yLabel: string;
    plotType: MICPlotType;
    controlStyle: MICControlStyle;
    chartSettings: MICChartSettings;
  };
  analysisState: {
    mic: MICResult | null;
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

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadCsv(rows: unknown[][], filename: string) {
  const text = rows.map((row) => row.map(csvCell).join(",")).join("\n");
  downloadBlob(new Blob([text], { type: "text/csv;charset=utf-8" }), filename);
}

export function PlateReaderView() {
  const [sessions, setSessions] = useState<PlateSessionSummary[]>([]);
  const [sessionNames, setSessionNames] = useState<Record<string, string>>({});
  const [activeSid, setActiveSid] = useState<string | null>(null);
  const [sheet, setSheet] = useState<string | null>(null);
  const [useHeader, setUseHeader] = useState(true);
  const [preview, setPreview] = useState<PlatePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Wizard state
  const [rowRoles, setRowRoles] = useState<Record<number, RowRole>>({});
  const [concCols, setConcCols] = useState<string[]>([]);
  const [tickText, setTickText] = useState("");
  const [autoPow2, setAutoPow2] = useState(true);
  const [subtractBlank, setSubtractBlank] = useState(false);
  const [title, setTitle] = useState("MIC");
  const [xLabel, setXLabel] = useState("Concentration (µg/mL)");
  const [yLabel, setYLabel] = useState("OD₆₀₀");
  const [plotType, setPlotType] = useState<MICPlotType>("bar");
  const [controlStyle, setControlStyle] = useState<MICControlStyle>("bars");
  const [mic, setMic] = useState<MICResult | null>(null);
  const [chartSettings, setChartSettings] = useState<MICChartSettings>(DEFAULT_MIC_CHART_SETTINGS);

  const fileRef = useRef<HTMLInputElement>(null);
  const workspaceFileRef = useRef<HTMLInputElement>(null);
  const plotRef = useRef<PlotlyHTMLElement | null>(null);

  const active = useMemo(
    () => sessions.find((s) => s.session_id === activeSid) ?? null,
    [sessions, activeSid],
  );
  const displayNameFor = useCallback(
    (session: PlateSessionSummary) => sessionNames[session.session_id] || session.display_name,
    [sessionNames],
  );

  useEffect(() => {
    api.plateReader
      .list()
      .then((list) => {
        setSessions(list);
        setSessionNames((prev) => ({
          ...Object.fromEntries(list.map((session) => [session.session_id, session.display_name])),
          ...prev,
        }));
        if (list.length && !activeSid) setActiveSid(list[0].session_id);
      })
      .catch((err) => setError(String(err)));
  }, []); // eslint-disable-line

  useEffect(() => {
    if (!active) return;
    setSheet(active.sheets[0] ?? null);
  }, [active?.session_id]); // eslint-disable-line

  const loadPreview = useCallback(async () => {
    if (!activeSid) return;
    setBusy(true);
    setError(null);
    try {
      const p = await api.plateReader.loadSheet(activeSid, {
        sheet_name: sheet ?? null,
        use_first_row_as_header: useHeader,
        max_rows: 500,
      });
      setPreview(p);
      setMic(null);
      setRowRoles({});
      setConcCols([]);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }, [activeSid, sheet, useHeader]);

  useEffect(() => {
    if (activeSid) void loadPreview();
  }, [activeSid, sheet, useHeader]); // eslint-disable-line

  const onRemove = async (sid: string) => {
    await api.plateReader.remove(sid).catch((e) => setError(String(e)));
    setSessions((prev) => prev.filter((s) => s.session_id !== sid));
    setSessionNames((prev) => {
      const next = { ...prev };
      delete next[sid];
      return next;
    });
    if (activeSid === sid) {
      setActiveSid(null);
      setPreview(null);
      setMic(null);
    }
  };

  const setRole = (idx: number, role: RowRole) => {
    setRowRoles((prev) => {
      const copy = { ...prev };
      if (role === "none") delete copy[idx];
      else copy[idx] = role;
      return copy;
    });
  };

  const toggleConcCol = (col: string) => {
    setConcCols((prev) => (prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col]));
  };

  const moveConcCol = (col: string, dir: -1 | 1) => {
    setConcCols((prev) => {
      const idx = prev.indexOf(col);
      if (idx < 0) return prev;
      const newIdx = idx + dir;
      if (newIdx < 0 || newIdx >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[newIdx]] = [next[newIdx], next[idx]];
      return next;
    });
  };

  const onUpload = async (file: File) => {
    const baseName = file.name.replace(/\.[^.]+$/, "");
    setTitle(baseName || "MIC");
    setBusy(true);
    setError(null);
    try {
      const s = await api.plateReader.upload(file);
      setSessions((prev) => [...prev, s]);
      setSessionNames((prev) => ({ ...prev, [s.session_id]: s.display_name }));
      setActiveSid(s.session_id);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const sampleRows = useMemo(
    () =>
      Object.entries(rowRoles)
        .filter(([, r]) => r === "sample")
        .map(([i]) => Number(i))
        .sort((a, b) => a - b),
    [rowRoles],
  );
  const controlRows = useMemo(
    () =>
      Object.entries(rowRoles)
        .filter(([, r]) => r === "control")
        .map(([i]) => Number(i))
        .sort((a, b) => a - b),
    [rowRoles],
  );
  const blankRows = useMemo(
    () =>
      Object.entries(rowRoles)
        .filter(([, r]) => r === "blank")
        .map(([i]) => Number(i))
        .sort((a, b) => a - b),
    [rowRoles],
  );

  const canRun = activeSid && sampleRows.length > 0 && concCols.length > 0;

  const autoPickNumericColumns = () => {
    if (!preview) return;
    const roleRows = [...sampleRows, ...controlRows, ...blankRows];
    const rowsToScan = roleRows.length > 0 ? roleRows : preview.rows.map((_, idx) => idx);
    const numericColumns = preview.columns.filter((_, colIdx) =>
      rowsToScan.some((rowIdx) => {
        const raw = preview.rows[rowIdx]?.[colIdx];
        if (raw === undefined || raw === null || String(raw).trim() === "") return false;
        return Number.isFinite(Number(String(raw).replace(",", ".")));
      }),
    );
    setConcCols(numericColumns);
  };

  const clearSelections = () => {
    setRowRoles({});
    setConcCols([]);
    setMic(null);
  };

  const runMIC = async () => {
    if (!activeSid) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.plateReader.runMIC(activeSid, {
        sheet_name: sheet ?? null,
        use_first_row_as_header: useHeader,
        sample_rows: sampleRows,
        control_rows: controlRows,
        blank_rows: blankRows,
        subtract_blank: subtractBlank,
        concentration_columns: concCols,
        tick_text: tickText,
        auto_tick_labels_power2: autoPow2,
        title,
        x_label: xLabel,
        y_label: yLabel,
        plot_type: plotType,
        control_style: controlStyle,
      });
      setMic(res);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const renameSession = (session: PlateSessionSummary) => {
    const nextName = window.prompt("Session name", displayNameFor(session));
    if (!nextName?.trim()) return;
    setSessionNames((prev) => ({ ...prev, [session.session_id]: nextName.trim() }));
  };

  const clearSessions = async () => {
    if (sessions.length === 0) return;
    if (!window.confirm("Clear all Plate Reader sessions?")) return;
    await Promise.all(sessions.map((session) => api.plateReader.remove(session.session_id).catch(() => null)));
    setSessions([]);
    setSessionNames({});
    setActiveSid(null);
    setPreview(null);
    setMic(null);
    setRowRoles({});
    setConcCols([]);
    setSubtractBlank(false);
  };

  const saveWorkspace = () => {
    const workspace: PlateWorkspaceEnvelope = {
      version: 1,
      module: "Plate Reader",
      createdAt: new Date().toISOString(),
      sessions,
      sessionNames,
      activeSessionId: activeSid,
      viewState: {
        sheet,
        useHeader,
        rowRoles,
        concCols,
        tickText,
        autoPow2,
        subtractBlank,
        title,
        xLabel,
        yLabel,
        plotType,
        controlStyle,
        chartSettings,
      },
      analysisState: {
        mic,
      },
    };
    downloadJson(workspace, "plate-reader.workspace.json");
  };

  const loadWorkspaceFile = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const workspace = await readJsonFile<PlateWorkspaceEnvelope>(file);
      if (workspace.module !== "Plate Reader") {
        throw new Error("This is not a Plate Reader workspace file.");
      }
      const availableIds = new Set(sessions.map((session) => session.session_id));
      const missing = workspace.sessions.filter((session) => !availableIds.has(session.session_id));
      setSessionNames((prev) => ({ ...prev, ...(workspace.sessionNames ?? {}) }));
      setSheet(workspace.viewState.sheet ?? null);
      setUseHeader(workspace.viewState.useHeader ?? true);
      setRowRoles(workspace.viewState.rowRoles ?? {});
      setConcCols(workspace.viewState.concCols ?? []);
      setTickText(workspace.viewState.tickText ?? "");
      setAutoPow2(workspace.viewState.autoPow2 ?? true);
      setSubtractBlank(workspace.viewState.subtractBlank ?? false);
      setTitle(workspace.viewState.title ?? "MIC");
      setXLabel(workspace.viewState.xLabel ?? "Concentration");
      setYLabel(workspace.viewState.yLabel ?? "OD 600nm");
      setPlotType(workspace.viewState.plotType ?? "bar");
      setControlStyle(workspace.viewState.controlStyle ?? "bars");
      setChartSettings({
        ...DEFAULT_MIC_CHART_SETTINGS,
        ...(workspace.viewState.chartSettings ?? {}),
      });
      setMic(workspace.analysisState.mic ?? null);
      const restoredActive =
        workspace.activeSessionId && availableIds.has(workspace.activeSessionId)
          ? workspace.activeSessionId
          : workspace.sessions.find((session) => availableIds.has(session.session_id))?.session_id;
      if (restoredActive) {
        setActiveSid(restoredActive);
      }
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

  const exportMICCsv = () => {
    if (!mic) return;
    const rows: unknown[][] = [
      [
        "concentration",
        "tick_label",
        "sample_mean",
        "sample_std",
        "control_mean",
        "control_std",
        "blank_mean",
        "blank_std",
      ],
    ];
    mic.result.concentrations.forEach((conc, idx) => {
      rows.push([
        conc,
        mic.result.x_tick_labels[idx] ?? "",
        mic.result.sample_mean[idx],
        mic.result.sample_std[idx],
        mic.result.control_mean?.[idx] ?? "",
        mic.result.control_std?.[idx] ?? "",
        mic.result.blank_mean?.[idx] ?? "",
        mic.result.blank_std?.[idx] ?? "",
      ]);
    });
    downloadCsv(rows, "plate-reader-mic.csv");
  };

  const exportMICJson = () => {
    if (!mic) return;
    downloadJson(
      {
        exportedAt: new Date().toISOString(),
        activeSession: active,
        displayName: active ? displayNameFor(active) : null,
        chartSettings,
        mic,
      },
      "plate-reader-mic.json",
    );
  };

  const exportPlotImage = (format: "png" | "svg") => {
    if (!plotRef.current) return;
    void Plotly.downloadImage(plotRef.current, {
      format,
      filename: `plate-reader-mic.${format}`,
      width: 1100,
      height: chartSettings.height,
    });
  };

  usePageHeader(
    <PageHeaderContent
      title="Plate Reader"
      subtitle="MIC wizard — upload a plate, mark sample/control rows, pick concentration columns, run"
      actions={
        <>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xlsm,.xls,.csv,.tsv,.txt"
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
            accept=".json,.plate_reader.workspace.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void loadWorkspaceFile(f);
              e.target.value = "";
            }}
          />
          <button className="btn-ghost" disabled={busy} onClick={() => workspaceFileRef.current?.click()}>
            Load workspace
          </button>
          <button className="btn-ghost" disabled={busy || sessions.length === 0} onClick={saveWorkspace}>
            Save workspace
          </button>
          <button className="btn-ghost" disabled={busy || sessions.length === 0} onClick={clearSessions}>
            Clear
          </button>
          <button className="btn-primary" disabled={busy} onClick={() => fileRef.current?.click()}>
            {busy ? "Working…" : "Open plate…"}
          </button>
        </>
      }
    />,
  );

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

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-64 shrink-0 flex-col gap-1 border-r border-ink-200 bg-ink-50/50 p-3">
          <div className="label px-2 pb-1">Sessions</div>
          {sessions.length === 0 && (
            <div className="px-2 text-xs text-ink-500">No plate loaded.</div>
          )}
          {sessions.map((s) => {
            const isActive = s.session_id === activeSid;
            return (
              <div
                key={s.session_id}
                className={clsx(
                  "group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm",
                  isActive ? "bg-white shadow-card" : "hover:bg-ink-100",
                )}
                onClick={() => setActiveSid(s.session_id)}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{displayNameFor(s)}</div>
                  <div className="text-[11px] text-ink-500">
                    {s.sheets.length
                      ? `${s.sheets.length} sheet${s.sheets.length === 1 ? "" : "s"}`
                      : "CSV"}
                  </div>
                </div>
                <button
                  className="invisible rounded px-1 text-xs text-ink-500 hover:bg-ink-200 group-hover:visible"
                  onClick={(e) => {
                    e.stopPropagation();
                    renameSession(s);
                  }}
                  title="Rename"
                >
                  Rename
                </button>
                <button
                  className="invisible rounded px-1 text-xs text-ink-500 hover:bg-ink-200 group-hover:visible"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove(s.session_id);
                  }}
                  title="Remove"
                >
                  ✕
                </button>
              </div>
            );
          })}
        </aside>

        <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-auto p-6">
          {!active && <EmptyState onPick={() => fileRef.current?.click()} />}

          {active && (
            <>
              <LoadControls
                active={active}
                displayName={displayNameFor(active)}
                sheet={sheet}
                setSheet={setSheet}
                useHeader={useHeader}
                setUseHeader={setUseHeader}
              />

              {preview && (
                <PreviewTable
                  preview={preview}
                  rowRoles={rowRoles}
                  concCols={concCols}
                  onSetRole={setRole}
                  onToggleCol={toggleConcCol}
                  onMoveConcCol={moveConcCol}
                />
              )}

              {preview && (
                <WizardForm
                  sampleRows={sampleRows}
                  controlRows={controlRows}
                  blankRows={blankRows}
                  concCols={concCols}
                  tickText={tickText}
                  setTickText={setTickText}
                  autoPow2={autoPow2}
                  setAutoPow2={setAutoPow2}
                  subtractBlank={subtractBlank}
                  setSubtractBlank={setSubtractBlank}
                  title={title}
                  setTitle={setTitle}
                  xLabel={xLabel}
                  setXLabel={setXLabel}
                  yLabel={yLabel}
                  setYLabel={setYLabel}
                  plotType={plotType}
                  setPlotType={setPlotType}
                  controlStyle={controlStyle}
                  setControlStyle={setControlStyle}
                  canRun={!!canRun}
                  busy={busy}
                  onRun={runMIC}
                  onAutoPickNumericCols={autoPickNumericColumns}
                  onReverseConcCols={() => setConcCols((prev) => [...prev].reverse())}
                  onClearSelections={clearSelections}
                />
              )}

              {mic && (
                <div className="card shrink-0 border-brand-200 bg-brand-50/50 px-4 py-3">
                  <div className="text-heading mb-2">MIC Analysis Complete</div>
                  <div className="flex flex-wrap gap-4 text-sm">
                    <span>
                      <span className="font-medium text-ink-600">Sample rows:</span>{" "}
                      <span className="font-mono text-brand-700">{sampleRows.length}</span>
                    </span>
                    <span>
                      <span className="font-medium text-ink-600">Control rows:</span>{" "}
                      <span className="font-mono text-brand-700">{controlRows.length}</span>
                    </span>
                    <span>
                      <span className="font-medium text-ink-600">Blank rows:</span>{" "}
                      <span className="font-mono text-brand-700">{blankRows.length}</span>
                    </span>
                    <span>
                      <span className="font-medium text-ink-600">Concentrations:</span>{" "}
                      <span className="font-mono text-brand-700">{concCols.length}</span>
                    </span>
                    {blankRows.length > 0 && subtractBlank && (
                      <span className="text-amber-700">Blank-subtracted</span>
                    )}
                    {mic.result.concentrations.length > 0 && (
                      <span>
                        <span className="font-medium text-ink-600">Range:</span>{" "}
                        <span className="font-mono text-brand-700">
                          {mic.result.concentrations[0]} – {mic.result.concentrations[mic.result.concentrations.length - 1]}
                        </span>
                      </span>
                    )}
                    {mic.sample_nan_ratio > 0 && (
                      <span className="text-amber-700">
                        ⚠ {(mic.sample_nan_ratio * 100).toFixed(1)}% non-numeric cells ignored
                      </span>
                    )}
                  </div>
                </div>
              )}
              {mic && (
                <>
                  <ChartControls
                    settings={chartSettings}
                    setSettings={setChartSettings}
                    onExportCsv={exportMICCsv}
                    onExportJson={exportMICJson}
                    onExportPng={() => exportPlotImage("png")}
                    onExportSvg={() => exportPlotImage("svg")}
                  />
                  <MICChart
                    mic={mic}
                    settings={chartSettings}
                    onReady={(plot) => {
                      plotRef.current = plot;
                    }}
                  />
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------- components ----------------------------

function LoadControls(props: {
  active: PlateSessionSummary;
  displayName: string;
  sheet: string | null;
  setSheet: (s: string | null) => void;
  useHeader: boolean;
  setUseHeader: (b: boolean) => void;
}) {
  const hasSheets = props.active.sheets.length > 0;
  return (
    <div className="card flex shrink-0 flex-wrap items-end gap-4 px-4 py-3">
      <div>
        <div className="label">File</div>
        <div className="text-sm font-medium">{props.displayName}</div>
      </div>
      {hasSheets && (
        <div>
          <div className="label">Sheet</div>
          <select
            className="mt-1 rounded border border-ink-200 bg-white px-2 py-1 text-sm"
            value={props.sheet ?? ""}
            onChange={(e) => props.setSheet(e.target.value || null)}
          >
            {props.active.sheets.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      )}
      <label className="flex cursor-pointer select-none items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={props.useHeader}
          onChange={(e) => props.setUseHeader(e.target.checked)}
        />
        First row is column headers
      </label>
    </div>
  );
}

function roleLabel(role: RowRole) {
  if (role === "sample") return "S";
  if (role === "control") return "C";
  if (role === "blank") return "B";
  return "-";
}

function activeRoleClass(role: RowRole) {
  if (role === "sample") return "bg-brand-500 text-white";
  if (role === "control") return "bg-ink-800 text-white";
  if (role === "blank") return "bg-amber-500 text-white";
  return "bg-ink-200 text-ink-600";
}

function PreviewTable(props: {
  preview: PlatePreview;
  rowRoles: Record<number, RowRole>;
  concCols: string[];
  onSetRole: (idx: number, role: RowRole) => void;
  onToggleCol: (col: string) => void;
  onMoveConcCol: (col: string, dir: -1 | 1) => void;
}) {
  const { preview, rowRoles, concCols } = props;
  return (
    <div className="card shrink-0">
      <div className="flex items-baseline justify-between border-b border-ink-200 px-4 py-2">
        <h3 className="text-sm font-semibold">Plate preview</h3>
        <div className="text-xs text-ink-500">
          {preview.n_rows_preview.toLocaleString()} of{" "}
          {preview.n_rows_total.toLocaleString()} rows · {preview.n_cols_total} cols
          <span className="ml-3 text-ink-400">Click column headers to mark concentration. Use row buttons to assign roles.</span>
        </div>
      </div>

      {concCols.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-ink-100 bg-ink-50/50 px-4 py-2 text-xs">
          <span className="text-ink-500">Concentration columns (ordered):</span>
          {concCols.map((c, i) => (
            <span
              key={c}
              className="inline-flex items-center gap-0.5 rounded-full bg-white px-2 py-0.5 font-medium ring-1 ring-ink-200"
            >
              <span className="text-[10px] text-ink-400 mr-0.5">{i + 1}</span>
              <span>{c}</span>
              <button
                className="px-0.5 text-ink-400 hover:text-ink-900 disabled:opacity-30"
                onClick={() => props.onMoveConcCol(c, -1)}
                disabled={i === 0}
                title="Move left"
              >↑</button>
              <button
                className="px-0.5 text-ink-400 hover:text-ink-900 disabled:opacity-30"
                onClick={() => props.onMoveConcCol(c, 1)}
                disabled={i === concCols.length - 1}
                title="Move right"
              >↓</button>
              <button
                className="ml-1 text-ink-300 hover:text-red-500"
                onClick={() => props.onToggleCol(c)}
                title="Remove"
              >✕</button>
            </span>
          ))}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="min-w-full border-separate border-spacing-0 text-xs">
          <thead className="bg-white">
            <tr>
              <th className="border-b border-ink-200 bg-ink-50 px-2 py-1.5 text-left font-medium text-ink-500">
                #
              </th>
              {preview.columns.map((c) => {
                const active = concCols.includes(c);
                return (
                  <th
                    key={c}
                    onClick={() => props.onToggleCol(c)}
                    className={clsx(
                      "cursor-pointer select-none border-b border-ink-200 px-2 py-1.5 text-left font-medium",
                      active ? "bg-brand-500 text-white" : "bg-ink-50 text-ink-700 hover:bg-ink-100",
                    )}
                    title={active ? "Remove from concentration columns" : "Add as concentration column"}
                  >
                    {c}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {preview.rows.map((row, i) => {
              const role = rowRoles[i] ?? "none";
              return (
                <tr key={i} className="even:bg-ink-50/50">
                  <td className="border-b border-ink-100 px-1 py-0.5 whitespace-nowrap">
                    <div className="flex items-center gap-1">
                      <span className="w-5 shrink-0 text-right text-[10px] text-ink-400">{i + 1}</span>
                      {(["none", "sample", "control", "blank"] as RowRole[]).map((r) => (
                        <button
                          key={r}
                          onClick={() => props.onSetRole(i, r)}
                          className={clsx(
                            "rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors",
                            role === r ? activeRoleClass(r) : "border border-ink-200 bg-white text-ink-400 hover:bg-ink-100",
                          )}
                        >
                          {roleLabel(r)}
                        </button>
                      ))}
                    </div>
                  </td>
                  {row.map((cell, j) => (
                    <td
                      key={j}
                      className={clsx(
                        "whitespace-nowrap border-b border-ink-100 px-2 py-1 font-mono text-[11px]",
                        concCols.includes(preview.columns[j]) && "bg-ink-50",
                      )}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function WizardForm(props: {
  sampleRows: number[];
  controlRows: number[];
  blankRows: number[];
  concCols: string[];
  tickText: string;
  setTickText: (s: string) => void;
  autoPow2: boolean;
  setAutoPow2: (b: boolean) => void;
  subtractBlank: boolean;
  setSubtractBlank: (b: boolean) => void;
  title: string;
  setTitle: (s: string) => void;
  xLabel: string;
  setXLabel: (s: string) => void;
  yLabel: string;
  setYLabel: (s: string) => void;
  plotType: MICPlotType;
  setPlotType: (t: MICPlotType) => void;
  controlStyle: MICControlStyle;
  setControlStyle: (s: MICControlStyle) => void;
  canRun: boolean;
  busy: boolean;
  onRun: () => void;
  onAutoPickNumericCols: () => void;
  onReverseConcCols: () => void;
  onClearSelections: () => void;
}) {
  return (
    <div className="card shrink-0 p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="text-sm font-semibold">MIC wizard</h3>
        <div className="text-xs text-ink-500">
          <span className="mr-3">
            Sample rows: <b>{props.sampleRows.length}</b>
          </span>
          <span className="mr-3">
            Control rows: <b>{props.controlRows.length}</b>
          </span>
          <span className="mr-3">
            Blank rows: <b>{props.blankRows.length}</b>
          </span>
          <span>
            Conc. columns: <b>{props.concCols.length}</b>
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Field label="Title">
          <input
            className="input"
            value={props.title}
            onChange={(e) => props.setTitle(e.target.value)}
          />
        </Field>
        <Field label="X label">
          <input
            className="input"
            value={props.xLabel}
            onChange={(e) => props.setXLabel(e.target.value)}
          />
        </Field>
        <Field label="Y label">
          <input
            className="input"
            value={props.yLabel}
            onChange={(e) => props.setYLabel(e.target.value)}
          />
        </Field>
        <Field label="Tick labels (comma-sep)">
          <input
            className="input"
            placeholder={props.autoPow2 ? "auto: 1024, 512, …, 0" : "e.g. 1024, 512, 256, 0"}
            value={props.tickText}
            onChange={(e) => props.setTickText(e.target.value)}
          />
        </Field>
        <Field label="Plot type">
          <Segmented
            value={props.plotType}
            options={["bar", "line", "scatter"] as MICPlotType[]}
            onChange={props.setPlotType}
          />
        </Field>
        <Field label="Control style">
          <Segmented
            value={props.controlStyle}
            options={["bars", "line"] as MICControlStyle[]}
            onChange={props.setControlStyle}
          />
        </Field>
        <Field label="Auto tick labels (2^n … 0)">
          <label className="mt-1.5 inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={props.autoPow2}
              onChange={(e) => props.setAutoPow2(e.target.checked)}
            />
            Enabled (used when tick labels field is empty)
          </label>
        </Field>
        <Field label="Blank subtraction">
          <label className="mt-1.5 inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={props.subtractBlank}
              disabled={props.blankRows.length === 0}
              onChange={(e) => props.setSubtractBlank(e.target.checked)}
            />
            Subtract blank row mean
          </label>
        </Field>
        <div className="flex flex-wrap items-end gap-2">
          <button className="btn-ghost" type="button" onClick={props.onAutoPickNumericCols}>
            Auto numeric cols
          </button>
          <button
            className="btn-ghost"
            type="button"
            disabled={props.concCols.length < 2}
            onClick={props.onReverseConcCols}
          >
            Reverse cols
          </button>
          <button className="btn-ghost" type="button" onClick={props.onClearSelections}>
            Clear picks
          </button>
        </div>
        <div className="flex items-end">
          <button
            className="btn-primary w-full justify-center"
            disabled={!props.canRun || props.busy}
            onClick={props.onRun}
          >
            {props.busy ? "Running…" : "Run MIC"}
          </button>
        </div>
      </div>
      {!props.canRun && (
        <div className="mt-3 rounded-md bg-ink-50 px-3 py-2 text-xs text-ink-600">
          Select at least one <b>sample</b> row (click row numbers) and one or more
          <b> concentration columns</b> (click column headers).
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col text-xs text-ink-600">
      <span className="label mb-1">{label}</span>
      {children}
    </label>
  );
}

function Segmented<T extends string>(props: {
  value: T;
  options: T[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="mt-1 inline-flex rounded-md border border-ink-200 bg-white p-0.5 text-xs">
      {props.options.map((o) => (
        <button
          key={o}
          className={clsx(
            "rounded px-2 py-1",
            props.value === o ? "bg-brand-500 text-white" : "text-ink-600 hover:bg-ink-100",
          )}
          onClick={() => props.onChange(o)}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

function ChartControls(props: {
  settings: MICChartSettings;
  setSettings: React.Dispatch<React.SetStateAction<MICChartSettings>>;
  onExportCsv: () => void;
  onExportJson: () => void;
  onExportPng: () => void;
  onExportSvg: () => void;
}) {
  const setNumber = (key: keyof MICChartSettings, value: string, min: number, max: number) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    props.setSettings((prev) => ({ ...prev, [key]: Math.min(max, Math.max(min, parsed)) }));
  };

  return (
    <div className="card shrink-0 p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="text-sm font-semibold">MIC plot and exports</h3>
        <div className="flex flex-wrap gap-2">
          <button className="btn-ghost" onClick={props.onExportCsv}>CSV</button>
          <button className="btn-ghost" onClick={props.onExportJson}>JSON</button>
          <button className="btn-ghost" onClick={props.onExportPng}>PNG</button>
          <button className="btn-ghost" onClick={props.onExportSvg}>SVG</button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Field label="Sample color">
          <input
            className="h-9 w-full cursor-pointer rounded border border-ink-200 bg-white p-1"
            type="color"
            value={props.settings.sampleColor}
            onChange={(e) => props.setSettings((prev) => ({ ...prev, sampleColor: e.target.value }))}
          />
        </Field>
        <Field label="Control color">
          <input
            className="h-9 w-full cursor-pointer rounded border border-ink-200 bg-white p-1"
            type="color"
            value={props.settings.controlColor}
            onChange={(e) => props.setSettings((prev) => ({ ...prev, controlColor: e.target.value }))}
          />
        </Field>
        <Field label="Blank color">
          <input
            className="h-9 w-full cursor-pointer rounded border border-ink-200 bg-white p-1"
            type="color"
            value={props.settings.blankColor}
            onChange={(e) => props.setSettings((prev) => ({ ...prev, blankColor: e.target.value }))}
          />
        </Field>
        <Field label="Line width">
          <input
            className="input"
            type="number"
            min={0.2}
            max={10}
            step={0.1}
            value={props.settings.lineWidth}
            onChange={(e) => setNumber("lineWidth", e.target.value, 0.2, 10)}
          />
        </Field>
        <Field label="Marker size">
          <input
            className="input"
            type="number"
            min={1}
            max={30}
            step={1}
            value={props.settings.markerSize}
            onChange={(e) => setNumber("markerSize", e.target.value, 1, 30)}
          />
        </Field>
        <Field label="Bar width">
          <input
            className="input"
            type="number"
            min={0.05}
            max={0.9}
            step={0.05}
            value={props.settings.barWidth}
            onChange={(e) => setNumber("barWidth", e.target.value, 0.05, 0.9)}
          />
        </Field>
        <Field label="Height">
          <input
            className="input"
            type="number"
            min={260}
            max={900}
            step={20}
            value={props.settings.height}
            onChange={(e) => setNumber("height", e.target.value, 260, 900)}
          />
        </Field>
        <Field label="Layout">
          <div className="mt-1.5 flex flex-wrap gap-3 text-sm">
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={props.settings.showGrid}
                onChange={(e) => props.setSettings((prev) => ({ ...prev, showGrid: e.target.checked }))}
              />
              Grid
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={props.settings.showLegend}
                onChange={(e) => props.setSettings((prev) => ({ ...prev, showLegend: e.target.checked }))}
              />
              Legend
            </label>
          </div>
        </Field>
      </div>
    </div>
  );
}

function MICChart({
  mic,
  settings,
  onReady,
}: {
  mic: MICResult;
  settings: MICChartSettings;
  onReady: (plot: PlotlyHTMLElement) => void;
}) {
  const pt = usePlotlyTheme();
  const { config, result, sample_nan_ratio } = mic;
  const xs = result.concentrations;
  const labels = result.x_tick_labels;
  const hasControl =
    result.control_mean !== null &&
    Array.isArray(result.control_mean) &&
    result.control_mean.length === result.sample_mean.length;
  const hasBlank =
    Array.isArray(result.blank_mean) &&
    result.blank_mean.length === result.sample_mean.length;

  const errBars = (arr: number[] | null | undefined) => ({
    type: "data" as const,
    array: (arr ?? []) as number[],
    visible: true,
    thickness: Math.max(0.8, settings.lineWidth * 0.55),
  });

  const data: Data[] = [];
  if (config.plot_type === "bar") {
    if (hasControl && config.control_style === "bars") {
      data.push({
        type: "bar",
        name: "Sample",
        x: xs,
        y: result.sample_mean,
        error_y: errBars(result.sample_std),
        marker: { color: settings.sampleColor },
        width: settings.barWidth,
        offsetgroup: "sample",
      } as unknown as Data);
      data.push({
        type: "bar",
        name: "Control",
        x: xs,
        y: result.control_mean!,
        error_y: errBars(result.control_std),
        marker: { color: settings.controlColor },
        width: settings.barWidth,
        offsetgroup: "control",
      } as unknown as Data);
    } else {
      data.push({
        type: "bar",
        name: "Sample",
        x: xs,
        y: result.sample_mean,
        error_y: errBars(result.sample_std),
        marker: { color: settings.sampleColor },
        width: settings.barWidth,
      });
      if (hasControl) {
        data.push({
          type: "scatter",
          mode: "lines+markers",
          name: "Control",
          x: xs,
          y: result.control_mean!,
          error_y: errBars(result.control_std),
          line: { color: settings.controlColor, width: settings.lineWidth },
          marker: { color: settings.controlColor, size: settings.markerSize },
        });
      }
    }
  } else {
    const mode = config.plot_type === "scatter" ? "markers" : "lines+markers";
    data.push({
      type: "scatter",
      mode,
      name: "Sample",
      x: xs,
      y: result.sample_mean,
      error_y: errBars(result.sample_std),
      line: { color: settings.sampleColor, width: settings.lineWidth },
      marker: { color: settings.sampleColor, size: settings.markerSize },
    });
    if (hasControl) {
      data.push({
        type: "scatter",
        mode,
        name: "Control",
        x: xs,
        y: result.control_mean!,
        error_y: errBars(result.control_std),
        line: { color: settings.controlColor, width: settings.lineWidth },
        marker: { color: settings.controlColor, size: settings.markerSize },
      });
    }
  }
  if (hasBlank) {
    data.push({
      type: "scatter",
      mode: "lines+markers",
      name: config.subtract_blank ? "Blank baseline" : "Blank",
      x: xs,
      y: result.blank_mean!,
      error_y: errBars(result.blank_std),
      line: { color: settings.blankColor, width: settings.lineWidth, dash: "dot" },
      marker: { color: settings.blankColor, size: Math.max(4, settings.markerSize - 1) },
    });
  }

  return (
    <div className="card shrink-0 p-3">
      <div className="flex items-baseline justify-between px-1 pb-1">
        <h3 className="text-sm font-semibold">{config.title || "MIC"}</h3>
        <div className="text-xs text-ink-500">
          {sample_nan_ratio > 0 && (
            <span className="mr-3 text-amber-700">
              {(sample_nan_ratio * 100).toFixed(1)}% of sample cells were non-numeric (treated as
              NaN)
            </span>
          )}
          <span>
            {labels.join(", ")}
          </span>
        </div>
      </div>
      <Plot
        data={data}
        layout={{
          height: settings.height,
          margin: { l: 60, r: 20, t: 20, b: 50 },
          barmode: "group",
          bargap: 0.25,
          xaxis: {
            title: { text: config.x_label || "Concentration" },
            tickmode: "array",
            tickvals: xs,
            ticktext: labels,
            autorange: config.invert_x ? "reversed" : true,
            showgrid: settings.showGrid,
          },
          yaxis: {
            title: { text: config.y_label || "OD 600nm" },
            rangemode: "tozero",
            showgrid: settings.showGrid,
          },
          plot_bgcolor: pt.plot_bgcolor,
          paper_bgcolor: pt.paper_bgcolor,
          showlegend: settings.showLegend,
          legend: { orientation: "h", y: -0.2 },
        }}
        config={{ responsive: true, displaylogo: false }}
        style={{ width: "100%" }}
        useResizeHandler
        onInitialized={(_, graphDiv) => onReady(graphDiv as PlotlyHTMLElement)}
        onUpdate={(_, graphDiv) => onReady(graphDiv as PlotlyHTMLElement)}
      />
    </div>
  );
}

function EmptyState(props: { onPick: () => void }) {
  return (
    <div className="card flex shrink-0 flex-col items-center justify-center gap-3 p-12 text-center">
      <div className="text-4xl">🧫</div>
      <div>
        <div className="text-lg font-semibold">Open a plate file to begin</div>
        <div className="text-sm text-ink-500">
          Supported: .xlsx, .xlsm, .xls, .csv, .tsv, .txt
        </div>
      </div>
      <button className="btn-primary" onClick={props.onPick}>
        Open plate…
      </button>
    </div>
  );
}
