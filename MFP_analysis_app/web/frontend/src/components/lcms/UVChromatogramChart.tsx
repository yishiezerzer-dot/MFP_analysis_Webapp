import { useEffect, useMemo, useRef, useState } from "react";
import Plot from "react-plotly.js";
import type { PlotMouseEvent, PlotlyHTMLElement } from "plotly.js";
import clsx from "clsx";
import { UVChromatogramResponse } from "../../api";
import { exportColorMeta, themeTraceColor, usePlotlyTheme } from "../../theme/ThemeProvider";
import { PaperFigureExportToolbar } from "../PaperFigureExportToolbar";
import { exportPlotlyPublicationImage, PublicationExportFormat, PublicationExportSettings, publicationFilenameSuffix, sanitizeFilenamePart } from "../../utils/publicationPlotExport";
import { DEFAULT_OVERLAY_LABEL_SETTINGS, OVERLAY_PALETTE, type ChartSettings, type ChromatogramOverlayMode } from "../../lcms/settings";
import { ArrowDownWideNarrow, FileUp, Link2, MapPin, Palette, Plus, RotateCw, Sparkles, Tags, Unlink } from "lucide-react";
import { SegmentedControl } from "../common/SegmentedControl";
import { schedulePlotResize, useContainerSize, usePlotResizePulses, queuePlotlyElementResize, RtUnit, UVLabelOrientation, UVTextLabel, LCMSUVOverlayChartTrace, cleanLabelText, UvPlotShape, buildBunchedAnnotations, withAlpha, formatRt, formatScanId, axisRange, maxFinite, axisTitle, axisFrame, ChartCardTitle, ICON_PROPS, ToolbarButton } from "../../lcms/viewShared";
import { hexToRgba } from "./SpectrumChart";

export function UVChromatogramChart(props: {
  uv: UVChromatogramResponse | null;
  overlayTraces: LCMSUVOverlayChartTrace[];
  busy: boolean;
  xOffset: number;
  selectedUvRt: number | null;
  selectedScanId?: string | null;
  labels: UVTextLabel[];
  showOverlayLabels?: boolean;
  rtUnit: RtUnit;
  onPickFile: () => void;
  onRemove: () => void;
  onClick: (e: Readonly<PlotMouseEvent>) => void;
  onClearLabels: () => void;
  onDeleteLabel: (id: string) => void;
  onEditLabel: (label: UVTextLabel) => void;
  onMoveLabel: (id: string, patch: Partial<UVTextLabel>) => void;
  bunchLabels: boolean;
  bunchOffsets: Record<string, { ax: number; ay: number }>;
  bunchHubOffset: number;
  labelOrientation: UVLabelOrientation;
  settings: ChartSettings;
  onOpenDesign?: () => void;
  onReload?: () => void;
  onUpdateOverlayMode?: (mode: ChromatogramOverlayMode) => void;
  onAutoLabelUV?: () => void;
  onLabelSelectedRT?: () => void;
  onCustomUvLabel?: () => void;
  onAutoArrangeLabels?: () => void;
  uvProminence?: number;
  setUvProminence?: (v: number) => void;
  uvMinDistance?: number;
  setUvMinDistance?: (v: number) => void;
  transferMsToUv?: boolean;
  setTransferMsToUv?: (v: boolean) => void;
  uvTransferCount?: number;
  setUvTransferCount?: (v: number) => void;
  snapUvLabels?: boolean;
  setSnapUvLabels?: (v: boolean) => void;
  setUvLabelOrientation?: (v: UVLabelOrientation) => void;
  setUvBunchLabels?: (v: boolean) => void;
  setUvBunchHubOffset?: (v: number) => void;
  uvLabelStairXStep?: number;
  setUvLabelStairXStep?: (v: number) => void;
  uvLabelStairYStep?: number;
  setUvLabelStairYStep?: (v: number) => void;
  uvOffsetText?: string;
  setUvOffsetText?: (v: string) => void;
  onApplyOffset?: () => void;
  autoAlignUv?: boolean;
  setAutoAlignUv?: (v: boolean) => void;
  onAutoAlignUV?: () => void;
  syncZoom?: boolean;
  onToggleSyncZoom?: () => void;
  syncedRtRange?: [number, number] | null;
  onZoomChange?: (range: [number, number] | null) => void;
}) {
  const [localRevision, setLocalRevision] = useState(0);
  const {
    uv,
    overlayTraces,
    busy,
    xOffset,
    selectedUvRt,
    labels,
    rtUnit,
    onPickFile,
    onRemove,
    onClick,
    onClearLabels,
    onDeleteLabel,
    onEditLabel,
    onMoveLabel,
    bunchLabels,
    bunchOffsets,
    bunchHubOffset,
    labelOrientation,
    settings,
  } = props;
  const [showLabelOptions, setShowLabelOptions] = useState(false);
  const pt = usePlotlyTheme();
  const available = uv?.available === true;
  const canPlot = available || overlayTraces.length > 0;
  const meta = available ? uv.meta : null;
  const scale = rtUnit === "seconds" ? 60 : 1;
  const unit = rtUnit === "seconds" ? "s" : "min";
  const uvContainerRef = useRef<HTMLDivElement>(null);
  const uvPlotRef = useRef<PlotlyHTMLElement | null>(null);
  const uvPlotSize = useContainerSize(uvContainerRef, settings.height);
  const connectorColor = settings.annotationConnectorColor ?? "#334155";
  const connectorOpacity = Math.min(1, Math.max(0, settings.annotationConnectorOpacity ?? 0.7));
  const connectorArrowColor = withAlpha(connectorColor, connectorOpacity);

  const overlayMode: ChromatogramOverlayMode =
    settings.overlaySettings?.mode === "normalized" || settings.overlaySettings?.chromatogramMode === "normalized"
      ? "normalized"
      : settings.overlaySettings?.mode === "stacked" || settings.overlaySettings?.chromatogramMode === "stacked"
      ? "stacked"
      : "raw";
  const stackGap = settings.overlaySettings?.stackGap ?? settings.overlaySettings?.stackingGapPercent ?? 15;
  const traceOpacity = settings.overlaySettings?.opacity ?? settings.overlaySettings?.traceOpacity ?? 0.85;

  const xs = available ? uv.rt_min.map((v) => (v + xOffset) * scale) : [];

  const { activeY, overlaySeries } = useMemo(() => {
    const rawActive = available ? uv.signal : [];
    const activeMax = maxFinite(rawActive, 0);

    if (overlayMode === "normalized" || overlayMode === "stacked") {
      const normActiveY = activeMax > 0 ? rawActive.map((v) => (v / activeMax) * 100) : rawActive;
      const series = overlayTraces.map((trace, index) => {
        const traceMax = maxFinite(trace.uv.signal, 0);
        const normBaseY = traceMax > 0 ? trace.uv.signal.map((v) => (v / traceMax) * 100) : trace.uv.signal;
        const stackOffset = overlayMode === "stacked" ? (index + 1) * (100 + stackGap) : 0;
        const y = stackOffset === 0 ? normBaseY : normBaseY.map((v) => v + stackOffset);
        return {
          trace,
          y,
          traceMax,
          stackOffset,
          customdata: trace.uv.signal,
        };
      });
      return { activeY: normActiveY, overlaySeries: series };
    }

    return {
      activeY: rawActive,
      overlaySeries: overlayTraces.map((trace) => ({
        trace,
        y: trace.uv.signal,
        traceMax: 0,
        stackOffset: 0,
        customdata: trace.uv.signal,
      })),
    };
  }, [available, overlayMode, overlayTraces, stackGap, uv && uv.available ? uv.signal : undefined]);

  const overlayData = useMemo(
    () =>
      overlaySeries.map(({ trace, y, customdata }, index) => {
        const traceOffset = trace.offset ?? 0;
        return {
          type: "scattergl" as const,
          mode: "lines" as const,
          x: trace.uv.rt_min.map((v) => (v + traceOffset) * scale),
          y,
          customdata,
          opacity: traceOpacity,
          line: {
            color:
              settings.overlayColorsBySessionId?.[trace.session_id] ??
              settings.overlayColors?.[index] ??
              OVERLAY_PALETTE[index % OVERLAY_PALETTE.length],
            width: Math.max(1, settings.lineWidth * 0.9),
          },
          hovertemplate:
            overlayMode === "raw"
              ? `${trace.display_name}<br>RT: %{x:.3f} ${unit}<br>Signal: %{y:.3e}<extra></extra>`
              : `${trace.display_name}<br>RT: %{x:.3f} ${unit}<br>Rel: %{y:.1f}%<br>Signal: %{customdata:.3e}<extra></extra>`,
          name: trace.display_name,
        };
      }),
    [overlayMode, overlaySeries, scale, settings.lineWidth, settings.overlayColors, settings.overlayColorsBySessionId, traceOpacity, unit],
  );
  const overlayLabelCount = useMemo(
    () => overlayTraces.reduce((count, trace) => count + trace.labels.length, 0),
    [overlayTraces],
  );
  const overlayAnnotations = useMemo(
    () => {
      if (!props.showOverlayLabels) return [];
      const overlayLabelCfg = settings.overlayLabels ?? DEFAULT_OVERLAY_LABEL_SETTINGS;
      if (overlayLabelCfg.enabled === false) return [];

      const effOrientation = overlayLabelCfg.orientation ?? labelOrientation;
      const isVertical = effOrientation === "vertical";
      const showBox = overlayLabelCfg.showBox ?? true;
      const showArrow = overlayLabelCfg.showArrow ?? true;
      const fontSize = overlayLabelCfg.fontSize ?? Math.max(8, settings.labels.fontSize - 1);

      return overlaySeries.flatMap(({ trace, traceMax, stackOffset }, traceIndex) => {
        const traceOffset = trace.offset ?? 0;
        const traceColor =
          settings.overlayColorsBySessionId?.[trace.session_id] ??
          settings.overlayColors?.[traceIndex] ??
          OVERLAY_PALETTE[traceIndex % OVERLAY_PALETTE.length];
        const labelColor =
          overlayLabelCfg.colorsBySessionId?.[trace.session_id] ??
          (overlayLabelCfg.useTraceColor ? traceColor : overlayLabelCfg.color || traceColor);

        return trace.labels.map((label, labelIndex) => {
          const stackShift = -14 * (traceIndex + 1);
          const fallbackAy =
            isVertical ? -78 - labelIndex * 26 : -42 - labelIndex * 22;
          const ay = label.ay ?? fallbackAy;
          const labelY =
            (overlayMode === "normalized" || overlayMode === "stacked") && traceMax > 0
              ? (label.signal / traceMax) * 100 + stackOffset
              : label.signal;
          return {
            x: (label.uv_rt_min + traceOffset) * scale,
            y: labelY,
            text: cleanLabelText(label.text),
            textangle: isVertical ? ("-90" as const) : ("0" as const),
            showarrow: showArrow,
            arrowhead: 2,
            arrowsize: 0.8,
            arrowwidth: 1,
            arrowcolor: labelColor,
            ax: label.ax ?? 0,
            axref: label.axRef === "x" ? ("x" as const) : ("pixel" as const),
            ayref: label.ayRef === "y" ? ("y" as const) : ("pixel" as const),
            ay: label.ayRef === "y" ? ay : ay + stackShift,
            bgcolor: showBox ? hexToRgba(labelColor, 0.12) : undefined,
            bordercolor: showBox ? labelColor : undefined,
            borderpad: showBox ? 3 : undefined,
            editable: false,
            font: {
              size: fontSize,
              color: labelColor,
            },
          };
        });
      });
    },
    [
      connectorArrowColor,
      labelOrientation,
      overlayMode,
      overlaySeries,
      props.showOverlayLabels,
      scale,
      settings.labels.fontSize,
      settings.overlayColors,
      settings.overlayColorsBySessionId,
      settings.overlayLabels,
    ],
  );
  const primaryLabelLayer = useMemo(() => {
    const signalValues =
      uv?.available === true && uv.signal.length > 0
        ? uv.signal
        : labels.map((label) => label.signal);
    const signalMin = signalValues.length > 0 ? Math.min(...signalValues) : 0;
    const signalMax = signalValues.length > 0 ? Math.max(...signalValues) : 1;
    const isNorm = overlayMode === "normalized" || overlayMode === "stacked";
    if (bunchLabels) {
      return buildBunchedAnnotations(labels, {
        xOffset,
        scale,
        labelOrientation,
        connectorColor,
        connectorArrowColor,
        fontSize: settings.labels.fontSize,
        fontColor: settings.labels.color,
        signalMin,
        signalMax,
        hubOffset: bunchHubOffset,
        bunchOffsets,
      });
    }
    return {
      annotations: labels.map((label, index) => ({
        x: (label.uv_rt_min + xOffset) * scale,
        y: isNorm && signalMax > 0 ? (label.signal / signalMax) * 100 : label.signal,
        text: cleanLabelText(label.text),
        textangle: labelOrientation === "vertical" ? ("-90" as const) : ("0" as const),
        showarrow: true,
        arrowhead: 0,
        arrowcolor: connectorArrowColor,
        ax: label.ax ?? 0,
        axref: label.axRef === "x" ? ("x" as const) : ("pixel" as const),
        ayref: label.ayRef === "y" ? ("y" as const) : ("pixel" as const),
        ay:
          label.ay ??
          (labelOrientation === "vertical" ? -78 - index * 26 : -42 - index * 22),
        font: {
          size: settings.labels.fontSize,
          color: settings.labels.color,
        },
      })),
      shapes: [] as UvPlotShape[],
    };
  }, [
    available,
    bunchHubOffset,
    bunchLabels,
    bunchOffsets,
    connectorArrowColor,
    connectorColor,
    labelOrientation,
    labels,
    overlayMode,
    scale,
    settings.labels.color,
    settings.labels.fontSize,
    uv,
    xOffset,
  ]);
  usePlotResizePulses([
    localRevision,
    available,
    bunchLabels,
    labelOrientation,
    labels.length,
    overlayLabelCount,
    overlayTraces.length,
    rtUnit,
    selectedUvRt,
    settings.axis.xMax,
    settings.axis.xMin,
    settings.axis.yMax,
    settings.axis.yMin,
    settings.color,
    settings.height,
    settings.labels.color,
    settings.labels.fontSize,
    settings.lineWidth,
    settings.overlayColors,
    settings.showGrid,
    settings.tickSize,
    settings.title,
    settings.xTitle,
    settings.yTitle,
    uv?.available === true ? uv.rt_min.length : 0,
    ...overlayTraces.map((trace) => trace.uv.rt_min.length),
    xOffset,
  ], uvPlotRef);
  useEffect(() => {
    schedulePlotResize();
    const frame = window.requestAnimationFrame(() => {
      if (!uvPlotRef.current) return;
      void import("plotly.js-dist-min").then((plotlyModule) => {
        if (uvPlotRef.current) void plotlyModule.default.Plots.resize(uvPlotRef.current);
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [
    localRevision,
    bunchLabels,
    labelOrientation,
    labels.length,
    overlayLabelCount,
    settings.axis.xMax,
    settings.axis.xMin,
    settings.axis.yMax,
    settings.axis.yMin,
    settings.color,
    settings.height,
    settings.labels.color,
    settings.labels.fontSize,
    settings.lineWidth,
    settings.overlayColors,
    settings.showGrid,
    settings.tickSize,
    settings.title,
    settings.xTitle,
    settings.yTitle,
  ]);

  const saveSvg = async () => {
    if (!uvPlotRef.current) return;
    const plotlyModule = await import("plotly.js-dist-min");
    const plotly = plotlyModule.default;
    const baseName = (meta?.filename ?? "uv_chromatogram")
      .replace(/\.[^.]+$/, "")
      .replace(/[^A-Za-z0-9_-]+/g, "_");
    await plotly.downloadImage(uvPlotRef.current, {
      format: "svg",
      filename: `${baseName}_uv_chromatogram`,
      width: uvPlotSize.width,
      height: uvPlotSize.height,
      scale: 1,
    });
  };

  const saveUvPaper = async (format: PublicationExportFormat, exportSettings: PublicationExportSettings) => {
    if (!uvPlotRef.current) return;
    const baseName = sanitizeFilenamePart(meta?.filename ?? "uv_chromatogram", "uv_chromatogram");
    const is1to1 = exportSettings.isCurrentView;
    await exportPlotlyPublicationImage(uvPlotRef.current, {
      format,
      filename: `${baseName}_uv_chromatogram_${publicationFilenameSuffix(exportSettings, format)}`,
      ...exportSettings,
    }, {
      layoutOverrides: is1to1
        ? {
            margin: {
              l: Math.max(68, settings.title ? 28 : 12),
              r: 18,
              t: settings.title ? 28 : 12,
              b: 46,
            },
          }
        : {
            font: { family: "Arial, Helvetica, sans-serif", size: 9, color: "#111827" },
            margin: { l: 68, r: 18, t: settings.title ? 28 : 12, b: 46 },
          },
    });
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
    if (bunchLabels) return;
    labels.forEach((label, index) => {
      const patch: Partial<UVTextLabel> = {};
      const ax = event[`annotations[${index}].ax`];
      const ay = event[`annotations[${index}].ay`];
      if (typeof ax === "number" && Number.isFinite(ax)) patch.ax = ax;
      if (typeof ay === "number" && Number.isFinite(ay)) patch.ay = ay;
      if (Object.keys(patch).length > 0) onMoveLabel(label.id, patch);
    });
  };
  const shapes: UvPlotShape[] =
    selectedUvRt != null
      ? [
          {
            type: "line" as const,
            xref: "x" as const,
            yref: "paper" as const,
            x0: (selectedUvRt + xOffset) * scale,
            x1: (selectedUvRt + xOffset) * scale,
            y0: 0,
            y1: 1,
            line: { color: "#5573b9", width: 1, dash: "dot" as const },
          },
        ]
      : [];
  const plotShapes = [...shapes, ...primaryLabelLayer.shapes];

  return (
    <div className="card flex min-w-0 shrink-0 flex-col overflow-hidden p-3">
      {/* Tier 1: Title & Status Bar */}
      <div className="px-1 pb-1.5">
        <ChartCardTitle
          title="UV Chromatogram"
          status={[
            available && meta?.filename && `${meta.filename}${meta.y_label || meta.y_col ? ` (${meta.y_label || meta.y_col})` : ""}`,
            available && uv.peaks.length > 0 && `${uv.peaks.length} peak${uv.peaks.length === 1 ? "" : "s"}`,
            overlayTraces.length > 0 && `${overlayTraces.length} overlay${overlayTraces.length === 1 ? "" : "s"}`,
            xOffset !== 0 && `offset ${xOffset.toFixed(3)} min`,
            selectedUvRt != null &&
              `UV RT ${formatRt(selectedUvRt, rtUnit)}${props.selectedScanId ? ` · Scan ${formatScanId(props.selectedScanId)}` : ""}`,
            available && "click to load an MS spectrum",
          ]}
        />
      </div>

      {/* Tier 2: Action Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ink-100/80 px-1 py-1.5">
        {/* Left Cluster: Plot-specific labeling & detection actions */}
        <div className="flex flex-wrap items-center gap-1.5">
          {available && (
            <>
              <button
                type="button"
                className="btn-primary whitespace-nowrap px-2.5 py-1"
                onClick={props.onAutoLabelUV}
                disabled={busy}
                title="Automatically detect UV peaks and annotate each with matching MS spectrum m/z"
              >
                <Sparkles {...ICON_PROPS} />
                <span>Auto label peaks</span>
              </button>
              {props.onLabelSelectedRT && selectedUvRt != null && (
                <ToolbarButton
                  icon={MapPin}
                  label="Label RT"
                  disabled={busy}
                  onClick={props.onLabelSelectedRT}
                  title="Annotate currently selected UV retention time with top MS spectrum peaks"
                />
              )}
              {props.onCustomUvLabel && (
                <ToolbarButton icon={Plus} label="Custom" disabled={busy} onClick={props.onCustomUvLabel} title="Add custom text label at retention time" />
              )}
              <ToolbarButton
                icon={Tags}
                label="Label options"
                active={showLabelOptions}
                onClick={() => setShowLabelOptions((prev) => !prev)}
                title="Configure UV peak detection thresholds, label arrangement, and snapping"
              />
              {labels.length > 0 && (
                <button type="button" className="btn-danger whitespace-nowrap px-2 py-1" onClick={onClearLabels} title="Delete all transferred UV labels">
                  Clear labels ({labels.length})
                </button>
              )}
            </>
          )}
        </div>

        {/* Right Cluster: Standard controls, export, and file management */}
        <div className="flex items-center gap-1.5 shrink-0">
          {overlayTraces.length > 0 && props.onUpdateOverlayMode && (
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
          {props.onOpenDesign && (
            <ToolbarButton icon={Palette} label="Design" onClick={props.onOpenDesign} title="Configure UV plot appearance, limits & labels" />
          )}
          {props.onReload && (
            <ToolbarButton
              icon={RotateCw}
              label="Reload"
              title="Reload UV plot"
              onClick={() => {
                setLocalRevision((r) => r + 1);
                props.onReload?.();
              }}
            />
          )}

          <PaperFigureExportToolbar
            disabled={busy || !available}
            storageKey="mfp-publication-plot-export-lcms-uv"
            currentSizePx={{ width: uvPlotSize.width, height: uvPlotSize.height }}
            onExport={saveUvPaper}
          />

          <ToolbarButton
            icon={FileUp}
            label={busy ? "Working…" : available ? "Replace CSV…" : "Attach CSV…"}
            disabled={busy}
            onClick={onPickFile}
            title="Attach a UV/DAD chromatogram exported from your LC"
          />
          {available && (
            <ToolbarButton icon={Unlink} label="Detach" disabled={busy} onClick={onRemove} title="Detach UV chromatogram" />
          )}
        </div>
      </div>

      {showLabelOptions && available && (
        <div className="mb-2.5 rounded-lg border border-brand-200 bg-brand-50/20 p-3 text-xs text-ink-800 shadow-sm">
          <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2 border-b border-ink-200 pb-2">
            <div className="text-section flex items-center gap-1.5">
              <Tags {...ICON_PROPS} />
              <span>UV peak labelling & detection settings</span>
            </div>
            <div className="flex items-center gap-2">
              {props.onAutoArrangeLabels && (
                <button
                  type="button"
                  className="btn-ghost px-2 py-1 disabled:opacity-40"
                  onClick={props.onAutoArrangeLabels}
                  disabled={labels.length === 0}
                  title="Arrange labels into clean descending stairs to prevent overlap"
                >
                  <ArrowDownWideNarrow {...ICON_PROPS} />
                  Auto-arrange stairs
                </button>
              )}
              {labels.length > 0 && (
                <button
                  type="button"
                  className="btn-danger px-2 py-1"
                  onClick={onClearLabels}
                  title="Clear all transferred and custom UV labels"
                >
                  Clear All ({labels.length})
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {/* Peak Detection */}
            <div className="space-y-2 rounded-md border border-ink-200 bg-surface p-2.5">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">
                Peak Detection
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-ink-600">Prominence:</span>
                <input
                  type="number"
                  step="0.01"
                  min={0}
                  className="input h-7 w-20 text-xs"
                  value={props.uvProminence ?? 0.05}
                  onChange={(e) =>
                    props.setUvProminence?.(Math.max(0, parseFloat(e.target.value || "0") || 0))
                  }
                />
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-ink-600">Min dist (min):</span>
                <input
                  type="number"
                  step="0.05"
                  min={0}
                  className="input h-7 w-20 text-xs"
                  value={props.uvMinDistance ?? 0.1}
                  onChange={(e) =>
                    props.setUvMinDistance?.(Math.max(0, parseFloat(e.target.value || "0") || 0))
                  }
                />
              </div>
              <button
                type="button"
                className="w-full rounded bg-brand-600 py-1 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
                onClick={props.onAutoLabelUV}
                disabled={!available || busy}
              >
                Re-run Detection
              </button>
            </div>

            {/* Placement & Alignment */}
            <div className="space-y-2 rounded-md border border-ink-200 bg-surface p-2.5">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">
                Placement & Angle
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-ink-600">Orientation:</span>
                <select
                  className="input h-7 text-xs"
                  value={labelOrientation}
                  onChange={(e) => props.setUvLabelOrientation?.(e.target.value as UVLabelOrientation)}
                >
                  <option value="vertical">Vertical (-90°)</option>
                  <option value="horizontal">Horizontal (0°)</option>
                </select>
              </div>
              <label className="flex items-center gap-2 text-ink-700 cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="rounded border-ink-300 text-brand-600"
                  checked={props.snapUvLabels ?? false}
                  onChange={(e) => props.setSnapUvLabels?.(e.target.checked)}
                />
                <span>Snap to peak apex</span>
              </label>
            </div>

            {/* MS Spectrum Transfer */}
            <div className="space-y-2 rounded-md border border-ink-200 bg-surface p-2.5">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">
                Transfer from MS
              </div>
              <label className="flex items-center gap-2 text-ink-700 cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="rounded border-ink-300 text-brand-600"
                  checked={props.transferMsToUv ?? false}
                  onChange={(e) => props.setTransferMsToUv?.(e.target.checked)}
                />
                <span>Transfer MS peaks on click</span>
              </label>
              <div className="flex items-center justify-between gap-2">
                <span className="text-ink-600">Peaks to transfer:</span>
                <select
                  className="input h-7 w-20 text-xs"
                  value={props.uvTransferCount ?? 3}
                  onChange={(e) => props.setUvTransferCount?.(parseInt(e.target.value, 10))}
                >
                  {[1, 2, 3, 5, 8, 10].map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Grouping & Stairs */}
            <div className="space-y-2 rounded-md border border-ink-200 bg-surface p-2.5">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">
                Grouping & Stairs
              </div>
              <label className="flex items-center gap-2 text-ink-700 cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="rounded border-ink-300 text-brand-600"
                  checked={bunchLabels}
                  onChange={(e) => props.setUvBunchLabels?.(e.target.checked)}
                />
                <span>Bunch identical labels</span>
              </label>
              {bunchLabels && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-ink-600">Hub height:</span>
                  <input
                    type="number"
                    step="0.05"
                    min={0}
                    max={1}
                    className="input h-7 w-20 text-xs"
                    value={bunchHubOffset}
                    onChange={(e) => props.setUvBunchHubOffset?.(parseFloat(e.target.value || "0") || 0)}
                  />
                </div>
              )}
              <div className="flex items-center justify-between gap-2">
                <span className="text-ink-600">Stair X step:</span>
                <input
                  type="number"
                  step="0.05"
                  min={0}
                  className="input h-7 w-20 text-xs"
                  value={props.uvLabelStairXStep ?? 0.08}
                  onChange={(e) =>
                    props.setUvLabelStairXStep?.(Math.max(0, parseFloat(e.target.value || "0") || 0))
                  }
                />
              </div>
            </div>

            {/* UV↔MS Alignment */}
            <div className="space-y-2 rounded-md border border-ink-200 bg-surface p-2.5">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">
                UV↔MS Alignment
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-ink-600">Offset (min):</span>
                <input
                  type="number"
                  step="0.001"
                  className="input h-7 w-20 text-xs"
                  value={props.uvOffsetText ?? "0.000"}
                  onChange={(e) => props.setUvOffsetText?.(e.target.value)}
                />
              </div>
              <button
                type="button"
                className="w-full rounded border border-ink-300 bg-surface py-1 text-xs font-semibold text-ink-700 hover:bg-ink-100"
                onClick={props.onApplyOffset}
              >
                Apply Offset
              </button>
              <button
                type="button"
                className="w-full rounded bg-brand-600 py-1 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
                onClick={props.onAutoAlignUV}
                disabled={!available || busy}
                title="Automatically cross-correlate TIC and UV to find optimal offset"
              >
                Auto-align UV↔MS
              </button>
              <label className="flex items-center gap-2 text-ink-700 cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="rounded border-ink-300 text-brand-600"
                  checked={props.autoAlignUv ?? false}
                  onChange={(e) => props.setAutoAlignUv?.(e.target.checked)}
                />
                <span>Enable auto-align</span>
              </label>
            </div>
          </div>
        </div>
      )}

      {!uv ? (
        <div className="flex h-72 items-center justify-center text-sm text-ink-500">
          Loading UV…
        </div>
      ) : !canPlot ? (
        <div className="flex h-72 flex-col items-center justify-center gap-2 rounded-md border border-dashed border-ink-200 bg-ink-50/40 px-6 text-center">
          <div className="text-sm font-medium text-ink-700">
            No UV chromatogram attached
          </div>
          <div className="max-w-md text-xs text-ink-500">
            Most mzML files only contain MS scans. Export the UV/DAD trace from
            your LC software as CSV (time + signal columns) and attach it here
            to view it alongside the TIC.
          </div>
          <button className="btn-primary mt-1" onClick={onPickFile} disabled={busy}>
            Attach UV CSV(s)…
          </button>
        </div>
      ) : (
        <>
          <div
            ref={uvContainerRef}
            className="min-w-0 overflow-hidden"
            style={{ height: settings.height }}
          >
            <Plot
              revision={uvPlotSize.revision + localRevision}
              data={[
                ...(available
                  ? [
                      {
                        type: "scattergl" as const,
                        mode: "lines" as const,
                        x: xs,
                        y: activeY,
                        customdata: uv.signal,
                        line: { color: themeTraceColor(settings.color, pt.theme), width: settings.lineWidth },
                ...exportColorMeta(settings.color),
                        hovertemplate:
                          overlayMode === "raw"
                            ? `RT: %{x:.3f} ${unit}<br>Signal: %{y:.3e}<extra></extra>`
                            : `RT: %{x:.3f} ${unit}<br>Rel: %{y:.1f}%<br>Signal: %{customdata:.3e}<extra></extra>`,
                        name: "UV (Active)",
                      },
                    ]
                  : []),
                ...overlayData,
              ]}
              layout={{
                height: uvPlotSize.height,
                width: uvPlotSize.width,
                margin: { l: 65, r: 20, t: settings.title ? 28 : 15, b: 45 },
                title: settings.title
                  ? { text: settings.title, font: { size: settings.titleSize } }
                  : undefined,
                font: { size: settings.tickSize, color: pt.screenFontColor },
                xaxis: {
                  title: axisTitle(`${settings.xTitle} (${unit})`, settings.axisTitleSize),
                  zeroline: false,
                  showgrid: settings.showGrid,
                  range: props.syncedRtRange
                    ? [props.syncedRtRange[0] * scale, props.syncedRtRange[1] * scale]
                    : axisRange(settings.axis.xMin, settings.axis.xMax),
                  tickfont: { size: settings.tickSize },
                  ...axisFrame(settings),
                },
                yaxis: {
                  title: axisTitle(
                    settings.yTitle ||
                      (overlayMode === "normalized"
                        ? "UV (% Base Peak)"
                        : overlayMode === "stacked"
                        ? "Stacked (% Base Peak)"
                        : meta?.y_label || meta?.y_col || "Signal (AU)"),
                    settings.axisTitleSize,
                  ),
                  zeroline: false,
                  exponentformat: "power",
                  showgrid: settings.showGrid,
                  range:
                    overlayMode === "raw"
                      ? axisRange(settings.axis.yMin, settings.axis.yMax)
                      : settings.axis.yMin != null || settings.axis.yMax != null
                      ? axisRange(settings.axis.yMin, settings.axis.yMax)
                      : undefined,
                  tickfont: { size: settings.tickSize },
                  ...axisFrame(settings),
                },
                hovermode: "x",
                annotations: [...primaryLabelLayer.annotations, ...(props.showOverlayLabels ? overlayAnnotations : [])],
                colorway: pt.colorway,
                plot_bgcolor: pt.plot_bgcolor,
                paper_bgcolor: pt.paper_bgcolor,
                showlegend: overlayData.length > 0,
                shapes: plotShapes,
              }}
              config={{
                responsive: true,
                displaylogo: false,
                editable: true,
                edits: {
                  annotationPosition: true,
                  annotationText: false,
                  axisTitleText: false,
                  titleText: false,
                },
              }}
              style={{ width: "100%", height: "100%", minWidth: 0 }}
              useResizeHandler
              onClick={onClick}
              onInitialized={(_figure, graphDiv) => {
                uvPlotRef.current = graphDiv as PlotlyHTMLElement;
                queuePlotlyElementResize(uvPlotRef.current);
              }}
              onUpdate={(_figure, graphDiv) => {
                uvPlotRef.current = graphDiv as PlotlyHTMLElement;
              }}
              onRelayout={handleRelayout}
            />
          </div>
          {labels.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2 px-1 text-xs">
              {labels.map((label) => (
                <span
                  key={label.id}
                  className="inline-flex max-w-full items-center gap-1 rounded-full border border-ink-200 bg-surface px-2 py-1 text-ink-700"
                  title={`UV RT ${label.uv_rt_min.toFixed(4)} min`}
                >
                  <button
                    className="truncate text-left hover:text-brand-700"
                    onClick={() => onEditLabel(label)}
                    title="Edit this UV label"
                  >
                    {cleanLabelText(label.text)}
                  </button>
                  <button
                    className="rounded-full px-1 font-semibold text-ink-400 hover:bg-red-50 hover:text-red-600"
                    onClick={() => onDeleteLabel(label.id)}
                    title="Delete this UV label"
                  >
                    x
                  </button>
                </span>
              ))}
            </div>
          )}
          {meta?.warnings && meta.warnings.length > 0 && (
            <div className="mt-1 px-1 text-[11px] text-amber-700">
              {meta.warnings.map((w, i) => (
                <div key={i}>• {w}</div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
