import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { FileSpreadsheet, SquareMinus, Spline, Table2 } from "lucide-react";
import { api, type PlateAnalysis, type PlateLayout, type PlateSummary } from "../../api";
import { ToolbarButton } from "../common/ChartCardParts";
import { useStoredState } from "../../hooks/useStoredState";
import { downloadBlob } from "../../lcms/viewShared";
import { rowsToCsv } from "../../lcms/analysis";
import { sanitizeFilenamePart } from "../../utils/publicationPlotExport";
import { explainPlateChart, type ExplainOptions } from "../../utils/plateExplanations";
import { formatConcentration, formatPercent } from "../../utils/plateLayout";
import { PlateGrid } from "./PlateGrid";
import { DoseResponseChart, GrowthChart, StickChart, usePlateChartRefs } from "./PlateCharts";
import { ResultCard, type ChartDesign } from "./ResultCard";

const STORAGE = "mfp.plateReader";

function fileStem(plate: PlateSummary): string {
  return sanitizeFilenamePart(plate.display_name.replace(/\.[^.]+$/, ""), "plate");
}

export function resultsCsv(a: PlateAnalysis): string {
  const maxN = Math.max(0, ...a.groups.flatMap((g) => g.points.map((p) => p.wells.length)));
  const header = [
    "Compound",
    "Kind",
    `Concentration (${a.unit})`,
    "n",
    ...Array.from({ length: maxN }, (_, i) => `Replicate ${i + 1}`),
    "Mean OD",
    "SD",
    "% growth",
    "Excluded wells",
  ];
  const rows = a.groups.flatMap((g) =>
    g.points.map((p) => [
      g.name,
      g.kind,
      p.concentration,
      p.n,
      ...Array.from({ length: maxN }, (_, i) => {
        const w = p.wells[i];
        return w && !w.excluded && w.value != null ? w.value : "";
      }),
      p.mean ?? "",
      p.sd ?? "",
      p.percent_growth ?? "",
      p.wells.filter((w) => w.excluded).map((w) => w.well).join(" "),
    ]),
  );
  return rowsToCsv([header, ...rows]);
}

function ResultsTable({ analysis }: { analysis: PlateAnalysis }) {
  return (
    <div className="max-h-[320px] overflow-auto">
      <table className="data-table">
        <thead>
          <tr>
            <th>Compound</th>
            <th className="text-right">{analysis.unit}</th>
            <th className="text-right">n</th>
            <th>Replicates (OD{analysis.blank.used ? " − blank" : ""})</th>
            <th className="text-right">Mean</th>
            <th className="text-right">SD</th>
            <th className="text-right">% growth</th>
          </tr>
        </thead>
        <tbody>
          {analysis.groups.flatMap((g) =>
            g.points.map((p) => (
              <tr key={`${g.id}-${p.concentration}`}>
                <td className="whitespace-nowrap">{g.name}</td>
                <td className="mono text-right">{formatConcentration(p.concentration)}</td>
                <td className="mono text-right">{p.n}</td>
                <td className="mono whitespace-nowrap">
                  {p.wells.map((w, i) => (
                    <span
                      key={w.well}
                      title={w.excluded ? `${w.well} excluded` : w.well}
                      className={clsx(w.excluded && "text-ink-500 line-through")}
                    >
                      {i > 0 && " · "}
                      {w.value == null ? "–" : w.value.toFixed(3)}
                    </span>
                  ))}
                </td>
                <td className="mono text-right">{p.mean == null ? "–" : p.mean.toFixed(3)}</td>
                <td className="mono text-right">{p.sd == null ? "–" : p.sd.toFixed(3)}</td>
                <td className="mono text-right">{formatPercent(p.percent_growth)}</td>
              </tr>
            )),
          )}
        </tbody>
      </table>
    </div>
  );
}

function FitSummary({ analysis }: { analysis: PlateAnalysis }) {
  return (
    <ul className="mt-1 flex flex-col gap-0.5 px-1 text-[12px] text-ink-700">
      {analysis.groups.map((g) => {
        const f = g.fit;
        if (!f) return <li key={g.id}>{g.name}: no 4PL fit (needs 4 or more concentrations with a mean)</li>;
        const se = f.ic50_se != null ? ` ± ${formatConcentration(f.ic50_se)}` : "";
        return (
          <li key={g.id} className={clsx(f.ic50_in_range === false && "text-warning-fg")}>
            {g.name}: IC₅₀ {formatConcentration(f.ic50)}
            {se} {analysis.unit} · Hill {f.hill_slope.toFixed(2)} · R² {f.r_squared.toFixed(3)}
            {f.ic50_in_range === false && " · outside the tested range: do not report"}
          </li>
        );
      })}
    </ul>
  );
}

// Only fields the user changed are stored, so default axis labels follow the blank setting.
function useDesign(key: string, defaults: ChartDesign): [ChartDesign, (d: ChartDesign) => void] {
  const [overrides, setOverrides] = useStoredState<Partial<ChartDesign>>(`${STORAGE}.design.${key}`, {});
  const design = { ...defaults, ...overrides };
  const set = (d: ChartDesign) =>
    setOverrides(
      Object.fromEntries(
        (Object.keys(d) as (keyof ChartDesign)[]).filter((k) => d[k] !== defaults[k]).map((k) => [k, d[k]]),
      ),
    );
  return [design, set];
}

export function ResultsTab({ plate, layout }: { plate: PlateSummary; layout: PlateLayout }) {
  const [subtractBlank, setSubtractBlank] = useStoredState(`${STORAGE}.subtractBlank`, true);
  const [fit4pl, setFit4pl] = useStoredState(`${STORAGE}.fit4pl`, false);
  const [analysis, setAnalysis] = useState<PlateAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const hasBlank = layout.blank.length > 0;
  const subtract = subtractBlank && hasBlank;
  const odLabel = plate.label ? `OD${plate.label}` : "OD";
  const yLabel = `${odLabel}${subtract ? " (blank-subtracted)" : ""}`;
  const xLabel = `Concentration (${layout.dilution.unit})`;

  const [doseDesign, setDoseDesign] = useDesign("dose", { title: "", xLabel, yLabel });
  const [growthDesign, setGrowthDesign] = useDesign("growth", { title: "", xLabel, yLabel: "Growth (% of growth control)" });
  const [stickDesign, setStickDesign] = useDesign("stick", { title: "", xLabel, yLabel });
  const dose = usePlateChartRefs();
  const growth = usePlateChartRefs();
  const stick = usePlateChartRefs();

  useEffect(() => {
    let cancelled = false;
    setError(null);
    api.plateReader
      .analyse(plate.session_id, { layout, subtract_blank: subtract, fit_4pl: fit4pl })
      .then((a) => !cancelled && setAnalysis(a))
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [plate.session_id, layout, subtract, fit4pl]);

  const opts: ExplainOptions = { subtractBlank: subtract, fit4pl };
  const explain = useMemo(
    () => (analysis ? (kind: Parameters<typeof explainPlateChart>[0]) => explainPlateChart(kind, analysis, layout, opts) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [analysis, layout, subtract, fit4pl],
  );

  const downloadWorkbook = async () => {
    setDownloading(true);
    try {
      downloadBlob(await api.plateReader.workbook(plate.session_id, subtract), `${fileStem(plate)}_calculation.xlsx`);
    } catch (e) {
      setError(String(e));
    } finally {
      setDownloading(false);
    }
  };

  const toolbar = (
    <div className="flex flex-wrap items-center gap-1 px-1">
      <ToolbarButton
        icon={SquareMinus}
        label="Subtract blank"
        active={subtract}
        disabled={!hasBlank}
        title={hasBlank ? "Subtract the mean of the blank wells from every well" : "No blank wells in the layout"}
        onClick={() => setSubtractBlank(!subtractBlank)}
      />
      <ToolbarButton
        icon={Spline}
        label="4PL fit (IC₅₀)"
        active={fit4pl}
        title="Fit a 4-parameter logistic curve to each compound's means"
        onClick={() => setFit4pl(!fit4pl)}
      />
      <span className="flex-1" />
      <ToolbarButton
        icon={FileSpreadsheet}
        label={downloading ? "Preparing…" : "Calculation workbook"}
        title="Excel workbook with every step as a live formula, from the raw plate to % growth"
        disabled={downloading}
        onClick={() => void downloadWorkbook()}
      />
    </div>
  );

  if (error) {
    return (
      <div className="flex flex-col gap-3">
        {toolbar}
        <div className="card p-6 text-sm text-danger-fg">{error}</div>
      </div>
    );
  }
  if (!analysis || !explain) {
    return (
      <div className="flex flex-col gap-3">
        {toolbar}
        <div className="card p-8 text-center text-sm text-ink-500">Calculating…</div>
      </div>
    );
  }
  if (analysis.groups.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        {toolbar}
        <div className="card p-8 text-center text-sm text-ink-500">
          No compounds on this plate yet. Set them up in the Plate map tab.
        </div>
      </div>
    );
  }

  const maxN = Math.max(...analysis.groups.flatMap((g) => g.points.map((p) => p.n)));
  const nRows = analysis.groups.reduce((s, g) => s + g.points.length, 0);

  return (
    <div className="flex flex-col gap-3">
      {toolbar}
      <div className="grid grid-cols-1 gap-3 2xl:grid-cols-2">
        <ResultCard
          title="Plate heatmap"
          status={[odLabel + " as read", layout.excluded.length > 0 && `${layout.excluded.length} excluded`]}
          explanation={explain("heatmap")}
          actions={
            <ToolbarButton
              icon={Table2}
              label="CSV"
              title="The 8×12 plate as read"
              onClick={() => {
                const rows = [["", ...Array.from({ length: 12 }, (_, i) => i + 1)], ..."ABCDEFGH".split("").map((r) => [r, ...Array.from({ length: 12 }, (_, i) => plate.values[`${r}${i + 1}`] ?? "")])];
                downloadBlob(new Blob([rowsToCsv(rows)], { type: "text/csv" }), `${fileStem(plate)}_plate.csv`);
              }}
            />
          }
        >
          <div className="flex min-h-[270px] items-center justify-center overflow-x-auto">
            <PlateGrid values={plate.values} layout={layout} compact />
          </div>
        </ResultCard>
        <ResultCard
          title="Dose–response"
          status={[`mean ± SD of up to ${maxN} replicates`, "dashed = growth control", fit4pl && "dotted = 4PL"]}
          explanation={explain("dose")}
          design={doseDesign}
          onDesignChange={setDoseDesign}
          plotRef={dose.plotRef}
          exportName={`${fileStem(plate)}_dose_response`}
        >
          <DoseResponseChart analysis={analysis} design={doseDesign} showFit={fit4pl} {...dose} />
          {fit4pl && <FitSummary analysis={analysis} />}
        </ResultCard>
        <ResultCard
          title="% growth"
          status={["mean OD ÷ growth-control OD × 100", "dashed = 100%"]}
          explanation={explain("growth")}
          design={growthDesign}
          onDesignChange={setGrowthDesign}
          plotRef={growth.plotRef}
          exportName={`${fileStem(plate)}_percent_growth`}
        >
          <GrowthChart analysis={analysis} design={growthDesign} {...growth} />
        </ResultCard>
        <ResultCard
          title="Stick plot"
          status={["bars = mean ± SD", "GC = growth control"]}
          explanation={explain("stick")}
          design={stickDesign}
          onDesignChange={setStickDesign}
          plotRef={stick.plotRef}
          exportName={`${fileStem(plate)}_stick_plot`}
        >
          <StickChart analysis={analysis} design={stickDesign} {...stick} />
        </ResultCard>
        <ResultCard
          className="2xl:col-span-2"
          title="Results table"
          status={[analysis.blank.used ? "blank-subtracted" : "OD as read", `${nRows} rows`]}
          explanation={explain("table")}
          actions={
            <>
              <ToolbarButton
                icon={Table2}
                label="CSV"
                onClick={() =>
                  downloadBlob(new Blob([resultsCsv(analysis)], { type: "text/csv" }), `${fileStem(plate)}_results.csv`)
                }
              />
              <ToolbarButton
                icon={FileSpreadsheet}
                label="Excel"
                title="Calculation workbook: this table with live formulas"
                disabled={downloading}
                onClick={() => void downloadWorkbook()}
              />
            </>
          }
        >
          <ResultsTable analysis={analysis} />
        </ResultCard>
      </div>
    </div>
  );
}
