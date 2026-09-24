import { useCallback, useMemo, useRef, useState } from "react";
import Plot from "react-plotly.js";
import type { PlotMouseEvent, PlotlyHTMLElement } from "plotly.js";
import { exportColorMeta, themeTraceColor, usePlotlyTheme } from "../../theme/ThemeProvider";
import { PaperFigureExportToolbar } from "../PaperFigureExportToolbar";
import { Tooltip } from "../Tooltip";
import { exportPlotlyPublicationImage, PublicationExportFormat, PublicationExportSettings, publicationFilenameSuffix, sanitizeFilenamePart } from "../../utils/publicationPlotExport";
import { eicSourceFile, type LCMSEICPlot } from "../../lcms/analysis";
import { type ChartSettings, type EICOverlaySettings } from "../../lcms/settings";
import { useContainerSize, usePlotResizePulses, queuePlotlyElementResize, RtUnit, formatRt, axisRange, maxFinite, axisTitle, axisFrame } from "../../lcms/viewShared";

export function EICChart(props: {
  eics: LCMSEICPlot[];
  onClick: (e: Readonly<PlotMouseEvent>) => void;
  onClear: () => void;
  onIntegrate: (plot: LCMSEICPlot) => void;
  onIntegrateAll?: () => void;
  onUndoEic?: () => void;
  onRedoEic?: () => void;
  canUndoEic?: boolean;
  canRedoEic?: boolean;
  clearLabel?: string;
  selectedRt: number | null;
  rtUnit: RtUnit;
  settings: ChartSettings;
  overlaySettings: EICOverlaySettings;
  onOpenDesign?: () => void;
  onReload?: () => void;
}) {
  const [localRevision, setLocalRevision] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<PlotlyHTMLElement | null>(null);
  const plotSize = useContainerSize(containerRef, Math.max(240, props.settings.height * 0.75));
  const pt = usePlotlyTheme();
  const scale = props.rtUnit === "seconds" ? 60 : 1;
  const unit = props.rtUnit === "seconds" ? "s" : "min";
  const isOverlay = props.eics.length > 1;
  const sourceFiles = Array.from(new Set(props.eics.map(eicSourceFile)));
  const sourceLabel = sourceFiles.length === 1 ? sourceFiles[0] : `${sourceFiles.length} files`;
  const eicRevisionKey = props.eics
    .map((plot) => `${plot.id}:${plot.eic.rt_min.length}:${plot.eic.intensity.length}`)
    .join("|");
  const traces = useMemo(
    () => {
      const globalMax = props.eics.reduce(
        (max, plot) => Math.max(max, maxFinite(plot.eic.intensity, 0)),
        0,
      );
      const stackStep =
        props.overlaySettings.normalize || globalMax <= 0
          ? props.overlaySettings.stackGap
          : (globalMax * props.overlaySettings.stackGap) / 100;
      return props.eics.map((plot, index) => {
        const localMax = maxFinite(plot.eic.intensity, 0);
        const baseY =
          props.overlaySettings.normalize && localMax > 0
            ? plot.eic.intensity.map((value) => (value / localMax) * 100)
            : plot.eic.intensity;
        const stackOffset = isOverlay && props.overlaySettings.stack ? index * stackStep : 0;
        const y = stackOffset === 0 ? baseY : baseY.map((value) => value + stackOffset);
        return {
        type: "scattergl" as const,
        mode: "lines" as const,
        x: plot.eic.rt_min.map((v) => v * scale),
        y,
        customdata: plot.eic.intensity,
        opacity: isOverlay ? props.overlaySettings.opacity : 1,
        line: {
          color: isOverlay
            ? (props.settings.overlayColors?.[index] ?? pt.colorway[index % pt.colorway.length] ?? props.settings.color)
            : themeTraceColor(props.settings.color, pt.theme),
          width: props.settings.lineWidth,
        },
        ...(isOverlay ? {} : exportColorMeta(props.settings.color)),
        hovertemplate: `${eicSourceFile(plot)}<br>m/z ${plot.eic.target_mz.toFixed(4)}<br>RT: %{x:.3f} ${unit}<br>Intensity: %{customdata:.3e}<extra></extra>`,
        name: `${isOverlay ? `${eicSourceFile(plot)} ` : ""}m/z ${plot.eic.target_mz.toFixed(4)}`,
      };
      });
    },
    [isOverlay, props.eics, props.overlaySettings, props.settings.color, props.settings.lineWidth, props.settings.overlayColors, pt.colorway, pt.theme, scale, unit],
  );
  const primary = props.eics[0]?.eic ?? null;
  usePlotResizePulses([
    localRevision,
    eicRevisionKey,
    props.eics.length,
    props.overlaySettings.normalize,
    props.overlaySettings.opacity,
    props.overlaySettings.showLegend,
    props.overlaySettings.stack,
    props.overlaySettings.stackGap,
    props.selectedRt,
    props.rtUnit,
    props.settings.axis.xMax,
    props.settings.axis.xMin,
    props.settings.axis.yMax,
    props.settings.axis.yMin,
    props.settings.color,
    props.settings.height,
    props.settings.lineWidth,
    props.settings.overlayColors,
    props.settings.showGrid,
    props.settings.tickSize,
    props.settings.title,
    props.settings.xTitle,
    props.settings.yTitle,
  ], plotRef);
  const shapes =
    props.selectedRt != null
      ? [
          {
            type: "line" as const,
            xref: "x" as const,
            yref: "paper" as const,
            x0: props.selectedRt * scale,
            x1: props.selectedRt * scale,
            y0: 0,
            y1: 1,
            line: { color: "#5573b9", width: 1, dash: "dot" as const },
          },
        ]
      : [];
  const savePublication = useCallback(
    (format: PublicationExportFormat, exportSettings: PublicationExportSettings) => {
      if (!plotRef.current || props.eics.length === 0) return;
      const mzPart = primary ? `mz_${primary.target_mz.toFixed(4)}` : "overlay";
      const base = sanitizeFilenamePart(props.settings.title || `lcms_eic_${mzPart}`, "lcms_eic");
      void exportPlotlyPublicationImage(plotRef.current, {
        format,
        filename: `${base}_${publicationFilenameSuffix(exportSettings, format)}`,
        ...exportSettings,
      }, {
        layoutOverrides: {
          font: { family: "Arial, Helvetica, sans-serif", size: 9, color: "#111827" },
          margin: { l: 58, r: 18, t: props.settings.title ? 28 : 12, b: 46 },
        },
      });
    },
    [primary, props.eics.length, props.settings.title],
  );
  return (
    <div className="card flex min-w-0 shrink-0 flex-col overflow-hidden p-3">
      {/* Tier 1: Title & Status Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-1 pb-1.5 min-h-[28px]">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <h3 className="text-sm font-semibold text-ink-900 flex items-center gap-1.5 whitespace-nowrap">
            <span>🎯</span>
            <span>
              {props.eics.length === 1 && primary
                ? `EIC m/z ${primary.target_mz.toFixed(4)} ± ${primary.tolerance.toFixed(4)}`
                : `EIC Overlay (${props.eics.length} traces)`}
            </span>
          </h3>
          <span className="max-w-[240px] truncate rounded-md bg-ink-100 px-2 py-0.5 font-mono text-xs text-ink-700" title={sourceFiles.join(", ")}>
            {sourceLabel}
          </span>
          {primary && (
            <span className="rounded-md bg-ink-100 px-2 py-0.5 text-xs text-ink-600 whitespace-nowrap">
              {props.eics.length === 1
                ? `${primary.n_scans} scans`
                : `${props.eics.length} traces${props.overlaySettings.normalize ? ", norm" : ""}${props.overlaySettings.stack ? ", stacked" : ""}`}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {props.selectedRt != null && (
            <span className="rounded-full border border-brand-200 bg-brand-50 px-2.5 py-0.5 text-xs font-semibold text-brand-700 shadow-xs whitespace-nowrap">
              RT {formatRt(props.selectedRt, props.rtUnit)}
            </span>
          )}
        </div>
      </div>

      {/* Tier 2: Action Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ink-100/80 px-1 py-1.5">
        {/* Left Cluster: Integration & Clear tools */}
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            className="flex items-center gap-1 rounded-md border border-brand-300 bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-700 transition-colors hover:bg-brand-100 shadow-xs whitespace-nowrap"
            onClick={() =>
              props.onIntegrateAll && props.eics.length > 1
                ? props.onIntegrateAll()
                : props.eics.forEach((plot) => props.onIntegrate(plot))
            }
          >
            <span>∫</span>
            <span>{props.eics.length > 1 ? "Integrate all" : "Integrate"}</span>
          </button>
          <button
            type="button"
            className="rounded-md border border-ink-200 bg-surface px-2.5 py-1 text-xs text-ink-700 transition-colors hover:bg-ink-50 shadow-xs whitespace-nowrap"
            onClick={props.onClear}
          >
            ✕ {props.clearLabel ?? "Clear"}
          </button>
          {props.onUndoEic && (
            <div className="flex items-center gap-1">
              <Tooltip content="Undo EIC action (Ctrl+Z)" placement="bottom">
                <button
                  type="button"
                  className="rounded border border-ink-200 bg-surface px-2 py-1 text-xs text-ink-600 hover:bg-ink-50 disabled:opacity-30 shadow-xs"
                  disabled={!props.canUndoEic}
                  onClick={(e) => {
                    e.stopPropagation();
                    props.onUndoEic?.();
                  }}
                  title="Undo EIC (Ctrl+Z)"
                >
                  ↩
                </button>
              </Tooltip>
              <Tooltip content="Redo EIC action (Ctrl+Y)" placement="bottom">
                <button
                  type="button"
                  className="rounded border border-ink-200 bg-surface px-2 py-1 text-xs text-ink-600 hover:bg-ink-50 disabled:opacity-30 shadow-xs"
                  disabled={!props.canRedoEic}
                  onClick={(e) => {
                    e.stopPropagation();
                    props.onRedoEic?.();
                  }}
                  title="Redo EIC (Ctrl+Y)"
                >
                  ↪
                </button>
              </Tooltip>
            </div>
          )}
        </div>

        {/* Right Cluster: Standard actions */}
        <div className="flex items-center gap-1.5 shrink-0">
          {props.onOpenDesign && (
            <button
              type="button"
              className="flex items-center gap-1 rounded-md border border-ink-200 bg-surface px-2.5 py-1 text-xs font-medium text-ink-700 transition-colors hover:bg-ink-50 shadow-xs whitespace-nowrap"
              onClick={props.onOpenDesign}
              title="Configure EIC appearance, colors & overlay options"
            >
              <span>🎨</span>
              <span>Design</span>
            </button>
          )}
          {props.onReload && (
            <button
              type="button"
              className="flex items-center gap-1 rounded-md border border-ink-200 bg-surface px-2.5 py-1 text-xs font-medium text-ink-700 transition-colors hover:bg-ink-50 shadow-xs whitespace-nowrap"
              onClick={() => {
                setLocalRevision((r) => r + 1);
                props.onReload?.();
              }}
              title="Reload EIC plot"
            >
              <span>🔄</span>
              <span>Reload</span>
            </button>
          )}
          <PaperFigureExportToolbar
            disabled={props.eics.length === 0}
            storageKey="mfp-publication-plot-export-lcms-eic"
            onExport={savePublication}
          />
        </div>
      </div>
      <div
        ref={containerRef}
        className="min-w-0 overflow-hidden"
        style={{ height: Math.max(240, props.settings.height * 0.75) }}
      >
        <Plot
          revision={plotSize.revision + localRevision}
          data={traces}
          layout={{
            height: plotSize.height,
            width: plotSize.width,
            margin: { l: 65, r: 20, t: props.settings.title ? 28 : 15, b: 45 },
            title: props.settings.title
              ? { text: props.settings.title, font: { size: props.settings.titleSize } }
              : undefined,
            font: { size: props.settings.tickSize, color: pt.screenFontColor },
            xaxis: {
              title: axisTitle(`${props.settings.xTitle} (${unit})`, props.settings.axisTitleSize),
              zeroline: false,
              showgrid: props.settings.showGrid,
              range: axisRange(props.settings.axis.xMin, props.settings.axis.xMax),
              tickfont: { size: props.settings.tickSize },
              ...axisFrame(props.settings),
            },
            yaxis: {
              title: axisTitle(
                props.overlaySettings.normalize ? "Normalized EIC (%)" : props.settings.yTitle,
                props.settings.axisTitleSize,
              ),
              zeroline: false,
              exponentformat: "power",
              showgrid: props.settings.showGrid,
              range: axisRange(props.settings.axis.yMin, props.settings.axis.yMax),
              tickfont: { size: props.settings.tickSize },
              ...axisFrame(props.settings),
            },
            hovermode: "x",
            colorway: pt.colorway,
            plot_bgcolor: pt.plot_bgcolor,
            paper_bgcolor: pt.paper_bgcolor,
            showlegend: isOverlay && props.overlaySettings.showLegend,
            shapes,
          }}
          config={{ responsive: true, displaylogo: false }}
          style={{ width: "100%", height: "100%", minWidth: 0 }}
          useResizeHandler
          onClick={props.onClick}
          onInitialized={(_figure, graphDiv) => {
            plotRef.current = graphDiv as PlotlyHTMLElement;
            queuePlotlyElementResize(plotRef.current);
          }}
          onUpdate={(_figure, graphDiv) => {
            plotRef.current = graphDiv as PlotlyHTMLElement;
          }}
        />
      </div>
    </div>
  );
}
