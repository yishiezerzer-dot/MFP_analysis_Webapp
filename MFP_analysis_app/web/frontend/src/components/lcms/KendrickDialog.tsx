import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Plot from "react-plotly.js";
import type { PlotlyHTMLElement } from "plotly.js";
import type { SpectrumData } from "../../api";
import { usePlotlyTheme } from "../../theme/ThemeProvider";
import { PaperFigureExportToolbar } from "../PaperFigureExportToolbar";
import {
  exportPlotlyPublicationImage,
  type PublicationExportFormat,
  type PublicationExportSettings,
  publicationFilenameSuffix,
} from "../../utils/publicationPlotExport";
import {
  buildKendrickPoints,
  KENDRICK_POINT_LIMIT,
  parseExpectedProductMonomers,
  polymerMonomerText,
  type KendrickPoint,
  type LCMSEICMetadata,
  type PolymerUiSettings,
} from "../../lcms/analysis";
import {
  axisTitle,
  queuePlotlyElementResize,
  useContainerSize,
  usePlotResizePulses,
} from "../../lcms/plotUtils";
import { Modal, NumberSetting, SelectSetting } from "./DialogControls";

export const KENDRICK_SETTINGS_STORAGE_KEY = "mfp.lcms.kendrickSettings";

export interface KendrickPersistedSettings {
  repeatSource: string;
  customMass: number;
  minRelIntensity: number;
  toleranceValue: number;
  toleranceUnit: "kmd" | "ppm";
  minSeriesPoints: number;
  xMode: "mz" | "knm";
  labelSeries: boolean;
}

export function loadKendrickSettings(): Partial<KendrickPersistedSettings> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(KENDRICK_SETTINGS_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Partial<KendrickPersistedSettings>) : {};
  } catch {
    return {};
  }
}

export function KendrickDialog({
  spectrum,
  settings,
  onCreateEic,
  onClose,
}: {
  spectrum: SpectrumData | null;
  settings: PolymerUiSettings;
  onCreateEic: (mz: number, tolerance: number, metadata?: Partial<LCMSEICMetadata>) => void;
  onClose: () => void;
}) {
  const monomers = useMemo(() => parseExpectedProductMonomers(polymerMonomerText(settings)), [settings]);
  const firstMass = monomers[0]?.mass ?? 100;
  const stored = useMemo(loadKendrickSettings, []);
  const [repeatSource, setRepeatSource] = useState(stored.repeatSource ?? (monomers[0] ? "0" : "custom"));
  const [customMass, setCustomMass] = useState(stored.customMass ?? firstMass);
  const [minRelIntensity, setMinRelIntensity] = useState(stored.minRelIntensity ?? 1);
  const [toleranceUnit, setToleranceUnit] = useState<"kmd" | "ppm">(stored.toleranceUnit ?? "kmd");
  const [toleranceValue, setToleranceValue] = useState(
    stored.toleranceValue ?? (stored.toleranceUnit === "ppm" ? 20 : 0.01),
  );
  const [minSeriesPoints, setMinSeriesPoints] = useState(stored.minSeriesPoints ?? 3);
  const [xMode, setXMode] = useState<"mz" | "knm">(stored.xMode ?? "mz");
  const [labelSeries, setLabelSeries] = useState(stored.labelSeries ?? true);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const payload: KendrickPersistedSettings = {
        repeatSource,
        customMass,
        minRelIntensity,
        toleranceValue,
        toleranceUnit,
        minSeriesPoints,
        xMode,
        labelSeries,
      };
      window.localStorage.setItem(KENDRICK_SETTINGS_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      /* ignore (private mode / SSR) */
    }
  }, [repeatSource, customMass, minRelIntensity, toleranceValue, toleranceUnit, minSeriesPoints, xMode, labelSeries]);
  const containerRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<PlotlyHTMLElement | null>(null);
  const plotSize = useContainerSize(containerRef, 460);
  const pt = usePlotlyTheme();

  const selectedMonomer = repeatSource === "custom" ? null : monomers[Number(repeatSource)] ?? null;
  const repeatMass = selectedMonomer?.mass ?? customMass;
  const nominalRepeatMass = Number.isFinite(repeatMass) && repeatMass > 0 ? Math.round(repeatMass) : null;
  const result = useMemo(
    () =>
      spectrum
        ? buildKendrickPoints(
            spectrum,
            repeatMass,
            minRelIntensity,
            toleranceValue,
            toleranceUnit,
            Math.max(2, Math.round(minSeriesPoints)),
          )
        : { points: [], series: [], truncated: false },
    [minRelIntensity, minSeriesPoints, repeatMass, spectrum, toleranceUnit, toleranceValue],
  );
  const pointsBySeries = useMemo(() => {
    const map = new Map<number, KendrickPoint[]>();
    for (const point of result.points) {
      if (point.seriesId == null) continue;
      const list = map.get(point.seriesId);
      if (list) list.push(point);
      else map.set(point.seriesId, [point]);
    }
    return map;
  }, [result.points]);
  const handleCreateSeriesEic = useCallback(
    (seriesId: number) => {
      const list = pointsBySeries.get(seriesId);
      if (!list || list.length === 0) return;
      const top = [...list].sort((a, b) => b.intensity - a.intensity).slice(0, 5);
      for (const point of top) onCreateEic(point.mz, 0.02);
    },
    [onCreateEic, pointsBySeries],
  );
  const labelIds = useMemo(
    () =>
      new Set(
        result.points
          .filter((point) => point.seriesId != null)
          .sort((a, b) => b.intensity - a.intensity)
          .slice(0, 80)
          .map((point) => point.id),
      ),
    [result.points],
  );
  usePlotResizePulses([
    labelSeries,
    minRelIntensity,
    minSeriesPoints,
    repeatMass,
    result.points.length,
    result.series.length,
    toleranceUnit,
    toleranceValue,
    xMode,
  ], plotRef);

  const xValues = result.points.map((point) => (xMode === "knm" ? point.kendrickNominalMass : point.mz));
  const markerColors = result.points.map((point) =>
    point.seriesId == null
      ? "rgba(70,83,106,0.45)"
      : pt.colorway[(point.seriesId - 1) % pt.colorway.length] ?? "#3559A8",
  );
  const markerSizes = result.points.map((point) => Math.min(18, 5 + Math.sqrt(point.relIntensity) * 1.4));
  const markerText = result.points.map((point) =>
    labelSeries && point.seriesId != null && labelIds.has(point.id)
      ? `S${point.seriesId} ${point.mz.toFixed(1)}`
      : "",
  );
  const shapes = result.series.map((series) => ({
    type: "line" as const,
    xref: "paper" as const,
    x0: 0,
    x1: 1,
    y0: series.center,
    y1: series.center,
    line: {
      color: pt.colorway[(series.id - 1) % pt.colorway.length] ?? "#3559A8",
      width: 1,
      dash: "dot" as const,
    },
  }));
  const savePublication = useCallback(
    (format: PublicationExportFormat, exportSettings: PublicationExportSettings) => {
      if (!plotRef.current || result.points.length === 0) return;
      void exportPlotlyPublicationImage(plotRef.current, {
        format,
        filename: `lcms_kendrick_${publicationFilenameSuffix(exportSettings, format)}`,
        ...exportSettings,
      }, {
        layoutOverrides: {
          font: { family: "Arial, Helvetica, sans-serif", size: 9, color: "#111827" },
          margin: { l: 58, r: 18, t: 16, b: 46 },
        },
      });
    },
    [result.points.length],
  );

  return (
    <Modal
      title="Kendrick Mass Defect"
      onClose={onClose}
      width="max-w-6xl"
      footer={<button className="btn-primary" onClick={onClose}>Done</button>}
    >
      <div className="flex flex-col gap-4 text-sm">
        <div className="grid grid-cols-6 gap-3">
          <SelectSetting
            label="Repeat unit"
            value={repeatSource}
            options={[
              ...monomers.map((monomer, index) => ({
                value: String(index),
                label: `${monomer.name} (${monomer.mass.toFixed(4)})`,
              })),
              { value: "custom", label: "Custom mass" },
            ]}
            onChange={setRepeatSource}
          />
          <NumberSetting
            label="Custom mass"
            value={customMass}
            min={0.0001}
            step={0.0001}
            onChange={(value) => setCustomMass(Math.max(0.0001, value ?? firstMass))}
          />
          <NumberSetting
            label="Min intensity (%)"
            value={minRelIntensity}
            min={0}
            max={100}
            step={0.1}
            onChange={(value) => setMinRelIntensity(Math.max(0, Math.min(100, value ?? 1)))}
          />
          <NumberSetting
            label={toleranceUnit === "ppm" ? "Tolerance (ppm)" : "KMD tolerance"}
            value={toleranceValue}
            min={toleranceUnit === "ppm" ? 0.1 : 0.0001}
            max={toleranceUnit === "ppm" ? 200 : 0.5}
            step={toleranceUnit === "ppm" ? 0.5 : 0.001}
            onChange={(value) =>
              setToleranceValue(
                Math.max(toleranceUnit === "ppm" ? 0.1 : 0.0001, value ?? (toleranceUnit === "ppm" ? 20 : 0.01)),
              )
            }
          />
          <SelectSetting
            label="Tolerance unit"
            value={toleranceUnit}
            options={[
              { value: "kmd", label: "Absolute KMD" },
              { value: "ppm", label: "ppm of m/z" },
            ]}
            onChange={(value) => {
              const next = value as "kmd" | "ppm";
              setToleranceUnit(next);
              setToleranceValue(next === "ppm" ? 20 : 0.01);
            }}
          />
          <NumberSetting
            label="Min line points"
            value={minSeriesPoints}
            min={2}
            max={20}
            step={1}
            onChange={(value) => setMinSeriesPoints(Math.max(2, Math.round(value ?? 3)))}
          />
          <SelectSetting
            label="X axis"
            value={xMode}
            options={[
              { value: "mz", label: "m/z" },
              { value: "knm", label: "Kendrick nominal" },
            ]}
            onChange={(value) => setXMode(value as "mz" | "knm")}
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-500">
          <div title="Nominal repeat mass = round(repeat mass). Custom values like 14.5 round up to 15 and silently shift the KMD scale.">
            Repeat {repeatMass.toFixed(6)} Da
            {nominalRepeatMass != null ? `, nominal ${nominalRepeatMass}` : ""}
            {spectrum ? `, ${result.points.length.toLocaleString()} plotted peaks` : ""}
            {result.truncated ? `, capped at ${KENDRICK_POINT_LIMIT.toLocaleString()}` : ""}
          </div>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={labelSeries}
              onChange={(event) => setLabelSeries(event.target.checked)}
            />
            Label series points
          </label>
          <PaperFigureExportToolbar
            disabled={!spectrum || result.points.length === 0}
            storageKey="mfp-publication-plot-export-lcms-kendrick"
            onExport={savePublication}
          />
        </div>
        {!spectrum ? (
          <div className="rounded-md border border-dashed border-ink-200 p-6 text-center text-sm text-ink-500">
            Load an MS1 spectrum first.
          </div>
        ) : result.points.length === 0 ? (
          <div className="rounded-md border border-dashed border-ink-200 p-6 text-center text-sm text-ink-500">
            No peaks passed the current Kendrick filters.
          </div>
        ) : (
          <div className="grid h-[520px] grid-cols-[minmax(0,1fr)_240px] gap-4">
            <div ref={containerRef} className="h-full min-w-0 overflow-hidden rounded-md border border-ink-200">
              <Plot
                revision={plotSize.revision}
                data={[
                  {
                    type: "scattergl",
                    mode: labelSeries ? "text+markers" : "markers",
                    x: xValues,
                    y: result.points.map((point) => point.kmd),
                    text: markerText,
                    textposition: "top center",
                    textfont: { size: 10, color: "#46536a" },
                    marker: {
                      color: markerColors,
                      size: markerSizes,
                      opacity: 0.82,
                      line: { color: "rgba(30,38,54,0.25)", width: 0.5 },
                    },
                    customdata: result.points.map((point) => [
                      point.mz,
                      point.intensity,
                      point.relIntensity,
                      point.kendrickMass,
                      point.kendrickNominalMass,
                      point.seriesId ?? "",
                    ]),
                    hovertemplate:
                      "m/z: %{customdata[0]:.4f}<br>Intensity: %{customdata[1]:.3e}<br>Relative: %{customdata[2]:.1f}%<br>Kendrick mass: %{customdata[3]:.4f}<br>Kendrick nominal: %{customdata[4]}<br>KMD: %{y:.5f}<br>Series: %{customdata[5]}<extra></extra>",
                    name: "KMD",
                  },
                ]}
                layout={{
                  height: plotSize.height,
                  width: plotSize.width,
                  margin: { l: 64, r: 20, t: 20, b: 48 },
                  font: { size: 12 },
                  xaxis: {
                    title: axisTitle(xMode === "knm" ? "Kendrick nominal mass" : "m/z", 13),
                    zeroline: false,
                    showgrid: true,
                  },
                  yaxis: {
                    title: axisTitle("Kendrick mass defect", 13),
                    zeroline: false,
                    showgrid: true,
                  },
                  shapes,
                  colorway: pt.colorway,
                  plot_bgcolor: pt.plot_bgcolor,
                  paper_bgcolor: pt.paper_bgcolor,
                  showlegend: false,
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
            </div>
            <div className="flex min-w-0 flex-col gap-2">
              <div className="label">Detected lines</div>
              <div className="max-h-[460px] overflow-auto rounded-md border border-ink-200">
                <table className="min-w-full divide-y divide-ink-200 text-xs">
                  <thead className="sticky top-0 bg-ink-50 text-left text-ink-600">
                    <tr>
                      <th className="px-2 py-2 font-medium">Line</th>
                      <th className="px-2 py-2 font-medium">KMD</th>
                      <th className="px-2 py-2 font-medium">Peaks</th>
                      <th className="px-2 py-2 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-100 bg-surface">
                    {result.series.length === 0 ? (
                      <tr>
                        <td className="px-2 py-3 text-ink-500" colSpan={4}>
                          No repeated KMD lines at this tolerance.
                        </td>
                      </tr>
                    ) : (
                      result.series.map((series) => (
                        <tr key={series.id}>
                          <td className="px-2 py-1.5 font-medium" style={{ color: pt.colorway[(series.id - 1) % pt.colorway.length] }}>
                            S{series.id}
                          </td>
                          <td className="px-2 py-1.5 font-mono">{series.center.toFixed(5)}</td>
                          <td className="px-2 py-1.5">{series.count}</td>
                          <td className="px-2 py-1.5">
                            <button
                              type="button"
                              className="rounded border border-ink-200 px-2 py-0.5 text-[11px] text-ink-700 hover:bg-ink-100"
                              onClick={() => handleCreateSeriesEic(series.id)}
                              title="Create EICs for the top 5 most-intense peaks in this series"
                            >
                              EIC
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
