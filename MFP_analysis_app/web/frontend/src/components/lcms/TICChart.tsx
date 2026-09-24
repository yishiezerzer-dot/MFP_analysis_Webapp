import { useCallback, useMemo, useRef, useState } from "react";
import Plot from "react-plotly.js";
import type { PlotMouseEvent, PlotSelectionEvent, PlotlyHTMLElement } from "plotly.js";
import clsx from "clsx";
import { LCMSTICOverlayTrace, TICData } from "../../api";
import { exportColorMeta, themeTraceColor, usePlotlyTheme } from "../../theme/ThemeProvider";
import { PaperFigureExportToolbar } from "../PaperFigureExportToolbar";
import { Tooltip } from "../Tooltip";
import { exportPlotlyPublicationImage, PublicationExportFormat, PublicationExportSettings, publicationFilenameSuffix, sanitizeFilenamePart } from "../../utils/publicationPlotExport";
import { type IntegratedTraceRegion } from "../../lcms/analysis";
import { OVERLAY_PALETTE, type ChartSettings, type ChromatogramOverlayMode } from "../../lcms/settings";
import { SegmentedControl } from "../common/SegmentedControl";
import { Crosshair, Keyboard, Link2, Palette, Redo2, RotateCw, Scissors, Undo2 } from "lucide-react";
import { schedulePlotResize, useContainerSize, usePlotResizePulses, queuePlotlyElementResize, RtUnit, formatRt, formatScanId, axisRange, maxFinite, axisTitle, axisFrame, ChartCardTitle, ICON_PROPS, ToolbarButton } from "../../lcms/viewShared";

export function TICChart(props: {
  tic: TICData | null;
  overlayTraces: LCMSTICOverlayTrace[];
  activeSid?: string | null;
  activeDisplayName?: string | null;
  onClick: (e: Readonly<PlotMouseEvent>) => void;
  onRegionSelected?: (rtMin: number, rtMax: number) => void;
  onUndoRegion?: () => void;
  onRedoRegion?: () => void;
  canUndoRegion?: boolean;
  canRedoRegion?: boolean;
  selectedRt: number | null;
  selectedRegion?: { rtMin: number; rtMax: number } | null;
  regionIntegration?: IntegratedTraceRegion | null;
  selectedScanId?: string | null;
  rtUnit: RtUnit;
  regionSelect: boolean;
  onToggleRegionSelect?: (val: boolean) => void;
  settings: ChartSettings;
  onOpenDesign?: () => void;
  onReload?: () => void;
  onUpdateOverlayMode?: (mode: ChromatogramOverlayMode) => void;
  syncZoom?: boolean;
  onToggleSyncZoom?: () => void;
  syncedRtRange?: [number, number] | null;
  onZoomChange?: (range: [number, number] | null) => void;
  title?: string;
  polarityBadge?: "ESI+" | "ESI-" | string;
  colorOverride?: string;
  emptyMessage?: string;
}) {
  const [localRevision, setLocalRevision] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<PlotlyHTMLElement | null>(null);
  const plotSize = useContainerSize(containerRef, props.settings.height);

  const nonActiveOverlayTraces = useMemo(
    () => props.overlayTraces.filter((trace) => !props.activeSid || trace.session_id !== props.activeSid),
    [props.activeSid, props.overlayTraces],
  );
  const overlayMode: ChromatogramOverlayMode =
    props.settings.overlaySettings?.mode === "normalized" || props.settings.overlaySettings?.chromatogramMode === "normalized"
      ? "normalized"
      : props.settings.overlaySettings?.mode === "stacked" || props.settings.overlaySettings?.chromatogramMode === "stacked"
      ? "stacked"
      : "raw";
  const stackGap = props.settings.overlaySettings?.stackGap ?? props.settings.overlaySettings?.stackingGapPercent ?? 15;
  const traceOpacity = props.settings.overlaySettings?.opacity ?? props.settings.overlaySettings?.traceOpacity ?? 0.85;

  usePlotResizePulses([
    localRevision,
    props.regionSelect,
    props.selectedRt,
    props.selectedRegion?.rtMin,
    props.selectedRegion?.rtMax,
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
    props.tic?.rt_min.length,
    props.tic?.tic.length,
    nonActiveOverlayTraces.length,
    props.rtUnit,
    overlayMode,
    stackGap,
    traceOpacity,
  ], plotRef);
  const pt = usePlotlyTheme();
  const scale = props.rtUnit === "seconds" ? 60 : 1;
  const unit = props.rtUnit === "seconds" ? "s" : "min";
  const xs = useMemo(
    () => (props.tic ? props.tic.rt_min.map((v) => v * scale) : []),
    [props.tic, scale],
  );

  const { activeY, overlaySeries } = useMemo(() => {
    if (!props.tic) return { activeY: [] as number[], overlaySeries: [] };
    const activeMax = maxFinite(props.tic.tic, 0);

    if (overlayMode === "normalized" || overlayMode === "stacked") {
      const normActiveY = activeMax > 0 ? props.tic.tic.map((v) => (v / activeMax) * 100) : props.tic.tic;
      const series = nonActiveOverlayTraces.map((trace, index) => {
        const traceMax = maxFinite(trace.tic, 0);
        const normBaseY = traceMax > 0 ? trace.tic.map((v) => (v / traceMax) * 100) : trace.tic;
        const stackOffset = overlayMode === "stacked" ? (index + 1) * (100 + stackGap) : 0;
        const y = stackOffset === 0 ? normBaseY : normBaseY.map((v) => v + stackOffset);
        return {
          trace,
          y,
          customdata: trace.tic,
        };
      });
      return { activeY: normActiveY, overlaySeries: series };
    }

    return {
      activeY: props.tic.tic,
      overlaySeries: nonActiveOverlayTraces.map((trace) => ({
        trace,
        y: trace.tic,
        customdata: trace.tic,
      })),
    };
  }, [nonActiveOverlayTraces, overlayMode, props.tic, stackGap]);

  const overlayData = useMemo(
    () =>
      overlaySeries.map(({ trace, y, customdata }, index) => ({
        type: "scattergl" as const,
        mode: "lines" as const,
        x: trace.rt_min.map((v) => v * scale),
        y,
        customdata,
        opacity: traceOpacity,
        line: {
          color:
            props.settings.overlayColorsBySessionId?.[trace.session_id] ??
            props.settings.overlayColors?.[index] ??
            OVERLAY_PALETTE[index % OVERLAY_PALETTE.length],
          width: Math.max(1, props.settings.lineWidth * 0.9),
        },
        hovertemplate:
          overlayMode === "raw"
            ? `${trace.display_name}<br>RT: %{x:.3f} ${unit}<br>TIC: %{y:.3e}<extra></extra>`
            : `${trace.display_name}<br>RT: %{x:.3f} ${unit}<br>Rel: %{y:.1f}%<br>TIC: %{customdata:.3e}<extra></extra>`,
        name: trace.display_name,
      })),
    [overlayMode, overlaySeries, props.settings.lineWidth, props.settings.overlayColors, props.settings.overlayColorsBySessionId, scale, traceOpacity, unit],
  );

  const emitSelectedRtRegion = useCallback(
    (x0: unknown, x1: unknown) => {
      if (!props.onRegionSelected) return;
      const start = Number(x0);
      const end = Number(x1);
      if (!Number.isFinite(start) || !Number.isFinite(end) || start === end) return;
      const toMin = 1 / scale;
      props.onRegionSelected(Math.min(start, end) * toMin, Math.max(start, end) * toMin);
    },
    [props.onRegionSelected, scale],
  );

  const handleSelected = (event: Readonly<PlotSelectionEvent>) => {
    const xRange = event.range?.x;
    if (xRange && xRange.length >= 2) {
      emitSelectedRtRegion(xRange[0], xRange[1]);
      return;
    }
    const pointXs = event.points
      ?.map((point) => Number(point.x))
      .filter((value) => Number.isFinite(value));
    if (pointXs && pointXs.length >= 2) {
      emitSelectedRtRegion(Math.min(...pointXs), Math.max(...pointXs));
    }
  };

  const handleRelayout = (event: Readonly<Record<string, unknown>>) => {
    if (props.onZoomChange) {
      const x0 = event["xaxis.range[0]"];
      const x1 = event["xaxis.range[1]"];
      if (x0 != null && x1 != null) {
        props.onZoomChange([Number(x0) / scale, Number(x1) / scale]);
      } else if (event["xaxis.autorange"] === true) {
        props.onZoomChange(null);
      }
    }
    if (!props.regionSelect) return;
    const selections = event.selections;
    const lastSelection =
      Array.isArray(selections) && selections.length > 0
        ? (selections[selections.length - 1] as Record<string, unknown>)
        : null;
    emitSelectedRtRegion(
      lastSelection?.x0 ?? event["selections[0].x0"],
      lastSelection?.x1 ?? event["selections[0].x1"],
    );
  };
  const shapes: object[] = [];
  if (props.selectedRt != null) {
    shapes.push({
      type: "line",
      xref: "x",
      yref: "paper",
      x0: props.selectedRt * scale,
      x1: props.selectedRt * scale,
      y0: 0,
      y1: 1,
      line: { color: "#5573b9", width: 1, dash: "dot" },
    });
  }
  if (props.regionSelect && props.selectedRegion != null) {
    shapes.push({
      type: "rect",
      xref: "x",
      yref: "paper",
      x0: props.selectedRegion.rtMin * scale,
      x1: props.selectedRegion.rtMax * scale,
      y0: 0,
      y1: 1,
      fillcolor: "rgba(85,115,185,0.12)",
      line: { color: "rgba(85,115,185,0.45)", width: 1 },
    });
  }
  const savePublication = useCallback(
    (format: PublicationExportFormat, exportSettings: PublicationExportSettings) => {
      if (!plotRef.current || !props.tic) return;
      const base = sanitizeFilenamePart(props.title || props.settings.title || "lcms_tic", "lcms_tic");
      const is1to1 = exportSettings.isCurrentView;
      void exportPlotlyPublicationImage(plotRef.current, {
        format,
        filename: `${base}_tic_${publicationFilenameSuffix(exportSettings, format)}`,
        ...exportSettings,
      }, {
        layoutOverrides: is1to1
          ? {
              margin: {
                l: Math.max(68, props.settings.title ? 28 : 12),
                r: 18,
                t: props.settings.title ? 28 : 12,
                b: 46,
              },
            }
          : {
              font: { family: "Arial, Helvetica, sans-serif", size: 9, color: "#111827" },
              margin: { l: 68, r: 18, t: props.settings.title ? 28 : 12, b: 46 },
            },
      });
    },
    [props.settings.title, props.tic],
  );
  return (
    <div className="card flex min-w-0 shrink-0 flex-col overflow-hidden p-3">
      {/* Tier 1: Title & Status Bar */}
      <div className="px-1 pb-1.5">
        <ChartCardTitle
          title={props.title ?? "Total Ion Chromatogram"}
          status={[
            props.polarityBadge,
            props.tic && `${props.tic.rt_min.length.toLocaleString()} points`,
            nonActiveOverlayTraces.length > 0 &&
              `${nonActiveOverlayTraces.length} overlay${nonActiveOverlayTraces.length === 1 ? "" : "s"}`,
            props.regionSelect && props.selectedRegion != null
              ? `Region ${formatRt(props.selectedRegion.rtMin, props.rtUnit)} – ${formatRt(props.selectedRegion.rtMax, props.rtUnit)}`
              : props.selectedRt != null &&
                `RT ${formatRt(props.selectedRt, props.rtUnit)}${props.selectedScanId ? ` · Scan ${formatScanId(props.selectedScanId)}` : ""}`,
            props.regionSelect ? "drag across a peak to slice & integrate" : "click to load a spectrum",
          ]}
        />
      </div>

      {/* Tier 2: Action Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ink-100/80 px-1 py-1.5">
        {/* Left Cluster: Inspection / Slicing and Integration tools */}
        <div className="flex flex-wrap items-center gap-2">
          {props.onToggleRegionSelect && (
            <SegmentedControl
              size="xs"
              value={props.regionSelect ? "slice" : "point"}
              onChange={(val) => props.onToggleRegionSelect?.(val === "slice")}
              options={[
                { value: "point", label: "Inspect peak", icon: <Crosshair {...ICON_PROPS} />, title: "Inspect scan at clicked RT point" },
                { value: "slice", label: "Slice peak", icon: <Scissors {...ICON_PROPS} />, title: "Click and drag across a peak to slice & integrate" },
              ]}
            />
          )}

          {props.regionSelect && (
            <div className="flex items-center gap-1">
              <Tooltip content="Undo region slice (Ctrl+Z)" placement="bottom">
                <button
                  type="button"
                  className="btn-ghost px-1.5 py-1 disabled:opacity-30"
                  disabled={!props.canUndoRegion}
                  onClick={(e) => {
                    e.stopPropagation();
                    props.onUndoRegion?.();
                  }}
                  title="Undo region slice (Ctrl+Z)"
                  aria-label="Undo region slice"
                >
                  <Undo2 {...ICON_PROPS} />
                </button>
              </Tooltip>
              <Tooltip content="Redo region slice (Ctrl+Y)" placement="bottom">
                <button
                  type="button"
                  className="btn-ghost px-1.5 py-1 disabled:opacity-30"
                  disabled={!props.canRedoRegion}
                  onClick={(e) => {
                    e.stopPropagation();
                    props.onRedoRegion?.();
                  }}
                  title="Redo region slice (Ctrl+Y)"
                  aria-label="Redo region slice"
                >
                  <Redo2 {...ICON_PROPS} />
                </button>
              </Tooltip>
            </div>
          )}

          {props.regionIntegration && (
            <span
              className="badge-green font-mono whitespace-nowrap"
              title={`Integrated Area: ${props.regionIntegration.area.toExponential(4)} | Apex: ${props.regionIntegration.rtApex.toFixed(3)} min | Height: ${props.regionIntegration.height.toExponential(3)}`}
            >
              Area: {props.regionIntegration.area.toExponential(2)} counts·min (Apex {props.regionIntegration.rtApex.toFixed(3)} min, Δ {(props.regionIntegration.width).toFixed(3)} min)
            </span>
          )}
        </div>

        {/* Right Cluster: Standard actions */}
        <div className="flex items-center gap-1.5 shrink-0">
          {nonActiveOverlayTraces.length > 0 && props.onUpdateOverlayMode && (
            <SegmentedControl
              size="xs"
              ariaLabel="Overlay scale"
              value={overlayMode}
              onChange={(mode) => props.onUpdateOverlayMode?.(mode)}
              options={[
                { value: "raw", label: "Raw", title: "Overlay on shared absolute scale" },
                { value: "normalized", label: "% Norm", title: "Normalize each trace to 0–100% base peak" },
                { value: "stacked", label: "Stacked", title: "Waterfall stacked chromatograms" },
              ]}
            />
          )}
          {props.onToggleSyncZoom && (
            <ToolbarButton
              icon={Link2}
              label={props.syncZoom ? "Zoom synced" : "Sync zoom"}
              active={props.syncZoom}
              onClick={props.onToggleSyncZoom}
              title="Synchronize X-axis zoom & pan between TIC and UV chromatograms"
            />
          )}
          <span className="text-caption hidden items-center gap-1 whitespace-nowrap 2xl:flex">
            <Keyboard {...ICON_PROPS} />
            ←/→ scans · B overlay · Esc reset
          </span>
          {props.onOpenDesign && (
            <ToolbarButton icon={Palette} label="Design" onClick={props.onOpenDesign} title="Configure TIC appearance, colors & limits" />
          )}
          {props.onReload && (
            <ToolbarButton
              icon={RotateCw}
              label="Reload"
              title="Reload TIC plot"
              onClick={() => {
                setLocalRevision((r) => r + 1);
                props.onReload?.();
              }}
            />
          )}
          <PaperFigureExportToolbar
            disabled={!props.tic}
            storageKey="mfp-publication-plot-export-lcms-tic"
            currentSizePx={{ width: plotSize.width, height: plotSize.height }}
            onExport={savePublication}
          />
        </div>
      </div>
      {!props.tic || props.tic.rt_min.length === 0 ? (
        <div className="flex h-72 items-center justify-center text-sm text-ink-500">
          {props.emptyMessage ?? (!props.tic ? "Loading TIC…" : "No chromatogram data available.")}
        </div>
      ) : (
        <div
          ref={containerRef}
          className="min-w-0 overflow-hidden"
          style={{ height: props.settings.height }}
        >
          <Plot
            revision={plotSize.revision + localRevision}
            data={[
              {
                type: props.regionSelect ? "scatter" : "scattergl",
                mode: "lines",
                x: xs,
                y: activeY,
                customdata: props.tic.tic,
                line: {
                  color: props.colorOverride ?? themeTraceColor(props.settings.color, pt.theme),
                  width: props.settings.lineWidth,
                },
                ...exportColorMeta(props.colorOverride ?? props.settings.color),
                hovertemplate:
                  overlayMode === "raw"
                    ? `RT: %{x:.3f} ${unit}<br>TIC: %{y:.3e}<extra></extra>`
                    : `RT: %{x:.3f} ${unit}<br>Rel: %{y:.1f}%<br>TIC: %{customdata:.3e}<extra></extra>`,
                name: props.activeDisplayName ? `${props.activeDisplayName} (Active)` : "TIC",
              },
              ...overlayData,
            ]}
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
                range: props.syncedRtRange
                  ? [props.syncedRtRange[0] * scale, props.syncedRtRange[1] * scale]
                  : axisRange(props.settings.axis.xMin, props.settings.axis.xMax),
                tickfont: { size: props.settings.tickSize },
                ...axisFrame(props.settings),
              },
              yaxis: {
                title: axisTitle(
                  props.settings.yTitle ||
                    (overlayMode === "normalized"
                      ? "TIC (% Base Peak)"
                      : overlayMode === "stacked"
                      ? "Stacked (% Base Peak)"
                      : "TIC"),
                  props.settings.axisTitleSize,
                ),
                zeroline: false,
                exponentformat: "power",
                showgrid: props.settings.showGrid,
                range:
                  overlayMode === "raw"
                    ? axisRange(props.settings.axis.yMin, props.settings.axis.yMax)
                    : props.settings.axis.yMin != null || props.settings.axis.yMax != null
                    ? axisRange(props.settings.axis.yMin, props.settings.axis.yMax)
                    : undefined,
                tickfont: { size: props.settings.tickSize },
                ...axisFrame(props.settings),
              },
              hovermode: "x",
              colorway: pt.colorway,
              plot_bgcolor: pt.plot_bgcolor,
              paper_bgcolor: pt.paper_bgcolor,
              showlegend: overlayData.length > 0,
              shapes,
              dragmode: props.regionSelect ? "select" : "zoom",
              selectdirection: props.regionSelect ? "h" : undefined,
            }}
            config={{ responsive: true, displaylogo: false }}
            style={{ width: "100%", height: "100%", minWidth: 0 }}
            useResizeHandler
            onClick={props.regionSelect ? undefined : props.onClick}
            onSelected={handleSelected}
            onRelayout={(event) => handleRelayout(event as Readonly<Record<string, unknown>>)}
            onInitialized={(_figure, graphDiv) => {
              plotRef.current = graphDiv as PlotlyHTMLElement;
              schedulePlotResize();
              queuePlotlyElementResize(plotRef.current);
            }}
            onUpdate={(_figure, graphDiv) => {
              plotRef.current = graphDiv as PlotlyHTMLElement;
            }}
          />
        </div>
      )}
    </div>
  );
}
