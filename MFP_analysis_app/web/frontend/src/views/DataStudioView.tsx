import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Plot from "react-plotly.js";
import type { Data, Layout } from "plotly.js";
import clsx from "clsx";
import {
  api,
  DSHistResponse,
  DSNormMode,
  DSPlotResponse,
  DSPreview,
  DSSchema,
  DSSessionSummary,
  DSTransformStep,
} from "../api";
import { PageHeaderContent, usePageHeader } from "../layout/PageHeader";

type PlotKind = "Line" | "Scatter" | "Line+markers" | "Bar" | "Bar stacked" | "Area" | "Step" | "Histogram";

const PLOT_KINDS: PlotKind[] = [
  "Line",
  "Scatter",
  "Line+markers",
  "Bar",
  "Bar stacked",
  "Area",
  "Step",
  "Histogram",
];

export function DataStudioView() {
  const [sessions, setSessions] = useState<DSSessionSummary[]>([]);
  const [activeSid, setActiveSid] = useState<string | null>(null);
  const [schema, setSchema] = useState<DSSchema | null>(null);
  const [preview, setPreview] = useState<DSPreview | null>(null);
  const [transforms, setTransforms] = useState<DSTransformStep[]>([]);
  const [plotKind, setPlotKind] = useState<PlotKind>("Line");
  const [xCol, setXCol] = useState<string | null>(null);
  const [yCols, setYCols] = useState<string[]>([]);
  const [yNorm, setYNorm] = useState<DSNormMode>("none");
  const [xNorm, setXNorm] = useState<DSNormMode>("none");
  const [logX, setLogX] = useState(false);
  const [logY, setLogY] = useState(false);
  const [bins, setBins] = useState(30);
  const [plotData, setPlotData] = useState<DSPlotResponse | null>(null);
  const [histData, setHistData] = useState<DSHistResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const active = useMemo(
    () => sessions.find((s) => s.session_id === activeSid) ?? null,
    [sessions, activeSid],
  );

  useEffect(() => {
    api.dataStudio.list().then(setSessions).catch((e) => setError(String(e)));
  }, []);

  // When a session is activated, fetch its schema + a preview.
  useEffect(() => {
    if (!activeSid) {
      setSchema(null);
      setPreview(null);
      setXCol(null);
      setYCols([]);
      return;
    }
    setBusy(true);
    api.dataStudio
      .schema(activeSid)
      .then((sc) => {
        setSchema(sc);
        // smart defaults: first numeric col → X; rest numeric → Y
        if (sc.numeric_columns.length > 0) {
          setXCol(sc.numeric_columns[0] ?? null);
          setYCols(sc.numeric_columns.slice(1, Math.min(sc.numeric_columns.length, 4)));
        } else {
          setXCol(null);
          setYCols([]);
        }
      })
      .catch((e) => setError(String(e)))
      .finally(() => setBusy(false));
  }, [activeSid]);

  // Fetch preview when the active session or transforms change.
  useEffect(() => {
    if (!activeSid) return;
    api.dataStudio
      .preview(activeSid, { transforms, max_rows: 200 })
      .then(setPreview)
      .catch((e) => setError(String(e)));
  }, [activeSid, transforms]);

  // Fetch plot data when plot config changes.
  const refreshPlot = useCallback(async () => {
    if (!activeSid) return;
    setBusy(true);
    setError(null);
    try {
      if (plotKind === "Histogram") {
        if (yCols.length === 0) {
          setHistData(null);
          return;
        }
        const h = await api.dataStudio.histogram(activeSid, {
          transforms,
          y_cols: yCols,
          bins,
        });
        setHistData(h);
        setPlotData(null);
      } else {
        if (yCols.length === 0) {
          setPlotData(null);
          return;
        }
        const p = await api.dataStudio.plot(activeSid, {
          transforms,
          x_col: xCol,
          y_cols: yCols,
          y_normalize: yNorm,
          x_normalize: xNorm,
          max_points: 10000,
        });
        setPlotData(p);
        setHistData(null);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }, [activeSid, transforms, plotKind, xCol, yCols, yNorm, xNorm, bins]);

  useEffect(() => {
    refreshPlot();
  }, [refreshPlot]);

  const onUpload = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const s = await api.dataStudio.upload(file);
      setSessions((prev) => [...prev, s]);
      setActiveSid(s.session_id);
      setTransforms([]);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const onRemove = async (sid: string) => {
    await api.dataStudio.remove(sid).catch((e) => setError(String(e)));
    setSessions((prev) => prev.filter((s) => s.session_id !== sid));
    if (activeSid === sid) {
      setActiveSid(null);
      setSchema(null);
      setPreview(null);
      setPlotData(null);
      setHistData(null);
    }
  };

  const onLoadOptionsChange = async (opts: {
    sheet_name?: string | null;
    header_row?: number;
    decimal_comma?: boolean;
  }) => {
    if (!active) return;
    setBusy(true);
    try {
      const updated = await api.dataStudio.updateLoad(active.session_id, {
        sheet_name: opts.sheet_name ?? active.sheet_name ?? null,
        header_row: opts.header_row ?? active.header_row,
        decimal_comma: opts.decimal_comma ?? active.decimal_comma,
      });
      setSessions((prev) =>
        prev.map((s) => (s.session_id === updated.session_id ? updated : s)),
      );
      // Reset transforms because column set may change.
      setTransforms([]);
      // Refetch schema.
      const sc = await api.dataStudio.schema(updated.session_id);
      setSchema(sc);
      if (sc.numeric_columns.length > 0) {
        setXCol(sc.numeric_columns[0] ?? null);
        setYCols(sc.numeric_columns.slice(1, Math.min(sc.numeric_columns.length, 4)));
      } else {
        setXCol(null);
        setYCols([]);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  usePageHeader(
    <PageHeaderContent
      title="Data Studio"
      subtitle="Load tabular data, apply a transform pipeline, build interactive plots."
      actions={
        <>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.tsv,.txt,.xlsx,.xlsm,.xls"
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
            {busy ? "Working…" : "Open table…"}
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
              <LoadCard active={active} schema={schema} onChange={onLoadOptionsChange} />

              {preview && (
                <PreviewCard preview={preview} />
              )}

              <TransformCard
                schema={schema}
                transforms={transforms}
                setTransforms={setTransforms}
                warnings={preview?.warnings ?? []}
              />

              <PlotControlsCard
                schema={preview?.schema ?? schema}
                plotKind={plotKind}
                setPlotKind={setPlotKind}
                xCol={xCol}
                setXCol={setXCol}
                yCols={yCols}
                setYCols={setYCols}
                yNorm={yNorm}
                setYNorm={setYNorm}
                xNorm={xNorm}
                setXNorm={setXNorm}
                logX={logX}
                setLogX={setLogX}
                logY={logY}
                setLogY={setLogY}
                bins={bins}
                setBins={setBins}
              />

              <PlotCard
                plotKind={plotKind}
                plotData={plotData}
                histData={histData}
                xCol={xCol}
                logX={logX}
                logY={logY}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// sidebar / empty state
// ============================================================================

function SessionsSidebar(props: {
  sessions: DSSessionSummary[];
  activeSid: string | null;
  onSelect: (sid: string) => void;
  onRemove: (sid: string) => void;
}) {
  return (
    <aside className="flex w-64 shrink-0 flex-col gap-1 border-r border-ink-200 bg-ink-50/50 p-3">
      <div className="label px-2 pb-1">Sessions</div>
      {props.sessions.length === 0 && (
        <div className="px-2 text-xs text-ink-500">No tables loaded.</div>
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
                {s.sheet_name ? `sheet: ${s.sheet_name} · ` : ""}
                {s.shape ? `${s.shape[0].toLocaleString()}×${s.shape[1]}` : "—"}
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
      <div className="text-4xl">📊</div>
      <div className="text-lg font-semibold">Open a table</div>
      <div className="max-w-md text-sm text-ink-500">
        CSV/TSV/TXT or Excel. The backend uses <code>lab_gui.data_studio_io.load_table</code>{" "}
        so behaviour (delimiter sniffing, decimal-comma handling, sheet picking, auto-cast)
        matches the desktop app.
      </div>
      <button className="btn-primary mt-2" onClick={props.onPick}>
        Choose file…
      </button>
    </div>
  );
}

// ============================================================================
// load / preview / transforms
// ============================================================================

function LoadCard(props: {
  active: DSSessionSummary;
  schema: DSSchema | null;
  onChange: (opts: {
    sheet_name?: string | null;
    header_row?: number;
    decimal_comma?: boolean;
  }) => void;
}) {
  const { active, schema } = props;
  const hasSheets = active.sheets.length > 0;
  return (
    <div className="card flex shrink-0 flex-wrap items-end gap-4 px-4 py-3">
      <div>
        <div className="label">File</div>
        <div className="text-sm font-medium">{active.display_name}</div>
      </div>
      {hasSheets && (
        <div>
          <div className="label">Sheet</div>
          <select
            className="input mt-1"
            value={active.sheet_name ?? ""}
            onChange={(e) => props.onChange({ sheet_name: e.target.value || null })}
          >
            {active.sheets.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      )}
      <div>
        <div className="label">Header row (0-indexed)</div>
        <input
          type="number"
          className="input mt-1 w-24"
          min={0}
          value={active.header_row}
          onChange={(e) =>
            props.onChange({ header_row: Math.max(0, Math.floor(Number(e.target.value) || 0)) })
          }
        />
      </div>
      <div>
        <div className="label">Decimal comma</div>
        <label className="mt-1 inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={active.decimal_comma}
            onChange={(e) => props.onChange({ decimal_comma: e.target.checked })}
          />
          replace `,` with `.`
        </label>
      </div>
      <div className="ml-auto text-right">
        <div className="label">Shape (raw)</div>
        <div className="text-sm">
          {active.shape
            ? `${active.shape[0].toLocaleString()} rows × ${active.shape[1]} cols`
            : "—"}
        </div>
        {schema && (
          <div className="text-[11px] text-ink-500">
            {schema.numeric_columns.length} numeric of {schema.n_cols} cols
          </div>
        )}
      </div>
    </div>
  );
}

function PreviewCard(props: { preview: DSPreview }) {
  const { preview } = props;
  const dtypesByCol = useMemo(() => {
    const m = new Map<string, string>();
    preview.schema.columns.forEach((c, i) => m.set(c, preview.schema.dtypes[i] ?? ""));
    return m;
  }, [preview.schema]);

  return (
    <div className="card shrink-0">
      <div className="flex items-baseline justify-between border-b border-ink-200 px-4 py-2">
        <h3 className="text-sm font-semibold">Preview (transformed)</h3>
        <div className="text-xs text-ink-500">
          {preview.n_rows_preview.toLocaleString()} of{" "}
          {preview.n_rows_total.toLocaleString()} rows · {preview.n_cols_total} cols
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full border-separate border-spacing-0 text-xs">
          <thead className="bg-white">
            <tr>
              <th className="border-b border-ink-200 bg-ink-50 px-2 py-1.5 text-left font-medium text-ink-500">
                #
              </th>
              {preview.columns.map((c) => (
                <th
                  key={c}
                  className="border-b border-ink-200 bg-ink-50 px-2 py-1.5 text-left font-medium text-ink-700"
                >
                  <div>{c}</div>
                  <div className="text-[10px] font-normal text-ink-500">
                    {dtypesByCol.get(c) ?? ""}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {preview.rows.map((row, i) => (
              <tr key={i} className="odd:bg-ink-50/40">
                <td className="border-b border-ink-100 px-2 py-1 text-ink-400">{i + 1}</td>
                {row.map((v, j) => (
                  <td key={j} className="border-b border-ink-100 px-2 py-1 tabular-nums">
                    {formatCell(v)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TransformCard(props: {
  schema: DSSchema | null;
  transforms: DSTransformStep[];
  setTransforms: (t: DSTransformStep[]) => void;
  warnings: string[];
}) {
  const { schema, transforms, setTransforms, warnings } = props;

  const addStep = (t: DSTransformStep["type"]) => {
    const base: DSTransformStep = { type: t };
    if (t === "fillna") base.value = 0;
    if (t === "normalize") base.mode = "minmax";
    if (t === "baseline") base.method = "first";
    if (t === "log") {
      base.base = 10;
      base.offset = 0;
    }
    if (t === "rolling_mean") {
      base.window = 5;
      base.center = true;
    }
    if (t === "to_numeric") base.errors = "coerce";
    setTransforms([...transforms, base]);
  };

  const updateStep = (idx: number, patch: Partial<DSTransformStep>) => {
    const next = transforms.slice();
    next[idx] = { ...next[idx], ...patch };
    setTransforms(next);
  };

  const removeStep = (idx: number) => {
    const next = transforms.slice();
    next.splice(idx, 1);
    setTransforms(next);
  };

  const move = (idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    if (j < 0 || j >= transforms.length) return;
    const next = transforms.slice();
    const [item] = next.splice(idx, 1);
    next.splice(j, 0, item);
    setTransforms(next);
  };

  return (
    <div className="card shrink-0 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Transform pipeline</h3>
        <div className="flex flex-wrap items-center gap-2">
          {(
            [
              ["select_columns", "Select/drop"],
              ["rename", "Rename"],
              ["to_numeric", "To numeric"],
              ["fillna", "Fill NA"],
              ["normalize", "Normalize"],
              ["baseline", "Baseline"],
              ["log", "Log"],
              ["rolling_mean", "Rolling mean"],
            ] as const
          ).map(([t, label]) => (
            <button
              key={t}
              className="rounded border border-ink-300 bg-white px-2 py-1 text-xs hover:bg-ink-50"
              onClick={() => addStep(t)}
            >
              + {label}
            </button>
          ))}
          {transforms.length > 0 && (
            <button
              className="rounded border border-red-300 bg-red-50 px-2 py-1 text-xs text-red-700 hover:bg-red-100"
              onClick={() => setTransforms([])}
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {transforms.length === 0 ? (
        <div className="text-xs text-ink-500">
          No steps — the raw, auto-cast DataFrame is used for preview and plots.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {transforms.map((step, i) => (
            <StepRow
              key={i}
              idx={i}
              total={transforms.length}
              step={step}
              schema={schema}
              onUpdate={(p) => updateStep(i, p)}
              onRemove={() => removeStep(i)}
              onMove={(dir) => move(i, dir)}
            />
          ))}
        </div>
      )}

      {warnings.length > 0 && (
        <div className="mt-3 rounded border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-800">
          <div className="font-semibold">Warnings</div>
          <ul className="list-disc pl-4">
            {warnings.slice(0, 6).map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function StepRow(props: {
  idx: number;
  total: number;
  step: DSTransformStep;
  schema: DSSchema | null;
  onUpdate: (patch: Partial<DSTransformStep>) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const { idx, total, step, schema, onUpdate } = props;
  const allCols = schema?.columns ?? [];
  const numCols = schema?.numeric_columns ?? [];

  return (
    <div className="flex flex-wrap items-end gap-3 rounded border border-ink-200 bg-ink-50/50 p-2">
      <div className="flex items-center gap-1">
        <span className="inline-flex h-6 w-6 items-center justify-center rounded bg-brand-500 text-[11px] font-semibold text-white">
          {idx + 1}
        </span>
        <span className="text-sm font-medium capitalize">{step.type.replace("_", " ")}</span>
      </div>

      {step.type === "select_columns" && (
        <>
          <ColumnsPicker
            label="Columns"
            value={step.columns ?? []}
            options={allCols}
            onChange={(cols) => onUpdate({ columns: cols })}
          />
          <SelectField
            label="Mode"
            value={step.mode ?? "keep"}
            options={["keep", "drop"]}
            onChange={(v) => onUpdate({ mode: v })}
          />
        </>
      )}

      {step.type === "rename" && (
        <RenameEditor
          mapping={step.mapping ?? {}}
          columns={allCols}
          onChange={(m) => onUpdate({ mapping: m })}
        />
      )}

      {step.type === "to_numeric" && (
        <>
          <ColumnsPicker
            label="Columns"
            value={step.columns ?? []}
            options={allCols}
            onChange={(cols) => onUpdate({ columns: cols })}
          />
          <SelectField
            label="On error"
            value={step.errors ?? "coerce"}
            options={["coerce", "raise"]}
            onChange={(v) => onUpdate({ errors: v })}
          />
        </>
      )}

      {step.type === "fillna" && (
        <>
          <ColumnsPicker
            label="Columns"
            value={step.columns ?? []}
            options={allCols}
            onChange={(cols) => onUpdate({ columns: cols })}
          />
          <TextField
            label="Value"
            value={String(step.value ?? "0")}
            onChange={(v) => onUpdate({ value: v })}
            hint="number, `mean`, or `ffill`"
          />
        </>
      )}

      {step.type === "normalize" && (
        <>
          <ColumnsPicker
            label="Columns"
            value={step.columns ?? []}
            options={numCols}
            onChange={(cols) => onUpdate({ columns: cols })}
          />
          <SelectField
            label="Mode"
            value={step.mode ?? "minmax"}
            options={["minmax", "zscore"]}
            onChange={(v) => onUpdate({ mode: v })}
          />
        </>
      )}

      {step.type === "baseline" && (
        <>
          <ColumnsPicker
            label="Columns"
            value={step.columns ?? []}
            options={numCols}
            onChange={(cols) => onUpdate({ columns: cols })}
          />
          <SelectField
            label="Method"
            value={step.method ?? "first"}
            options={["first", "mean_range"]}
            onChange={(v) => onUpdate({ method: v })}
          />
          {step.method === "mean_range" && (
            <>
              <NumberField
                label="Start row"
                value={step.range?.[0] ?? 0}
                onChange={(n) => onUpdate({ range: [n, step.range?.[1] ?? 0] })}
              />
              <NumberField
                label="End row"
                value={step.range?.[1] ?? 0}
                onChange={(n) => onUpdate({ range: [step.range?.[0] ?? 0, n] })}
              />
            </>
          )}
        </>
      )}

      {step.type === "log" && (
        <>
          <ColumnsPicker
            label="Columns"
            value={step.columns ?? []}
            options={numCols}
            onChange={(cols) => onUpdate({ columns: cols })}
          />
          <NumberField
            label="Base"
            value={step.base ?? 10}
            onChange={(n) => onUpdate({ base: n })}
          />
          <NumberField
            label="Offset"
            value={step.offset ?? 0}
            onChange={(n) => onUpdate({ offset: n })}
          />
        </>
      )}

      {step.type === "rolling_mean" && (
        <>
          <ColumnsPicker
            label="Columns"
            value={step.columns ?? []}
            options={numCols}
            onChange={(cols) => onUpdate({ columns: cols })}
          />
          <NumberField
            label="Window"
            value={step.window ?? 5}
            onChange={(n) => onUpdate({ window: Math.max(1, Math.floor(n)) })}
          />
          <label className="mt-1 inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={!!step.center}
              onChange={(e) => onUpdate({ center: e.target.checked })}
            />
            center
          </label>
        </>
      )}

      <div className="ml-auto flex items-center gap-1">
        <IconBtn title="Move up" disabled={idx === 0} onClick={() => props.onMove(-1)}>
          ↑
        </IconBtn>
        <IconBtn
          title="Move down"
          disabled={idx === total - 1}
          onClick={() => props.onMove(1)}
        >
          ↓
        </IconBtn>
        <IconBtn title="Remove" onClick={props.onRemove}>
          ✕
        </IconBtn>
      </div>
    </div>
  );
}

// ============================================================================
// plot
// ============================================================================

function PlotControlsCard(props: {
  schema: DSSchema | null;
  plotKind: PlotKind;
  setPlotKind: (k: PlotKind) => void;
  xCol: string | null;
  setXCol: (c: string | null) => void;
  yCols: string[];
  setYCols: (c: string[]) => void;
  yNorm: DSNormMode;
  setYNorm: (m: DSNormMode) => void;
  xNorm: DSNormMode;
  setXNorm: (m: DSNormMode) => void;
  logX: boolean;
  setLogX: (b: boolean) => void;
  logY: boolean;
  setLogY: (b: boolean) => void;
  bins: number;
  setBins: (n: number) => void;
}) {
  const { schema } = props;
  const allCols = schema?.columns ?? [];
  const numCols = schema?.numeric_columns ?? [];
  const isHist = props.plotKind === "Histogram";

  return (
    <div className="card shrink-0 p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="text-sm font-semibold">Plot</h3>
        <div className="text-xs text-ink-500">
          X axis uses all columns; Y uses numeric only.
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Field label="Type">
          <select
            className="input w-full"
            value={props.plotKind}
            onChange={(e) => props.setPlotKind(e.target.value as PlotKind)}
          >
            {PLOT_KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </Field>
        {!isHist && (
          <Field label="X column">
            <select
              className="input w-full"
              value={props.xCol ?? ""}
              onChange={(e) => props.setXCol(e.target.value || null)}
            >
              <option value="">(row index)</option>
              {allCols.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>
        )}
        {!isHist && (
          <Field label="X normalize">
            <select
              className="input w-full"
              value={props.xNorm}
              onChange={(e) => props.setXNorm(e.target.value as DSNormMode)}
            >
              <option value="none">none</option>
              <option value="minmax">min-max</option>
              <option value="zscore">z-score</option>
            </select>
          </Field>
        )}
        <Field label="Y normalize">
          <select
            className="input w-full"
            value={props.yNorm}
            onChange={(e) => props.setYNorm(e.target.value as DSNormMode)}
          >
            <option value="none">none</option>
            <option value="minmax">min-max</option>
            <option value="zscore">z-score</option>
          </select>
        </Field>
        {isHist ? (
          <Field label="Bins">
            <input
              type="number"
              className="input w-full"
              min={1}
              max={500}
              value={props.bins}
              onChange={(e) =>
                props.setBins(Math.max(1, Math.min(500, Math.floor(Number(e.target.value) || 0))))
              }
            />
          </Field>
        ) : (
          <Field label="Log axes">
            <div className="mt-1 flex gap-3 text-sm">
              <label className="inline-flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={props.logX}
                  onChange={(e) => props.setLogX(e.target.checked)}
                />
                log X
              </label>
              <label className="inline-flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={props.logY}
                  onChange={(e) => props.setLogY(e.target.checked)}
                />
                log Y
              </label>
            </div>
          </Field>
        )}
      </div>

      <div className="mt-3">
        <div className="label mb-1">Y columns</div>
        <div className="flex flex-wrap gap-1.5">
          {numCols.length === 0 && (
            <span className="text-xs text-ink-500">
              No numeric columns detected — add a <code>to_numeric</code> transform.
            </span>
          )}
          {numCols.map((c) => {
            const active = props.yCols.includes(c);
            return (
              <button
                key={c}
                className={clsx(
                  "rounded-full px-2 py-0.5 text-xs",
                  active
                    ? "bg-brand-500 text-white"
                    : "bg-white text-ink-700 ring-1 ring-ink-200 hover:bg-ink-100",
                )}
                onClick={() =>
                  props.setYCols(
                    active ? props.yCols.filter((x) => x !== c) : [...props.yCols, c],
                  )
                }
              >
                {c}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function PlotCard(props: {
  plotKind: PlotKind;
  plotData: DSPlotResponse | null;
  histData: DSHistResponse | null;
  xCol: string | null;
  logX: boolean;
  logY: boolean;
}) {
  const { plotKind, plotData, histData } = props;

  const data: Data[] = useMemo(() => {
    if (plotKind === "Histogram") {
      if (!histData) return [];
      return histData.series.map((s) => {
        const centers = s.edges.length > 1
          ? s.edges.slice(0, -1).map((e, i) => (e + s.edges[i + 1]) / 2)
          : [];
        return {
          type: "bar",
          x: centers,
          y: s.counts,
          name: s.name,
          opacity: 0.75,
        } as Data;
      });
    }
    if (!plotData) return [];
    const x = plotData.x ?? [];
    return plotData.series.map((s, i) => {
      const base: Partial<Data> = {
        x: x as unknown as number[],
        y: s.y as number[],
        name: s.name,
      };
      switch (plotKind) {
        case "Scatter":
          return { ...base, type: "scattergl", mode: "markers" } as Data;
        case "Line+markers":
          return { ...base, type: "scattergl", mode: "lines+markers" } as Data;
        case "Bar":
          return { ...base, type: "bar" } as Data;
        case "Bar stacked":
          return { ...base, type: "bar" } as Data;
        case "Area":
          return {
            ...base,
            type: "scatter",
            mode: "lines",
            fill: i === 0 ? "tozeroy" : "tonexty",
            line: { width: 1.2 },
          } as Data;
        case "Step":
          return { ...base, type: "scatter", mode: "lines", line: { shape: "hv" } } as Data;
        case "Line":
        default:
          return { ...base, type: "scattergl", mode: "lines" } as Data;
      }
    });
  }, [plotKind, plotData, histData]);

  const layout: Partial<Layout> = useMemo(() => {
    const l: Partial<Layout> = {
      margin: { l: 60, r: 20, t: 8, b: 50 },
      height: 460,
      xaxis: { zeroline: false },
      yaxis: { zeroline: false },
      showlegend: true,
      legend: { orientation: "h", y: -0.15 },
    };
    if (props.logX) l.xaxis = { ...l.xaxis, type: "log" };
    if (props.logY) l.yaxis = { ...l.yaxis, type: "log" };
    if (plotKind === "Bar stacked") (l as Layout).barmode = "stack";
    else if (plotKind === "Bar") (l as Layout).barmode = "group";
    if (plotKind === "Histogram") {
      (l as Layout).barmode = "overlay";
      (l as Layout).xaxis = { ...(l.xaxis ?? {}), title: { text: "value" } };
      (l as Layout).yaxis = { ...(l.yaxis ?? {}), title: { text: "count" } };
    } else {
      (l as Layout).xaxis = {
        ...(l.xaxis ?? {}),
        title: { text: props.xCol ?? "row index" },
      };
      (l as Layout).yaxis = { ...(l.yaxis ?? {}), title: { text: "value" } };
    }
    return l;
  }, [plotKind, props.logX, props.logY, props.xCol]);

  const empty =
    plotKind === "Histogram"
      ? !histData || histData.series.length === 0
      : !plotData || plotData.series.length === 0;

  return (
    <div className="card shrink-0 p-3">
      <div className="flex items-baseline justify-between px-1 pb-1">
        <h3 className="text-sm font-semibold">Chart</h3>
        <div className="text-xs text-ink-500">
          {plotKind === "Histogram"
            ? `${histData?.series.length ?? 0} series · ${histData?.meta.bins ?? 0} bins`
            : plotData
              ? `${plotData.series.length} series · ${plotData.meta.n_points_returned ?? 0} of ${plotData.meta.n_points_full ?? 0} pts`
              : "—"}
        </div>
      </div>
      {empty ? (
        <div className="flex h-64 items-center justify-center text-sm text-ink-500">
          Pick at least one Y column to plot.
        </div>
      ) : (
        <Plot
          data={data}
          layout={layout}
          useResizeHandler
          style={{ width: "100%", height: 460 }}
          config={{ displaylogo: false, responsive: true }}
        />
      )}
    </div>
  );
}

// ============================================================================
// tiny controls
// ============================================================================

function Field(props: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="label">{props.label}</div>
      {props.children}
    </div>
  );
}

function NumberField(props: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <Field label={props.label}>
      <input
        type="number"
        className="input w-24"
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value) || 0)}
      />
    </Field>
  );
}

function TextField(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
}) {
  return (
    <div>
      <div className="label">{props.label}</div>
      <input
        type="text"
        className="input w-32"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
      />
      {props.hint && <div className="text-[10px] text-ink-500">{props.hint}</div>}
    </div>
  );
}

function SelectField(props: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <Field label={props.label}>
      <select
        className="input w-28"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
      >
        {props.options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </Field>
  );
}

function ColumnsPicker(props: {
  label: string;
  value: string[];
  options: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <div className="min-w-[180px] flex-1">
      <div className="label">{props.label}</div>
      <div className="mt-1 flex flex-wrap gap-1 rounded border border-ink-200 bg-white p-1">
        {props.options.length === 0 && (
          <span className="px-1 text-[11px] text-ink-400">no columns</span>
        )}
        {props.options.map((c) => {
          const active = props.value.includes(c);
          return (
            <button
              key={c}
              className={clsx(
                "rounded-full px-2 py-0.5 text-[11px]",
                active
                  ? "bg-brand-500 text-white"
                  : "bg-ink-50 text-ink-700 hover:bg-ink-100",
              )}
              onClick={() =>
                props.onChange(
                  active ? props.value.filter((x) => x !== c) : [...props.value, c],
                )
              }
            >
              {c}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function RenameEditor(props: {
  mapping: Record<string, string>;
  columns: string[];
  onChange: (m: Record<string, string>) => void;
}) {
  const entries = Object.entries(props.mapping);
  return (
    <div className="flex flex-col gap-1">
      <div className="label">Rename</div>
      {entries.length === 0 && (
        <div className="text-[11px] text-ink-500">Click a column to start renaming.</div>
      )}
      {entries.map(([from, to]) => (
        <div key={from} className="flex items-center gap-1 text-xs">
          <select
            className="input w-28"
            value={from}
            onChange={(e) => {
              const m = { ...props.mapping };
              const val = m[from];
              delete m[from];
              m[e.target.value] = val;
              props.onChange(m);
            }}
          >
            {props.columns.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <span>→</span>
          <input
            type="text"
            className="input w-28"
            value={to}
            onChange={(e) => props.onChange({ ...props.mapping, [from]: e.target.value })}
          />
          <button
            className="rounded px-1 text-ink-500 hover:bg-ink-100"
            onClick={() => {
              const m = { ...props.mapping };
              delete m[from];
              props.onChange(m);
            }}
          >
            ✕
          </button>
        </div>
      ))}
      <div className="flex flex-wrap gap-1">
        {props.columns
          .filter((c) => !(c in props.mapping))
          .slice(0, 8)
          .map((c) => (
            <button
              key={c}
              className="rounded-full bg-ink-50 px-2 py-0.5 text-[10px] text-ink-700 hover:bg-ink-100"
              onClick={() => props.onChange({ ...props.mapping, [c]: c })}
            >
              + {c}
            </button>
          ))}
      </div>
    </div>
  );
}

function IconBtn(props: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  disabled?: boolean;
}) {
  return (
    <button
      className={clsx(
        "rounded border border-ink-200 bg-white px-2 py-1 text-xs",
        props.disabled ? "cursor-not-allowed text-ink-300" : "hover:bg-ink-50",
      )}
      title={props.title}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

// ============================================================================
// utils
// ============================================================================

function formatCell(v: string | number | null): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "";
    if (Math.abs(v) >= 1000 || (Math.abs(v) > 0 && Math.abs(v) < 0.001)) {
      return v.toExponential(3);
    }
    return String(Number.isInteger(v) ? v : v.toFixed(4));
  }
  return String(v);
}
