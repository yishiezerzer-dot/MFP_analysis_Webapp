import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Plot from "react-plotly.js";
import type { Data } from "plotly.js";
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

type RowRole = "none" | "sample" | "control";

export function PlateReaderView() {
  const [sessions, setSessions] = useState<PlateSessionSummary[]>([]);
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
  const [title, setTitle] = useState("MIC");
  const [xLabel, setXLabel] = useState("Concentration");
  const [yLabel, setYLabel] = useState("OD 600nm");
  const [plotType, setPlotType] = useState<MICPlotType>("bar");
  const [controlStyle, setControlStyle] = useState<MICControlStyle>("bars");
  const [mic, setMic] = useState<MICResult | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);

  const active = useMemo(
    () => sessions.find((s) => s.session_id === activeSid) ?? null,
    [sessions, activeSid],
  );

  useEffect(() => {
    api.plateReader
      .list()
      .then((list) => {
        setSessions(list);
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

  const onUpload = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const s = await api.plateReader.upload(file);
      setSessions((prev) => [...prev, s]);
      setActiveSid(s.session_id);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const onRemove = async (sid: string) => {
    await api.plateReader.remove(sid).catch((e) => setError(String(e)));
    setSessions((prev) => prev.filter((s) => s.session_id !== sid));
    if (activeSid === sid) {
      setActiveSid(null);
      setPreview(null);
      setMic(null);
    }
  };

  const cycleRole = (idx: number) => {
    setRowRoles((prev) => {
      const cur = prev[idx] ?? "none";
      const next: RowRole = cur === "none" ? "sample" : cur === "sample" ? "control" : "none";
      const copy = { ...prev };
      if (next === "none") delete copy[idx];
      else copy[idx] = next;
      return copy;
    });
  };

  const toggleConcCol = (col: string) => {
    setConcCols((prev) => (prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col]));
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

  const canRun = activeSid && sampleRows.length > 0 && concCols.length > 0;

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
                  <div className="truncate font-medium">{s.display_name}</div>
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
                  onCycleRole={cycleRole}
                  onToggleCol={toggleConcCol}
                />
              )}

              {preview && (
                <WizardForm
                  sampleRows={sampleRows}
                  controlRows={controlRows}
                  concCols={concCols}
                  tickText={tickText}
                  setTickText={setTickText}
                  autoPow2={autoPow2}
                  setAutoPow2={setAutoPow2}
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
                />
              )}

              {mic && <MICChart mic={mic} />}
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
        <div className="text-sm font-medium">{props.active.display_name}</div>
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

function PreviewTable(props: {
  preview: PlatePreview;
  rowRoles: Record<number, RowRole>;
  concCols: string[];
  onCycleRole: (idx: number) => void;
  onToggleCol: (col: string) => void;
}) {
  const { preview, rowRoles, concCols } = props;
  return (
    <div className="card shrink-0">
      <div className="flex items-baseline justify-between border-b border-ink-200 px-4 py-2">
        <h3 className="text-sm font-semibold">Plate preview</h3>
        <div className="text-xs text-ink-500">
          {preview.n_rows_preview.toLocaleString()} of{" "}
          {preview.n_rows_total.toLocaleString()} rows · {preview.n_cols_total} cols
          <span className="ml-3 rounded bg-ink-50 px-1.5 py-0.5 font-medium text-ink-600">
            click row # to cycle: none → sample → control
          </span>
        </div>
      </div>

      {concCols.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-ink-100 bg-ink-50/50 px-4 py-2 text-xs">
          <span className="text-ink-500">Concentration columns (ordered):</span>
          {concCols.map((c, i) => (
            <span
              key={c}
              className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 font-medium ring-1 ring-ink-200"
            >
              <span className="text-[10px] text-ink-500">{i + 1}</span>
              <span>{c}</span>
              <button
                className="text-ink-400 hover:text-ink-900"
                onClick={() => props.onToggleCol(c)}
              >
                ✕
              </button>
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
                  <td
                    className={clsx(
                      "cursor-pointer select-none border-b border-ink-100 px-2 py-1 font-medium",
                      role === "sample" && "bg-brand-500 text-white",
                      role === "control" && "bg-ink-800 text-white",
                      role === "none" && "bg-white text-ink-500 hover:bg-ink-100",
                    )}
                    onClick={() => props.onCycleRole(i)}
                    title={`Row ${i + 1}: click to cycle role (currently ${role})`}
                  >
                    {role === "sample" ? "S " : role === "control" ? "C " : ""}
                    {i + 1}
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
  concCols: string[];
  tickText: string;
  setTickText: (s: string) => void;
  autoPow2: boolean;
  setAutoPow2: (b: boolean) => void;
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

function MICChart({ mic }: { mic: MICResult }) {
  const { config, result, sample_nan_ratio } = mic;
  const xs = result.concentrations;
  const labels = result.x_tick_labels;
  const hasControl =
    result.control_mean !== null &&
    Array.isArray(result.control_mean) &&
    result.control_mean.length === result.sample_mean.length;

  const errBars = (arr: number[] | null | undefined) => ({
    type: "data" as const,
    array: (arr ?? []) as number[],
    visible: true,
    thickness: 1,
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
        marker: { color: config.sample_color },
        offsetgroup: "sample",
      } as unknown as Data);
      data.push({
        type: "bar",
        name: "Control",
        x: xs,
        y: result.control_mean!,
        error_y: errBars(result.control_std),
        marker: { color: config.control_color },
        offsetgroup: "control",
      } as unknown as Data);
    } else {
      data.push({
        type: "bar",
        name: "Sample",
        x: xs,
        y: result.sample_mean,
        error_y: errBars(result.sample_std),
        marker: { color: config.sample_color },
      });
      if (hasControl) {
        data.push({
          type: "scatter",
          mode: "lines+markers",
          name: "Control",
          x: xs,
          y: result.control_mean!,
          error_y: errBars(result.control_std),
          line: { color: config.control_color, width: 1.6 },
          marker: { color: config.control_color, size: 7 },
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
      line: { color: config.sample_color, width: 1.6 },
      marker: { color: config.sample_color, size: 7 },
    });
    if (hasControl) {
      data.push({
        type: "scatter",
        mode,
        name: "Control",
        x: xs,
        y: result.control_mean!,
        error_y: errBars(result.control_std),
        line: { color: config.control_color, width: 1.6 },
        marker: { color: config.control_color, size: 7 },
      });
    }
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
          height: 380,
          margin: { l: 60, r: 20, t: 20, b: 50 },
          barmode: "group",
          bargap: 0.25,
          xaxis: {
            title: { text: config.x_label || "Concentration" },
            tickmode: "array",
            tickvals: xs,
            ticktext: labels,
            autorange: config.invert_x ? "reversed" : true,
          },
          yaxis: {
            title: { text: config.y_label || "OD 600nm" },
            rangemode: "tozero",
          },
          plot_bgcolor: "#ffffff",
          paper_bgcolor: "#ffffff",
          showlegend: true,
          legend: { orientation: "h", y: -0.2 },
        }}
        config={{ responsive: true, displaylogo: false }}
        style={{ width: "100%" }}
        useResizeHandler
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
