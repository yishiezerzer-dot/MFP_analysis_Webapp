import { useCallback, useMemo, useRef, useState } from "react";
import Plot from "react-plotly.js";
import type { PlotlyHTMLElement } from "plotly.js";
import {
  api,
  type DeconvolutedComponent,
  type LCMSDeconvolutionResult,
  type SpectrumData,
} from "../../api";
import { usePlotlyTheme } from "../../theme/ThemeProvider";
import { PaperFigureExportToolbar } from "../PaperFigureExportToolbar";
import {
  exportPlotlyPublicationImage,
  type PublicationExportFormat,
  type PublicationExportSettings,
  publicationFilenameSuffix,
} from "../../utils/publicationPlotExport";
import { axisTitle, queuePlotlyElementResize, useContainerSize } from "../../lcms/plotUtils";
import { Modal, NumberSetting, SelectSetting } from "./DialogControls";
import { rowsToCsv, type LCMSEICMetadata } from "../../lcms/analysis";

export function DeconvolutionDialog({
  activeSid,
  spectrum,
  polarity,
  onCreateEic,
  onClose,
}: {
  activeSid: string | null;
  spectrum: SpectrumData | null;
  polarity: "positive" | "negative";
  onCreateEic: (mz: number, tolerance: number, metadata?: Partial<LCMSEICMetadata>) => void;
  onClose: () => void;
}) {
  const [minCharge, setMinCharge] = useState(1);
  const [maxCharge, setMaxCharge] = useState(8);
  const [tolerance, setTolerance] = useState(0.02);
  const [toleranceUnit, setToleranceUnit] = useState<"da" | "ppm">("da");
  const [minRelIntensity, setMinRelIntensity] = useState(1.0);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<LCMSDeconvolutionResult | null>(null);
  const [selectedCompIndex, setSelectedCompIndex] = useState<number | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<PlotlyHTMLElement | null>(null);
  const plotSize = useContainerSize(containerRef, 360);
  const pt = usePlotlyTheme();

  const handleRunDeconvolution = async () => {
    if (!activeSid || !spectrum) return;
    setBusy(true);
    try {
      const rt = spectrum.meta.rt_min;
      const res = await api.lcms.deconvolute(activeSid, {
        rt_min: rt,
        rt_max: spectrum.meta.rt_max,
        polarity,
        min_charge: minCharge,
        max_charge: maxCharge,
        tolerance,
        tolerance_unit: toleranceUnit,
        min_rel_intensity: minRelIntensity / 100.0,
      });
      setResult(res);
      if (res.components.length > 0) {
        setSelectedCompIndex(0);
      }
    } catch (err) {
      console.error("Deconvolution error", err);
    } finally {
      setBusy(false);
    }
  };

  const handleExportCsv = () => {
    if (!result || result.components.length === 0) return;
    const header = [
      "Component_Rank",
      "Neutral_Mass_Da",
      "Total_Intensity",
      "Confidence_Score",
      "Method",
      "Charge",
      "Observed_mz",
      "Theoretical_mz",
      "Error_Da",
      "Error_ppm",
    ];
    const rows: Array<Array<string | number>> = [header];
    result.components.forEach((comp, idx) => {
      for (const cs of comp.charge_states) {
        rows.push([
          idx + 1,
          comp.mass.toFixed(4),
          comp.total_intensity.toExponential(4),
          (comp.score * 100).toFixed(1) + "%",
          comp.method,
          cs.charge,
          cs.observed_mz.toFixed(5),
          cs.theoretical_mz.toFixed(5),
          cs.error_da.toFixed(5),
          cs.error_ppm.toFixed(2),
        ]);
      }
    });
    const csv = rowsToCsv(rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `esi_deconvolution_${polarity}_rt${spectrum?.meta.rt_min?.toFixed(2) ?? "0"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCreateComponentEics = (comp: DeconvolutedComponent) => {
    for (const cs of comp.charge_states) {
      onCreateEic(cs.observed_mz, 0.02, {
        label: `M=${comp.mass.toFixed(1)} (+${cs.charge})`,
        annotation: `Deconvoluted neutral mass ${comp.mass.toFixed(2)} Da`,
      });
    }
  };

  const savePublication = useCallback(
    (format: PublicationExportFormat, exportSettings: PublicationExportSettings) => {
      if (!plotRef.current || !result || result.zero_charge_spectrum.mass.length === 0) return;
      void exportPlotlyPublicationImage(
        plotRef.current,
        {
          format,
          filename: `lcms_zero_charge_mass_${publicationFilenameSuffix(exportSettings, format)}`,
          ...exportSettings,
        },
        {
          layoutOverrides: {
            font: { family: "Arial, Helvetica, sans-serif", size: 9, color: "#111827" },
            margin: { l: 58, r: 18, t: 16, b: 46 },
          },
        },
      );
    },
    [result],
  );

  const zeroSpecData = useMemo(() => {
    if (!result || result.zero_charge_spectrum.mass.length === 0) return null;
    const masses = result.zero_charge_spectrum.mass;
    const intensities = result.zero_charge_spectrum.intensity;
    return {
      x: masses,
      y: intensities,
      text: masses.map((m, i) => `M: ${m.toFixed(2)} Da<br>Int: ${intensities[i].toExponential(2)}`),
    };
  }, [result]);

  return (
    <Modal
      title="ESI Multi-Charge & Isotopic Deconvolution"
      onClose={onClose}
      width="max-w-6xl"
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <div className="text-xs text-ink-500">
            {result
              ? `Found ${result.summary.total_components} component(s) across charges ${minCharge}-${maxCharge}`
              : "Ready to deconvolute current MS1 spectrum"}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded-md border border-ink-200 bg-surface px-3 py-1.5 text-sm text-ink-700 hover:bg-ink-50 disabled:cursor-not-allowed disabled:text-ink-400"
              disabled={!result || result.components.length === 0}
              onClick={handleExportCsv}
            >
              Export CSV
            </button>
            <button className="btn-primary" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-4 text-sm">
        <div className="rounded-md border border-brand-200 bg-brand-50/70 p-3 text-xs text-brand-800">
          <strong>ESI Deconvolution Engine:</strong> Automatically computes true zero-charge neutral
          masses M for proteins, peptides, and polymers by deducing multi-charge envelopes [M ± zH]^z±
          and high-resolution isotopic spacings Δ(m/z) = 1.003355/z.
        </div>

        {/* Control toolbar */}
        <div className="grid grid-cols-6 gap-3 rounded-lg border border-ink-200 bg-surface p-3">
          <NumberSetting
            label="Min charge (z)"
            value={minCharge}
            min={1}
            max={20}
            step={1}
            onChange={(v) => setMinCharge(Math.max(1, Math.round(v ?? 1)))}
          />
          <NumberSetting
            label="Max charge (z)"
            value={maxCharge}
            min={1}
            max={25}
            step={1}
            onChange={(v) => setMaxCharge(Math.max(minCharge, Math.round(v ?? 8)))}
          />
          <div className="flex flex-col">
            <div className="flex items-center justify-between">
              <span className="label text-xs">Tolerance</span>
              <div className="inline-flex rounded border border-ink-200 bg-ink-50 p-0.5 text-[10px]">
                <button
                  type="button"
                  className={`rounded px-1 py-0.5 font-semibold transition-colors ${
                    toleranceUnit === "da" ? "bg-surface text-ink-900 shadow-sm" : "text-ink-500"
                  }`}
                  onClick={() => {
                    setToleranceUnit("da");
                    if (tolerance > 1) setTolerance(0.02);
                  }}
                >
                  Da
                </button>
                <button
                  type="button"
                  className={`rounded px-1 py-0.5 font-semibold transition-colors ${
                    toleranceUnit === "ppm" ? "bg-surface text-ink-900 shadow-sm" : "text-ink-500"
                  }`}
                  onClick={() => {
                    setToleranceUnit("ppm");
                    if (tolerance < 0.1) setTolerance(20);
                  }}
                >
                  ppm
                </button>
              </div>
            </div>
            <input
              type="number"
              step={toleranceUnit === "da" ? 0.005 : 1}
              min={toleranceUnit === "da" ? 0.001 : 0.5}
              className="input mt-1 w-full text-xs"
              value={tolerance}
              onChange={(e) =>
                setTolerance(
                  Math.max(
                    toleranceUnit === "da" ? 0.001 : 0.5,
                    parseFloat(e.target.value) || (toleranceUnit === "da" ? 0.02 : 20),
                  ),
                )
              }
            />
          </div>
          <NumberSetting
            label="Min intensity (%)"
            value={minRelIntensity}
            min={0.1}
            max={100}
            step={0.5}
            onChange={(v) => setMinRelIntensity(Math.max(0.1, v ?? 1.0))}
          />
          <div className="flex flex-col justify-end">
            <button
              type="button"
              className="btn-primary flex items-center justify-center gap-2 py-2 text-xs"
              disabled={busy || !activeSid || !spectrum}
              onClick={handleRunDeconvolution}
            >
              {busy ? (
                <>
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-surface border-t-transparent" />
                  Deconvoluting…
                </>
              ) : (
                "⚛ Run Deconvolution"
              )}
            </button>
          </div>
          <div className="flex flex-col justify-end">
            <PaperFigureExportToolbar
              disabled={!result || result.zero_charge_spectrum.mass.length === 0}
              storageKey="mfp-publication-plot-export-lcms-deconvolution"
              onExport={savePublication}
            />
          </div>
        </div>

        {/* Zero-Charge True Mass Spectrum */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-ink-600">
              Zero-Charge True Mass Spectrum (Deconvoluted M, Da)
            </h4>
            {result && result.components.length > 0 && (
              <span className="text-[11px] text-ink-500">
                Dominant mass: <strong>{result.components[0].mass.toFixed(2)} Da</strong>
              </span>
            )}
          </div>
          <div
            ref={containerRef}
            className="h-[320px] w-full overflow-hidden rounded-md border border-ink-200 bg-surface"
          >
            {zeroSpecData ? (
              <Plot
                revision={plotSize.revision}
                data={[
                  {
                    type: "bar",
                    x: zeroSpecData.x,
                    y: zeroSpecData.y,
                    hoverinfo: "text",
                    hovertext: zeroSpecData.text,
                    marker: {
                      color: "#1d4ed8",
                      width: 1.5,
                    },
                  },
                ]}
                layout={{
                  height: plotSize.height,
                  width: plotSize.width,
                  margin: { l: 64, r: 24, t: 24, b: 48 },
                  xaxis: {
                    title: axisTitle("Molecular Weight / Neutral Mass M (Da)", 12),
                    zeroline: false,
                    showgrid: true,
                  },
                  yaxis: {
                    title: axisTitle("Deconvoluted Intensity", 12),
                    zeroline: false,
                    showgrid: true,
                  },
                  plot_bgcolor: pt.plot_bgcolor,
                  paper_bgcolor: pt.paper_bgcolor,
                  dragmode: "zoom",
                }}
                config={{ responsive: true, displaylogo: false }}
                style={{ width: "100%", height: "100%", minWidth: 0 }}
                useResizeHandler
                onInitialized={(_figure, graphDiv) => {
                  plotRef.current = graphDiv as PlotlyHTMLElement;
                  queuePlotlyElementResize(plotRef.current);
                }}
                onUpdate={(_figure, graphDiv) => {
                  plotRef.current = graphDiv as PlotlyHTMLElement;
                }}
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center p-6 text-center text-sm text-ink-400">
                <span>Click &ldquo;⚛ Run Deconvolution&rdquo; above to calculate the zero-charge true mass spectrum.</span>
              </div>
            )}
          </div>
        </div>

        {/* Deconvoluted Components Table */}
        {result && result.components.length > 0 && (
          <div className="flex flex-col gap-1">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-ink-600">
              Deconvoluted Mass Components ({result.components.length})
            </h4>
            <div className="max-h-[280px] overflow-auto rounded-md border border-ink-200">
              <table className="min-w-full divide-y divide-ink-200 text-xs">
                <thead className="sticky top-0 bg-ink-50 text-left text-ink-600">
                  <tr>
                    <th className="px-2.5 py-2 font-medium">#</th>
                    <th className="px-2.5 py-2 font-medium">Neutral Mass M (Da)</th>
                    <th className="px-2.5 py-2 font-medium">Total Intensity</th>
                    <th className="px-2.5 py-2 font-medium">Score</th>
                    <th className="px-2.5 py-2 font-medium">Type</th>
                    <th className="px-2.5 py-2 font-medium">Observed Charge Envelope (z → m/z)</th>
                    <th className="px-2.5 py-2 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100 bg-surface">
                  {result.components.map((comp, idx) => {
                    const isSelected = selectedCompIndex === idx;
                    return (
                      <tr
                        key={idx}
                        className={`cursor-pointer transition-colors ${
                          isSelected ? "bg-brand-50/60" : "hover:bg-ink-50/50"
                        }`}
                        onClick={() => setSelectedCompIndex(idx)}
                      >
                        <td className="px-2.5 py-2 font-semibold text-ink-700">#{idx + 1}</td>
                        <td className="px-2.5 py-2 font-mono text-sm font-semibold text-brand-700">
                          {comp.mass.toFixed(4)}
                        </td>
                        <td className="px-2.5 py-2 font-mono text-ink-600">
                          {comp.total_intensity.toExponential(2)}
                        </td>
                        <td className="px-2.5 py-2 font-medium">
                          <span
                            className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                              comp.score >= 0.8
                                ? "bg-emerald-100 text-emerald-800"
                                : comp.score >= 0.6
                                  ? "bg-amber-100 text-amber-800"
                                  : "bg-ink-100 text-ink-700"
                            }`}
                          >
                            {(comp.score * 100).toFixed(0)}%
                          </span>
                        </td>
                        <td className="px-2.5 py-2 capitalize text-ink-500">{comp.method}</td>
                        <td className="max-w-[340px] px-2.5 py-2 text-ink-700">
                          <div className="flex flex-wrap gap-1">
                            {comp.charge_states.map((cs) => (
                              <span
                                key={cs.charge}
                                className="inline-flex items-baseline gap-0.5 rounded bg-ink-100 px-1 py-0.5 text-[10px] font-mono"
                                title={`Theoretical m/z: ${cs.theoretical_mz.toFixed(4)}, Err: ${cs.error_ppm.toFixed(1)} ppm`}
                              >
                                <strong>+{cs.charge}:</strong> {cs.observed_mz.toFixed(2)}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-2.5 py-2 text-right">
                          <button
                            type="button"
                            className="rounded border border-ink-200 bg-surface px-2 py-1 text-[11px] font-medium text-ink-700 shadow-sm hover:bg-ink-50"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCreateComponentEics(comp);
                            }}
                            title="Extract Ion Chromatograms for each charge state of this component"
                          >
                            Create EICs
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
