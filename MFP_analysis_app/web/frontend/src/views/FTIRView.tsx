import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Plot from "react-plotly.js";
import type { Data, Layout, Shape } from "plotly.js";
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
  min_distance_cm1: number;
  top_n: number;
  assign: boolean;
  assign_top_n: number;
  assign_min_score: number;
}

const DEFAULT_PRE: FTIRPreprocessOptions = {
  mode: "absorbance",
  smoothing_window: 0,
  poly_order: 2,
  baseline: "none",
  normalize: "none",
};

const DEFAULT_PEAK: PeakPickOptions = {
  min_prominence: 0.01,
  min_distance_cm1: 8.0,
  top_n: 15,
  assign: true,
  assign_top_n: 3,
  assign_min_score: 35.0,
};

export function FTIRView() {
  const [sessions, setSessions] = useState<FTIRSessionSummary[]>([]);
  const [activeSid, setActiveSid] = useState<string | null>(null);
  const [pre, setPre] = useState<FTIRPreprocessOptions>(DEFAULT_PRE);
  const [pk, setPk] = useState<PeakPickOptions>(DEFAULT_PEAK);
  const [spectrum, setSpectrum] = useState<FTIRSpectrumResponse | null>(null);
  const [peaks, setPeaks] = useState<FTIRPeak[]>([]);
  const [assignments, setAssignments] = useState<FTIRAssignment[] | null>(null);
  const [libMeta, setLibMeta] = useState<{ version: string; n_entries: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const active = useMemo(
    () => sessions.find((s) => s.session_id === activeSid) ?? null,
    [sessions, activeSid],
  );

  useEffect(() => {
    api.ftir.list().then(setSessions).catch((e) => setError(String(e)));
    api.ftir.library().then(setLibMeta).catch(() => undefined);
  }, []);

  // Refetch spectrum whenever session or preprocessing changes.
  useEffect(() => {
    if (!activeSid) {
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
  }, [activeSid, pre]);

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
      const body: FTIRPeaksRequest = { ...pre, ...pk };
      const res = await api.ftir.peaks(activeSid, body);
      setPeaks(res.peaks);
      setAssignments(res.assignments ?? null);
    } catch (err) {
      setError(String(err));
    } finally {
      setPicking(false);
    }
  }, [activeSid, pre, pk]);

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
              <SummaryCard active={active} spectrum={spectrum} peaks={peaks} />

              <PreprocessCard pre={pre} setPre={setPre} />

              <PeakCard
                pk={pk}
                setPk={setPk}
                onRun={runPick}
                picking={picking}
                disabled={!spectrum}
              />

              <SpectrumChart
                spectrum={spectrum}
                peaks={peaks}
                mode={pre.mode}
                title={active.display_name}
              />

              {peaks.length > 0 && (
                <PeaksTable peaks={peaks} assignments={assignments} />
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
        <div className="text-xs text-ink-500">
          Applied before peak picking and display. Matches desktop <code>preprocess_spectrum</code>.
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

function PeakCard(props: {
  pk: PeakPickOptions;
  setPk: (p: PeakPickOptions) => void;
  onRun: () => void;
  picking: boolean;
  disabled: boolean;
}) {
  const { pk, setPk } = props;
  return (
    <div className="card shrink-0 p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="text-sm font-semibold">Peak picking</h3>
        <button
          className="btn-primary"
          onClick={props.onRun}
          disabled={props.disabled || props.picking}
        >
          {props.picking ? "Picking…" : "Pick peaks"}
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        <Field label="Min prominence">
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
        <Field label="Min distance (cm⁻¹)">
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
        <Field label="Top N (0 = all)">
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
        <Field label="Assign bonds">
          <label className="mt-1 inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={pk.assign}
              onChange={(e) => setPk({ ...pk, assign: e.target.checked })}
            />
            Use library v2
          </label>
        </Field>
        <Field label="Assign top N">
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
        <Field label="Assign min score">
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

function SpectrumChart(props: {
  spectrum: FTIRSpectrumResponse | null;
  peaks: FTIRPeak[];
  mode: FTIRYMode;
  title: string;
}) {
  const { spectrum, peaks, mode } = props;

  const peakShapes: Partial<Shape>[] = useMemo(() => {
    return peaks.map((p) => ({
      type: "line" as const,
      x0: p.wn,
      x1: p.wn,
      y0: 0,
      y1: 1,
      xref: "x" as const,
      yref: "paper" as const,
      line: { color: "rgba(220, 38, 38, 0.35)", width: 1, dash: "dot" as const },
    }));
  }, [peaks]);

  const data: Data[] = useMemo(() => {
    if (!spectrum) return [];
    const trace: Data = {
      type: "scattergl",
      mode: "lines",
      x: spectrum.wn,
      y: spectrum.y,
      line: { color: "#1e2636", width: 1.4 },
      name: props.title,
      hovertemplate: "%{x:.1f} cm⁻¹<br>%{y:.4g}<extra></extra>",
    };
    if (peaks.length === 0) return [trace];
    const markers: Data = {
      type: "scatter",
      mode: "text+markers",
      x: peaks.map((p) => p.wn),
      y: peaks.map((p) => p.y),
      text: peaks.map((p) => p.wn.toFixed(0)),
      textposition: "top center",
      textfont: { size: 10, color: "#dc2626" },
      marker: { color: "#dc2626", size: 7, symbol: "triangle-down" },
      hovertemplate:
        "peak: %{x:.1f} cm⁻¹<br>y: %{y:.4g}<br>prom: %{customdata:.3g}<extra></extra>",
      customdata: peaks.map((p) => p.prominence),
      name: "peaks",
    };
    return [trace, markers];
  }, [spectrum, peaks, props.title]);

  const layout: Partial<Layout> = useMemo(
    () => ({
      margin: { l: 50, r: 20, t: 8, b: 40 },
      height: 420,
      xaxis: {
        title: { text: "Wavenumber (cm⁻¹)" },
        autorange: "reversed",
        zeroline: false,
      },
      yaxis: {
        title: { text: mode === "absorbance" ? "Absorbance" : "Transmittance" },
        zeroline: false,
      },
      shapes: peakShapes,
      showlegend: false,
    }),
    [mode, peakShapes],
  );

  return (
    <div className="card shrink-0 p-3">
      <div className="flex items-baseline justify-between px-1 pb-1">
        <h3 className="text-sm font-semibold">Spectrum</h3>
        <div className="text-xs text-ink-500">
          x-axis is reversed (IR convention). {peaks.length} peaks highlighted.
        </div>
      </div>
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
          config={{ displaylogo: false, responsive: true }}
        />
      )}
    </div>
  );
}

function PeaksTable(props: { peaks: FTIRPeak[]; assignments: FTIRAssignment[] | null }) {
  const { peaks, assignments } = props;
  const assignmentsByWn = useMemo(() => {
    const m = new Map<number, FTIRAssignment>();
    for (const a of assignments ?? []) m.set(a.wn, a);
    return m;
  }, [assignments]);

  return (
    <div className="card shrink-0">
      <div className="flex items-baseline justify-between border-b border-ink-200 px-4 py-2">
        <h3 className="text-sm font-semibold">Peaks</h3>
        <div className="text-xs text-ink-500">
          {peaks.length} peaks
          {assignments ? ` · library assignments (top ${Math.max(
            1,
            Math.max(...assignments.map((a) => a.candidates.length), 0),
          )})` : ""}
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
              {assignments && <Th align="right">Score</Th>}
              {assignments && <Th>Alternates</Th>}
            </tr>
          </thead>
          <tbody>
            {peaks.map((p, i) => {
              const a = assignmentsByWn.get(p.wn);
              const top = a?.candidates?.[0];
              const alts = a?.candidates?.slice(1) ?? [];
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

function Field(props: { label: string; children: React.ReactNode }) {
  return (
    <div>
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
