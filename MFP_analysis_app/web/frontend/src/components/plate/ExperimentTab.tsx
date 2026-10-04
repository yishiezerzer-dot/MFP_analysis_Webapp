import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { Archive, FileSpreadsheet, Table2 } from "lucide-react";
import { api, type PlateExperiment } from "../../api";
import { ToolbarButton } from "../common/ChartCardParts";
import { Hint } from "../Hint";
import { useStoredState } from "../../hooks/useStoredState";
import { downloadBlob } from "../../lcms/viewShared";
import { rowsToCsv } from "../../lcms/analysis";
import { sanitizeFilenamePart } from "../../utils/publicationPlotExport";
import { checkSummary } from "../../utils/plateExplanations";
import {
  combinedAnalysis,
  explainExperiment,
  gridCsv,
  growthFill,
  micGrid,
  plateLabel,
} from "../../utils/plateExperiment";
import { formatConcentration } from "../../utils/plateLayout";
import { GrowthChart, usePlateChartRefs } from "./PlateCharts";
import { ResultCard, type ChartDesign } from "./ResultCard";

function MicGridTable({ exp }: { exp: PlateExperiment }) {
  const grid = useMemo(() => micGrid(exp), [exp]);
  return (
    <div className="overflow-x-auto">
      <table className="border-separate text-[12px]" style={{ borderSpacing: 2 }}>
        <thead>
          <tr>
            <th className="px-2 text-left font-medium text-ink-500">Compound · replicate</th>
            {grid.concentrations.map((c) => (
              <th key={c} className="text-mono-val min-w-[44px] px-1 text-center font-normal text-ink-500">
                {formatConcentration(c)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.rows.map((r, i) => (
            <tr key={i}>
              <th scope="row" className={clsx("whitespace-nowrap px-2 text-left", r.mean ? "pt-2 font-semibold text-ink-900" : "pl-6 font-normal text-ink-600")}>
                {r.mean ? (
                  <>
                    {r.compound} <span className="font-normal text-ink-500">{r.plate} · mean</span>
                  </>
                ) : (
                  r.label
                )}
              </th>
              {r.cells.map((cell, j) => (
                <td
                  key={j}
                  title={cell.excluded ? "excluded" : undefined}
                  className={clsx(
                    "rounded-[4px] px-1 py-0.5 text-center font-mono",
                    r.mean && "font-semibold",
                    cell.excluded && "plate-well-excluded",
                  )}
                  style={cell.excluded ? undefined : growthFill(cell.percent)}
                >
                  {cell.percent === null ? "–" : Math.round(cell.percent) || 0}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PlateChecks({ exp }: { exp: PlateExperiment }) {
  return (
    <div className="card flex min-w-0 flex-col gap-3 p-4">
      <h3 className="text-card-title">Plate checks</h3>
      {exp.plates.map((p, i) => {
        const warnings = p.analysis.checks.filter((c) => c.level === "warn");
        const excluded = p.analysis.excluded;
        return (
          <div key={p.session_id} className="flex flex-col gap-1 text-[12px]">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-semibold text-ink-900">{plateLabel(p, i)}</span>
              <span className="text-caption truncate">{p.display_name}</span>
            </div>
            <div className={clsx(warnings.length ? "text-warning-fg" : "text-success-fg")}>
              {checkSummary(p.analysis.checks)}
            </div>
            {warnings.map((c, j) => (
              <div key={j} className="text-ink-700">
                ⚠ {c.message}
              </div>
            ))}
            {excluded.length > 0 && <div className="text-ink-600">Excluded: {excluded.join(", ")}</div>}
            {p.layout_source !== "saved" && (
              <div className="text-ink-600">Layout not confirmed yet: open this plate's Plate map to check it.</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function ExperimentTab({ tag, refreshKey }: { tag: string; refreshKey: number }) {
  const [subtractBlank] = useStoredState("mfp.plateReader.subtractBlank", true);
  const [exp, setExp] = useState<PlateExperiment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"si" | "excel" | null>(null);
  const [design, setDesign] = useState<ChartDesign>({ title: "", xLabel: "", yLabel: "Growth (% of growth control)" });
  const chart = usePlateChartRefs();

  useEffect(() => {
    let cancelled = false;
    api.plateReader
      .experiment(tag, subtractBlank)
      .then((e) => !cancelled && setExp(e))
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [tag, subtractBlank, refreshKey]);

  const combined = useMemo(() => (exp ? combinedAnalysis(exp) : null), [exp]);
  const stem = sanitizeFilenamePart(tag, "experiment");

  const exportExcel = async () => {
    setBusy("excel");
    try {
      downloadBlob(await api.plateReader.experimentWorkbook(tag, subtractBlank), `${stem}_plates.xlsx`);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };

  // Record each plate's current analysis first, so the SI package has every plate.
  const downloadSI = async () => {
    if (!exp) return;
    setBusy("si");
    try {
      await Promise.all(
        exp.plates.map((p) => api.plateReader.analyse(p.session_id, { subtract_blank: subtractBlank, fit_4pl: false })),
      );
      downloadBlob(await api.publication.downloadSIPackage({ experiment_tag: tag }), `${stem}_SI_Package.zip`);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };

  if (error) return <div className="card p-6 text-sm text-danger-fg">{error}</div>;
  if (!exp || !combined) return <div className="card p-8 text-center text-sm text-ink-500">Loading experiment…</div>;

  const dates = [...new Set(exp.plates.map((p) => String(p.metadata.date ?? "").slice(0, 10)).filter(Boolean))];
  const unit = combined.unit;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1">
        <span className="text-card-title">Experiment: {exp.experiment_tag}</span>
        <span className="text-caption">
          {[
            `${exp.plates.length} plate${exp.plates.length === 1 ? "" : "s"}`,
            `${combined.groups.length} compound${combined.groups.length === 1 ? "" : "s"}`,
            dates.join(", "),
            subtractBlank ? "blank-subtracted" : "OD as read",
          ].filter(Boolean).join(" · ")}
        </span>
        <span className="flex-1" />
        <Hint id="plate.siPackage">
          <ToolbarButton
            icon={Archive}
            label={busy === "si" ? "Preparing…" : "Download SI package"}
            disabled={busy !== null}
            onClick={() => void downloadSI()}
          />
        </Hint>
        <Hint id="plate.exportAll">
          <ToolbarButton
            icon={FileSpreadsheet}
            label={busy === "excel" ? "Preparing…" : "Export all (Excel)"}
            disabled={busy !== null}
            onClick={() => void exportExcel()}
          />
        </Hint>
      </div>
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,600px)_minmax(0,1fr)]">
        <ResultCard
          title="% growth — all compounds"
          status={["each vs its own plate's growth control", "dashed = 100%"]}
          explanation={explainExperiment("growth", exp)}
          design={{ ...design, xLabel: design.xLabel || `Concentration (${unit})` }}
          onDesignChange={setDesign}
          plotRef={chart.plotRef}
          exportName={`${stem}_percent_growth`}
        >
          <GrowthChart
            analysis={combined}
            design={{ ...design, xLabel: design.xLabel || `Concentration (${unit})` }}
            {...chart}
          />
        </ResultCard>
        <PlateChecks exp={exp} />
      </div>
      <ResultCard
        title="MIC reading grid"
        status={[`% growth per concentration (${unit})`, "mean and each replicate", "read the MIC where the colour turns white"]}
        explanation={explainExperiment("grid", exp)}
        actions={
          <Hint id="plate.gridCsv">
            <ToolbarButton
              icon={Table2}
              label="CSV"
              onClick={() => downloadBlob(new Blob([rowsToCsv(gridCsv(exp))], { type: "text/csv" }), `${stem}_mic_grid.csv`)}
            />
          </Hint>
        }
      >
        <MicGridTable exp={exp} />
      </ResultCard>
    </div>
  );
}
