import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Plot from "react-plotly.js";
import type { PlotMouseEvent, PlotlyHTMLElement } from "plotly.js";
import clsx from "clsx";
import { SpectrumData } from "../../api";
import { exportColorMeta, themeTraceColor, usePlotlyTheme } from "../../theme/ThemeProvider";
import { PaperFigureExportToolbar } from "../PaperFigureExportToolbar";
import { exportPlotlyPublicationImage, PublicationExportFormat, PublicationExportSettings, publicationFilenameSuffix, sanitizeFilenamePart } from "../../utils/publicationPlotExport";
import { extractTopPeaks } from "../../lcms/analysis";
import { DEFAULT_POLYMER_LABEL_SETTINGS, DEFAULT_OVERLAY_LABEL_SETTINGS, OVERLAY_PALETTE, type ChartSettings, type SpectrumOverlayMode } from "../../lcms/settings";
import { Atom, Hand, Hexagon, Palette, RotateCcw, RotateCw, ZoomIn } from "lucide-react";
import { SegmentedControl } from "../common/SegmentedControl";
import { useContainerSize, usePlotResizePulses, queuePlotlyElementResize, RtUnit, LCMSSpectrumOverlayTrace, cleanLabelText, formatRt, axisRange, axisTitle, axisFrame, ChartCardTitle, ICON_PROPS, ToolbarButton } from "../../lcms/viewShared";

export function hexToRgba(hex: string, alpha: number): string {
  const clean = (hex || "#7c3aed").replace("#", "").trim();
  if (clean.length === 6) {
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  if (clean.length === 3) {
    const r = parseInt(clean[0] + clean[0], 16);
    const g = parseInt(clean[1] + clean[1], 16);
    const b = parseInt(clean[2] + clean[2], 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return hex;
}

export function pruneCentroidsForDisplay(
  mz: number[],
  intensity: number[],
  basePeak: number,
  criticalMzs?: number[],
  maxPoints = 3500,
): { mz: number[]; intensity: number[] } {
  const n = mz.length;
  if (n <= maxPoints) {
    return { mz, intensity };
  }

  // 1. Identify critical indices that must NEVER be dropped (labeled peaks, polymer hits, top N)
  const mustKeep = new Uint8Array(n);
  if (criticalMzs && criticalMzs.length > 0) {
    for (const target of criticalMzs) {
      let closestIdx = -1;
      let minDiff = 0.05;
      for (let i = 0; i < n; i++) {
        const diff = Math.abs(mz[i] - target);
        if (diff < minDiff) {
          minDiff = diff;
          closestIdx = i;
        }
      }
      if (closestIdx !== -1) {
        mustKeep[closestIdx] = 1;
      }
    }
  }

  // 2. Filter out baseline noise (< 0.05% of base peak)
  const noiseThreshold = basePeak * 0.0005;
  const filteredIndices: number[] = [];
  for (let i = 0; i < n; i++) {
    if (mustKeep[i] === 1 || intensity[i] >= noiseThreshold) {
      filteredIndices.push(i);
    }
  }

  // 3. If still exceeding maxPoints, keep the highest peaks plus mustKeep
  if (filteredIndices.length > maxPoints) {
    filteredIndices.sort((a, b) => {
      if (mustKeep[a] !== mustKeep[b]) return mustKeep[b] - mustKeep[a];
      return intensity[b] - intensity[a];
    });
    const topIndices = filteredIndices.slice(0, maxPoints);
    topIndices.sort((a, b) => mz[a] - mz[b]);
    return {
      mz: topIndices.map((i) => mz[i]),
      intensity: topIndices.map((i) => intensity[i]),
    };
  }

  return {
    mz: filteredIndices.map((i) => mz[i]),
    intensity: filteredIndices.map((i) => intensity[i]),
  };
}

export function SpectrumChart(props: {
  spectrum: SpectrumData | null;
  overlayTraces: LCMSSpectrumOverlayTrace[];
  annotate: boolean;
  showOverlayLabels: boolean;
  showDragHint: boolean;
  selectedRt: number | null;
  rtUnit: RtUnit;
  settings: ChartSettings;
  polymerEnabled: boolean;
  polymerStudioOpen?: boolean;
  onTogglePolymerStudio?: () => void;
  onPeakClick?: (
    mz: number,
    intensity?: number,
    event?: MouseEvent,
    target?: { sessionId?: string; displayName?: string },
  ) => void;
  onDeconvolution?: () => void;
  onOpenDesign?: () => void;
  onReload?: () => void;
  onUpdateOverlayMode?: (mode: SpectrumOverlayMode) => void;
  title?: string;
  polarityBadge?: "ESI+" | "ESI-" | string;
  colorOverride?: string;
  emptyMessage?: string;
}) {
  const [localRevision, setLocalRevision] = useState(0);
  const s = props.spectrum;
  const specContainerRef = useRef<HTMLDivElement>(null);
  const specPlotRef = useRef<PlotlyHTMLElement | null>(null);
  const specPlotSize = useContainerSize(specContainerRef, props.settings.height);
  const pt = usePlotlyTheme();

  const lastPeakClickTimeRef = useRef<number>(0);
  const [targetMzInput, setTargetMzInput] = useState("");
  const [interactionMode, setInteractionMode] = useState<"zoom" | "move">("zoom");

  const handlePickTargetMz = (enteredMz?: number) => {
    const mzVal = enteredMz ?? parseFloat(targetMzInput.trim());
    if (!Number.isFinite(mzVal) || !s) return;

    let nearestMz = mzVal;
    let nearestIntensity = 0;
    let minDiff = Infinity;
    for (let i = 0; i < s.mz.length; i++) {
      const diff = Math.abs(s.mz[i] - mzVal);
      if (diff < minDiff) {
        minDiff = diff;
        nearestMz = s.mz[i];
        nearestIntensity = s.intensity[i];
      }
    }

    const finalMz = minDiff <= 0.5 ? nearestMz : mzVal;
    const finalIntensity = minDiff <= 0.5 ? nearestIntensity : 0;

    if (props.onPeakClick) {
      lastPeakClickTimeRef.current = Date.now();
      props.onPeakClick(finalMz, finalIntensity);
    }
  };

  const [labelOffsets, setLabelOffsets] = useState<Record<number, { ax?: number; ay?: number; x?: number; y?: number }>>({});

  useEffect(() => {
    setLabelOffsets({});
  }, [props.selectedRt, s?.meta.spectrum_id]);

  const overlayMode: SpectrumOverlayMode = props.settings.overlaySettings?.spectrumMode ?? "overlay";
  const traceOpacity = props.settings.overlaySettings?.traceOpacity ?? 0.38;

  usePlotResizePulses([
    localRevision,
    overlayMode,
    props.annotate,
    props.polymerEnabled,
    props.rtUnit,
    props.selectedRt,
    props.overlayTraces.length,
    props.showOverlayLabels,
    props.settings.axis.xMax,
    props.settings.axis.xMin,
    props.settings.axis.yMax,
    props.settings.axis.yMin,
    props.settings.barWidth,
    props.settings.color,
    props.settings.height,
    props.settings.labels.color,
    props.settings.labels.enabled,
    props.settings.labels.fontSize,
    props.settings.overlayColors,
    props.settings.overlayColorsBySessionId,
    props.settings.showGrid,
    props.settings.tickSize,
    props.settings.title,
    props.settings.xTitle,
    props.settings.yTitle,
    props.spectrum?.mz.length,
    props.spectrum?.labels.length,
    props.spectrum?.polymer_labels?.length,
    ...props.overlayTraces.map((trace) => trace.spectrum.mz.length),
  ], specPlotRef);

  const polymerLabelCount = s
    ? (s.polymer_labels ?? s.labels.filter((label) => label.source === "polymer")).length
    : 0;
  const visibleLabels = s
    ? s.labels.filter((label) => props.settings.labels.enabled || label.source === "polymer")
    : [];

  const handleSpectrumClick = (event: Readonly<PlotMouseEvent>) => {
    if (Date.now() - lastPeakClickTimeRef.current < 250) return;
    lastPeakClickTimeRef.current = Date.now();
    const point = event.points?.[0];
    const mz = Number(point?.x);
    const rawY = Number(point?.y);
    const customdata = Number((point as unknown as { customdata?: number })?.customdata);
    const intensity = Number.isFinite(customdata)
      ? customdata
      : Number.isFinite(rawY)
      ? Math.abs(rawY)
      : undefined;

    if (!Number.isFinite(mz) || !props.onPeakClick) return;
    const clientEvent = (event as unknown as { event?: MouseEvent }).event;

    // Detect if click was on active spectrum (curveNumber === 0) or an overlay trace (curveNumber >= 1)
    const curveNumber = point?.curveNumber;
    let target: { sessionId?: string; displayName?: string } | undefined;
    if (typeof curveNumber === "number" && curveNumber > 0 && curveNumber <= props.overlayTraces.length) {
      const clickedTrace = props.overlayTraces[curveNumber - 1];
      if (clickedTrace) {
        target = {
          sessionId: clickedTrace.session_id,
          displayName: clickedTrace.display_name,
        };
      }
    }

    props.onPeakClick(mz, intensity, clientEvent, target);
  };

  const activeBasePeak = useMemo(() => {
    if (!s || s.intensity.length === 0) return 1;
    let max = 0;
    for (let i = 0; i < s.intensity.length; i++) {
      if (s.intensity[i] > max) max = s.intensity[i];
    }
    return max > 0 ? max : 1;
  }, [s]);

  const topPeaks = useMemo(() => {
    return extractTopPeaks(s, activeBasePeak, 10);
  }, [s, activeBasePeak]);

  const isButterfly = overlayMode === "butterfly" || overlayMode === "butterfly_normalized";
  const isNorm = overlayMode === "normalized" || overlayMode === "butterfly_normalized";

  const criticalMzs = useMemo(() => visibleLabels.map((l) => l.mz), [visibleLabels]);

  const displayActive = useMemo(() => {
    if (!s) return { mz: [], intensity: [] };
    return pruneCentroidsForDisplay(s.mz, s.intensity, activeBasePeak, criticalMzs);
  }, [s, activeBasePeak, criticalMzs]);

  const activeY = useMemo(() => {
    if (displayActive.mz.length === 0) return [];
    if (isNorm) {
      return displayActive.intensity.map((v) => (v / activeBasePeak) * 100);
    }
    return displayActive.intensity;
  }, [activeBasePeak, displayActive, isNorm]);

  const overlayData = useMemo(
    () =>
      props.overlayTraces.map((trace, index) => {
        let traceBasePeak = 1;
        if (isNorm) {
          let max = 0;
          for (let i = 0; i < trace.spectrum.intensity.length; i++) {
            if (trace.spectrum.intensity[i] > max) max = trace.spectrum.intensity[i];
          }
          traceBasePeak = max > 0 ? max : 1;
        }

        const traceCriticalMzs = trace.spectrum.labels.map((l) => l.mz);
        const displayTrace = pruneCentroidsForDisplay(
          trace.spectrum.mz,
          trace.spectrum.intensity,
          traceBasePeak,
          traceCriticalMzs,
        );

        let yValues: number[];
        let hovertemplate: string;

        if (overlayMode === "butterfly_normalized") {
          yValues = displayTrace.intensity.map((v) => -((v / traceBasePeak) * 100));
          hovertemplate = `${trace.display_name}<br>m/z: %{x:.4f}<br>rel: %{customdata[1]:.1f}%<br>int: %{customdata[0]:.3e}<extra></extra>`;
        } else if (overlayMode === "butterfly") {
          yValues = displayTrace.intensity.map((v) => -v);
          hovertemplate = `${trace.display_name}<br>m/z: %{x:.4f}<br>int: %{customdata[0]:.3e}<extra></extra>`;
        } else if (overlayMode === "normalized") {
          yValues = displayTrace.intensity.map((v) => (v / traceBasePeak) * 100);
          hovertemplate = `${trace.display_name}<br>m/z: %{x:.4f}<br>rel: %{y:.1f}%<br>int: %{customdata[0]:.3e}<extra></extra>`;
        } else {
          yValues = displayTrace.intensity;
          hovertemplate = `${trace.display_name}<br>m/z: %{x:.4f}<br>int: %{y:.3e}<extra></extra>`;
        }

        const traceColor =
          props.settings.overlayColorsBySessionId?.[trace.session_id] ??
          props.settings.overlayColors?.[index] ??
          OVERLAY_PALETTE[index % OVERLAY_PALETTE.length];

        return {
          type: "bar" as const,
          x: displayTrace.mz,
          y: yValues,
          customdata: displayTrace.intensity.map((v) => [v, (v / traceBasePeak) * 100]),
          width: props.settings.barWidth,
          marker: {
            color: traceColor,
          },
          opacity: isButterfly ? Math.max(0.75, traceOpacity) : traceOpacity,
          hovertemplate,
          name: trace.display_name,
        };
      }),
    [
      isButterfly,
      isNorm,
      overlayMode,
      props.overlayTraces,
      props.settings.barWidth,
      props.settings.overlayColors,
      props.settings.overlayColorsBySessionId,
      traceOpacity,
    ],
  );

  const overlayLabelCfg = props.settings.overlayLabels ?? DEFAULT_OVERLAY_LABEL_SETTINGS;

  const overlayAnnotations = useMemo(() => {
    if (!props.annotate || !props.showOverlayLabels || overlayLabelCfg.enabled === false) return [];
    const isVertical = overlayLabelCfg.orientation === "vertical";
    const showBox = overlayLabelCfg.showBox ?? true;
    const showArrow = overlayLabelCfg.showArrow ?? true;
    const fontSize = overlayLabelCfg.fontSize ?? Math.max(8, props.settings.labels.fontSize - 1);

    return props.overlayTraces.flatMap((trace, traceIndex) => {
      let traceBasePeak = 1;
      if (isNorm) {
        let max = 0;
        for (let i = 0; i < trace.spectrum.intensity.length; i++) {
          if (trace.spectrum.intensity[i] > max) max = trace.spectrum.intensity[i];
        }
        traceBasePeak = max > 0 ? max : 1;
      }

      const traceColor =
        props.settings.overlayColorsBySessionId?.[trace.session_id] ??
        props.settings.overlayColors?.[traceIndex] ??
        OVERLAY_PALETTE[traceIndex % OVERLAY_PALETTE.length];

      const labelColor =
        overlayLabelCfg.colorsBySessionId?.[trace.session_id] ??
        (overlayLabelCfg.useTraceColor ? traceColor : overlayLabelCfg.color || traceColor);

      return trace.spectrum.labels
        .filter((label) => props.settings.labels.enabled || label.source === "polymer")
        .map((label, labelIndex) => {
          let labelY = label.intensity;
          let yshift = 18 + traceIndex * 10 + labelIndex * 2;
          let ay = isVertical ? -46 - traceIndex * 14 : -34 - traceIndex * 14;

          if (isButterfly) {
            labelY = isNorm ? -((label.intensity / traceBasePeak) * 100) : -label.intensity;
            yshift = -(18 + traceIndex * 10 + labelIndex * 2);
            ay = isVertical ? 46 + traceIndex * 14 : 34 + traceIndex * 14;
          } else if (isNorm) {
            labelY = (label.intensity / traceBasePeak) * 100;
          }

          return {
            x: label.mz,
            y: labelY,
            text: label.text ? cleanLabelText(label.text) : label.mz.toFixed(4),
            textangle: isVertical ? ("-90" as const) : ("0" as const),
            showarrow: showArrow,
            arrowhead: 2,
            arrowsize: 0.8,
            arrowwidth: 1,
            arrowcolor: labelColor,
            ax: 0,
            ay: showArrow ? ay : 0,
            yshift: showArrow ? 0 : (isButterfly ? -(isVertical ? 22 : 12) : (isVertical ? 22 : 12)),
            bgcolor: showBox ? hexToRgba(labelColor, 0.12) : undefined,
            bordercolor: showBox ? labelColor : undefined,
            borderpad: showBox ? 3 : undefined,
            font: {
              size: fontSize,
              color: labelColor,
            },
          };
        });
    });
  }, [
    isButterfly,
    isNorm,
    overlayLabelCfg,
    props.annotate,
    props.overlayTraces,
    props.settings.labels.enabled,
    props.settings.labels.fontSize,
    props.settings.overlayColors,
    props.settings.overlayColorsBySessionId,
    props.showOverlayLabels,
  ]);

  const savePublication = useCallback(
    (format: PublicationExportFormat, exportSettings: PublicationExportSettings) => {
      if (!specPlotRef.current || !s) return;
      const rtPart = s.meta.rt_start != null
        ? `region_${s.meta.rt_start.toFixed(3)}_${s.meta.rt_end?.toFixed(3) ?? ""}`
        : `rt_${s.meta.rt_min.toFixed(3)}`;
      const base = sanitizeFilenamePart(props.title || props.settings.title || `lcms_ms1_${rtPart}`, "lcms_ms1_spectrum");
      const is1to1 = exportSettings.isCurrentView;

      void exportPlotlyPublicationImage(specPlotRef.current, {
        format,
        filename: `${base}_${publicationFilenameSuffix(exportSettings, format)}`,
        ...exportSettings,
      }, {
        layoutOverrides: is1to1
          ? {
              margin: {
                l: Math.max(70, props.settings.title ? 28 : 20),
                r: 20,
                t: props.settings.title ? 28 : 20,
                b: 45,
              },
            }
          : {
              font: { family: "Arial, Helvetica, sans-serif", size: 9, color: "#111827" },
              margin: { l: 70, r: 18, t: props.settings.title ? 28 : 14, b: 46 },
            },
      });
    },
    [props.settings.title, props.title, s],
  );

  const handleRelayout = useCallback(
    (event: Readonly<Record<string, unknown>>) => {
      if (!event) return;

      const updates: Record<number, { ax?: number; ay?: number; x?: number; y?: number }> = {};

      if (Array.isArray(event.annotations)) {
        event.annotations.forEach((ann, idx) => {
          if (ann && typeof ann === "object") {
            const a = ann as { ax?: unknown; ay?: unknown; x?: unknown; y?: unknown };
            const ax = a.ax;
            const ay = a.ay;
            const x = a.x;
            const y = a.y;
            const patch: { ax?: number; ay?: number; x?: number; y?: number } = {};
            if (typeof ax === "number" && Number.isFinite(ax)) patch.ax = ax;
            if (typeof ay === "number" && Number.isFinite(ay)) patch.ay = ay;
            if (typeof x === "number" && Number.isFinite(x)) patch.x = x;
            if (typeof y === "number" && Number.isFinite(y)) patch.y = y;
            if (Object.keys(patch).length > 0) updates[idx] = patch;
          }
        });
      }

      for (const [key, val] of Object.entries(event)) {
        const match = /^annotations\[(\d+)\](?:\.(ax|ay|x|y))?$/.exec(key);
        if (match) {
          const idx = parseInt(match[1], 10);
          const prop = match[2];
          if (!updates[idx]) {
            updates[idx] = { ...(labelOffsets[idx] ?? {}) };
          }
          if ((prop === "ax" || prop === "ay" || prop === "x" || prop === "y") && typeof val === "number" && Number.isFinite(val)) {
            updates[idx][prop] = val;
          } else if (!prop && val && typeof val === "object") {
            const v = val as { ax?: unknown; ay?: unknown; x?: unknown; y?: unknown };
            if (typeof v.ax === "number" && Number.isFinite(v.ax)) updates[idx].ax = v.ax;
            if (typeof v.ay === "number" && Number.isFinite(v.ay)) updates[idx].ay = v.ay;
            if (typeof v.x === "number" && Number.isFinite(v.x)) updates[idx].x = v.x;
            if (typeof v.y === "number" && Number.isFinite(v.y)) updates[idx].y = v.y;
          }
        }
      }

      if (Object.keys(updates).length > 0) {
        setLabelOffsets((prev) => {
          const next = { ...prev };
          for (const [idxStr, pos] of Object.entries(updates)) {
            const idx = Number(idxStr);
            next[idx] = { ...(next[idx] ?? {}), ...pos };
          }
          return next;
        });
      }
    },
    [labelOffsets],
  );

  const movedLabelCount = Object.keys(labelOffsets).length;

  return (
    <div className="card flex min-w-0 shrink-0 flex-col overflow-hidden p-3">
      {/* Tier 1: Title & Status Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-1 pb-1.5">
        <ChartCardTitle
          title={props.title ?? "MS1 Spectrum"}
          status={[
            s?.meta.rt_start != null && s.meta.rt_end != null
              ? `Region ${formatRt(s.meta.rt_start, props.rtUnit)} – ${formatRt(s.meta.rt_end, props.rtUnit)}`
              : props.selectedRt != null && `RT ${formatRt(props.selectedRt, props.rtUnit)}`,
            props.polarityBadge ??
              (s && (s.meta.polarity === "positive" ? "ESI+" : s.meta.polarity === "negative" ? "ESI-" : s.meta.polarity ?? "ESI")),
            (props.polymerEnabled || polymerLabelCount > 0) &&
              `${polymerLabelCount} polymer match${polymerLabelCount === 1 ? "" : "es"}`,
            s && `${s.meta.n_peaks.toLocaleString()} peaks`,
            s?.meta.n_scans != null && `${s.meta.n_scans.toLocaleString()} scans (${s.meta.merge_mode ?? "sum"})`,
            !!s?.meta.ignored_peak_count &&
              `ignored ${s.meta.ignored_peak_count} peak${s.meta.ignored_peak_count === 1 ? "" : "s"}`,
            props.showDragHint && !!s?.labels.length && "drag labels to reposition",
          ]}
        />
        {movedLabelCount > 0 && (
          <ToolbarButton
            icon={RotateCcw}
            label={`Reset positions (${movedLabelCount})`}
            title="Reset all repositioned peak labels back to default"
            onClick={() => {
              setLabelOffsets({});
              setLocalRevision((r) => r + 1);
            }}
          />
        )}
      </div>

      {/* Tier 2: Action Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ink-100/80 px-1 py-1.5">
        {/* Left Cluster: Polymer Studio and Deconvolution */}
        <div className="flex flex-wrap items-center gap-1.5">
          {props.onTogglePolymerStudio && (
            <button
              type="button"
              className="btn-primary whitespace-nowrap px-2.5 py-1"
              aria-pressed={props.polymerStudioOpen}
              onClick={props.onTogglePolymerStudio}
              title="Open Polymer & Reaction Studio (Live parameter tuning)"
            >
              <Hexagon {...ICON_PROPS} />
              <span>Polymer Studio</span>
              {props.polymerEnabled && (
                <span className="h-1.5 w-1.5 rounded-full bg-success" title="Matching is live on the spectrum" />
              )}
            </button>
          )}

          {props.onDeconvolution && (
            <button
              type="button"
              className="btn whitespace-nowrap border border-ink-200 bg-surface px-2.5 py-1 text-ink-800 hover:bg-ink-100 disabled:cursor-not-allowed disabled:opacity-40"
              onClick={props.onDeconvolution}
              disabled={!s}
              title="Deconvolute multi-charged ESI envelope and isotopic spacing to true neutral mass"
            >
              <Atom {...ICON_PROPS} />
              <span>Deconvolute</span>
            </button>
          )}

          {s && props.onPeakClick && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handlePickTargetMz();
              }}
              className="flex items-center"
            >
              <div className="flex items-center rounded-md border border-ink-200 bg-surface py-0.5 pl-2 pr-1 focus-within:border-brand-500 focus-within:ring-1 focus-within:ring-brand-500">
                <span className="text-caption mr-1 select-none">m/z</span>
                <input
                  type="number"
                  step="any"
                  value={targetMzInput}
                  onChange={(e) => setTargetMzInput(e.target.value)}
                  placeholder="e.g. 524.3"
                  aria-label="Target m/z"
                  className="w-20 bg-transparent font-mono text-[13px] text-ink-800 placeholder:text-ink-500 focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={!targetMzInput.trim()}
                  className="btn-ghost px-2 py-0.5 disabled:cursor-not-allowed disabled:opacity-40"
                  title="Inspect peak or create EIC for this m/z"
                >
                  Inspect
                </button>
              </div>
            </form>
          )}

          {s && props.onPeakClick && (
            <select
              className="input max-w-[200px] truncate py-1"
              aria-label="Select a detected peak"
              value=""
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                if (Number.isFinite(val)) {
                  handlePickTargetMz(val);
                }
              }}
              title="Pick a mass from detected peaks"
            >
              <option value="" disabled>
                Select peak ({topPeaks.length ? `${topPeaks.length} top` : `${s.labels.length || s.meta.n_peaks} peaks`})...
              </option>
              {(topPeaks.length > 0 ? topPeaks : visibleLabels.map((l) => ({ mz: l.mz, intensity: l.intensity, relIntensity: l.intensity / (activeBasePeak || 1), label: l.text }))).map((p) => (
                <option key={p.mz} value={p.mz}>
                  m/z {p.mz.toFixed(4)} ({Math.round(p.relIntensity * 100)}%){p.label ? ` - ${cleanLabelText(p.label)}` : ""}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Right Cluster: Quick Mode Pills, Design, Reload & Export */}
        <div className="flex items-center gap-1.5 shrink-0">
          <SegmentedControl
            size="xs"
            ariaLabel="Spectrum drag mode"
            value={interactionMode}
            onChange={setInteractionMode}
            options={[
              { value: "zoom", label: "Zoom", icon: <ZoomIn {...ICON_PROPS} />, title: "Standard box-zoom drag on spectrum canvas" },
              { value: "move", label: "Move labels", icon: <Hand {...ICON_PROPS} />, title: "Move peak labels freely without drawing zoom boxes" },
            ]}
          />
          {props.overlayTraces.length > 0 && props.onUpdateOverlayMode && (
            <SegmentedControl
              size="xs"
              ariaLabel="Overlay mode"
              value={overlayMode}
              onChange={(mode) => props.onUpdateOverlayMode?.(mode)}
              options={[
                { value: "overlay", label: "Overlay", title: "Standard overlaid spectra (raw intensity)" },
                { value: "butterfly", label: "Butterfly", title: "Mirrored butterfly plot (Head-to-Tail, raw AU)" },
                { value: "butterfly_normalized", label: "Butterfly %", title: "Mirrored butterfly plot normalized to base peak (Head-to-Tail, 0 to ±100%)" },
                { value: "normalized", label: "% Norm", title: "Normalize each spectrum to 0–100% base peak" },
              ]}
            />
          )}
          {props.onOpenDesign && (
            <ToolbarButton icon={Palette} label="Design" onClick={props.onOpenDesign} title="Configure MS1 spectrum appearance, colors & peak labels" />
          )}
          {props.onReload && (
            <ToolbarButton
              icon={RotateCw}
              label="Reload"
              title="Reload MS1 spectrum plot"
              onClick={() => {
                setLocalRevision((r) => r + 1);
                props.onReload?.();
              }}
            />
          )}
          <PaperFigureExportToolbar
            disabled={!s}
            storageKey="mfp-publication-plot-export-lcms-spectrum"
            currentSizePx={{ width: specPlotSize.width, height: specPlotSize.height }}
            onExport={savePublication}
          />
        </div>
      </div>
      {/* Tier 2.5: Top Peaks Quick-Pill Bar */}
      {s && topPeaks.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-ink-100/70 bg-ink-50/50 px-2 py-1.5 text-xs">
          <div className="text-section whitespace-nowrap">Top peaks</div>
          <div className="flex flex-wrap items-center gap-1.5">
            {topPeaks.map((peak) => {
              const pct = Math.round(peak.relIntensity * 100);
              return (
                <button
                  key={peak.mz}
                  type="button"
                  onClick={(e) => {
                    lastPeakClickTimeRef.current = Date.now();
                    props.onPeakClick?.(peak.mz, peak.intensity, e.nativeEvent);
                  }}
                  className={clsx(
                    "group inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 font-mono text-xs font-medium transition-all shadow-2xs cursor-pointer",
                    props.polarityBadge === "ESI-"
                      ? "border-rose-200 bg-surface text-ink-800 hover:border-rose-400 hover:bg-rose-50/80 hover:text-rose-900"
                      : "border-ink-200 bg-surface text-ink-800 hover:border-brand-300 hover:bg-brand-50/80 hover:text-brand-900",
                  )}
                  title={`m/z ${peak.mz.toFixed(4)}\nIntensity: ${peak.intensity.toExponential(3)} (${pct}%)\nClick to open Peak Actions (EIC, Deconvolute, Polymer Match)`}
                >
                  <span className="font-semibold text-ink-900 group-hover:text-brand-700">
                    {peak.mz.toFixed(4)}
                  </span>
                  <span className="text-[10px] text-ink-500 font-sans">
                    {pct >= 100 ? "100%" : `${pct}%`}
                  </span>
                  {peak.label && (
                    <span className="rounded bg-brand-100 px-1 text-[10px] font-sans font-semibold text-brand-700">
                      {peak.label}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
      {!s ? (
        <div className="flex h-72 items-center justify-center text-sm text-ink-500">
          {props.emptyMessage ?? "Click a point on the TIC to view the MS1 spectrum at that retention time."}
        </div>
      ) : (
        <div
          ref={specContainerRef}
          className="min-w-0 overflow-hidden relative select-none"
          style={{ height: props.settings.height }}
        >
          <Plot
            revision={specPlotSize.revision + localRevision}
            data={[
              {
                type: "bar",
                x: displayActive.mz,
                y: activeY,
                customdata: displayActive.intensity.map((v) => [v, (v / activeBasePeak) * 100]),
                width: props.settings.barWidth,
                marker: { color: props.colorOverride ?? themeTraceColor(props.settings.color, pt.theme) },
                ...exportColorMeta(props.colorOverride ?? props.settings.color),
                hovertemplate:
                  isNorm
                    ? "m/z: %{x:.4f}<br>rel: %{y:.1f}%<br>int: %{customdata[0]:.3e}<extra></extra>"
                    : "m/z: %{x:.4f}<br>int: %{y:.3e}<extra></extra>",
                name: props.overlayTraces.length > 0 ? "MS1 (Active)" : "MS1",
              },
              ...overlayData,
            ]}
            layout={{
              height: specPlotSize.height,
              width: specPlotSize.width,
              margin: { l: 65, r: 20, t: props.settings.title ? 28 : 20, b: 45 },
              title: props.settings.title
                ? {
                    text: props.settings.title,
                    font: { size: props.settings.titleSize },
                  }
                : undefined,
              font: { size: props.settings.tickSize, color: pt.screenFontColor },
              xaxis: {
                title: axisTitle(props.settings.xTitle, props.settings.axisTitleSize),
                zeroline: false,
                showgrid: props.settings.showGrid,
                range: axisRange(props.settings.axis.xMin, props.settings.axis.xMax),
                tickfont: { size: props.settings.tickSize },
                ...axisFrame(props.settings),
              },
              yaxis: {
                title: axisTitle(
                  props.settings.yTitle ||
                    (overlayMode === "butterfly_normalized"
                      ? "MS1 (% Base Peak) [Top: Active (+100%) / Bottom: Overlay (-100%)]"
                      : overlayMode === "butterfly"
                      ? "Intensity (AU) [Top: Active / Bottom: Overlay]"
                      : overlayMode === "normalized"
                      ? "MS1 (% Base Peak)"
                      : "Intensity (AU)"),
                  props.settings.axisTitleSize,
                ),
                zeroline: isButterfly,
                zerolinecolor: isButterfly ? "#94a3b8" : undefined,
                zerolinewidth: isButterfly ? 1.5 : undefined,
                exponentformat: "power",
                showgrid: props.settings.showGrid,
                range:
                  isButterfly
                    ? undefined
                    : overlayMode === "normalized"
                    ? axisRange(props.settings.axis.yMin, props.settings.axis.yMax)
                    : axisRange(props.settings.axis.yMin, props.settings.axis.yMax),
                tickfont: { size: props.settings.tickSize },
                ...axisFrame(props.settings),
              },
              annotations: props.annotate
                ? [
                    ...visibleLabels.map((lbl, lblIdx) => {
                      const isPoly = lbl.source === "polymer";
                      const polyCfg = props.settings.polymerLabels ?? DEFAULT_POLYMER_LABEL_SETTINGS;
                      const isVertical = isPoly && polyCfg.orientation === "vertical";
                      const showBox = isPoly ? polyCfg.showBox : false;
                      const showArrow = isPoly ? (polyCfg.showArrow ?? true) : false;
                      const color = isPoly ? (polyCfg.color || "#7c3aed") : props.settings.labels.color;
                      const fontSize = isPoly ? (polyCfg.fontSize || 10) : props.settings.labels.fontSize;

                      const labelY = isNorm ? (lbl.intensity / activeBasePeak) * 100 : lbl.intensity;
                      const defaultAx = 0;
                      const defaultAy = isPoly ? (isVertical ? -46 : -34) : (isVertical ? -36 : -18);
                      const offset = labelOffsets[lblIdx];
                      const isDragged = offset != null && (
                        (offset.ax != null && Math.abs(offset.ax - defaultAx) > 2) ||
                        (offset.ay != null && Math.abs(offset.ay - defaultAy) > 2) ||
                        offset.x != null ||
                        offset.y != null
                      );

                      return {
                        x: offset?.x ?? lbl.mz,
                        y: offset?.y ?? labelY,
                        text: lbl.text ? cleanLabelText(lbl.text) : lbl.mz.toFixed(4),
                        textangle: isVertical ? ("-90" as const) : ("0" as const),
                        showarrow: true,
                        arrowhead: isDragged ? 2 : (showArrow ? 2 : 0),
                        arrowsize: 0.8,
                        arrowwidth: isDragged ? 1 : (showArrow ? 1 : 0),
                        arrowcolor: isDragged ? color : (showArrow ? color : "rgba(0,0,0,0)"),
                        ax: offset?.ax ?? defaultAx,
                        ay: offset?.ay ?? defaultAy,
                        yshift: 0,
                        bgcolor: showBox ? hexToRgba(color, 0.12) : isDragged ? "rgba(255, 255, 255, 0.9)" : undefined,
                        bordercolor: showBox ? color : undefined,
                        borderpad: showBox ? 2 : undefined,
                        font: {
                          size: fontSize,
                          color: color,
                        },
                      };
                    }),
                    ...overlayAnnotations.map((ann, oIdx) => {
                      const annIdx = visibleLabels.length + oIdx;
                      const offset = labelOffsets[annIdx];
                      if (!offset) return ann;
                      return {
                        ...ann,
                        x: offset.x ?? ann.x,
                        y: offset.y ?? ann.y,
                        showarrow: true,
                        arrowhead: 2,
                        arrowsize: 0.8,
                        arrowwidth: 1,
                        ax: offset.ax ?? ann.ax,
                        ay: offset.ay ?? ann.ay,
                        yshift: 0,
                        bgcolor: ann.bgcolor ?? "rgba(255, 255, 255, 0.9)",
                        bordercolor: ann.bordercolor,
                        borderpad: ann.borderpad,
                      };
                    }),
                  ]
                : [],
              colorway: pt.colorway,
              plot_bgcolor: pt.plot_bgcolor,
              paper_bgcolor: pt.paper_bgcolor,
              showlegend: overlayData.length > 0,
              barmode: "overlay",
              bargap: 0,
              dragmode: interactionMode === "move" ? "pan" : "zoom",
              hovermode: "closest",
              hoverdistance: 30,
            }}
            config={{
              responsive: true,
              displaylogo: false,
              editable: interactionMode === "move" || props.showDragHint,
              edits: {
                annotationPosition: interactionMode === "move" || props.showDragHint,
                annotationText: false,
                axisTitleText: false,
                titleText: false,
              },
            }}
            style={{ width: "100%", height: "100%", minWidth: 0 }}
            useResizeHandler
            onClick={handleSpectrumClick}
            onRelayout={handleRelayout}
            onInitialized={(_figure, graphDiv) => {
              specPlotRef.current = graphDiv as PlotlyHTMLElement;
              queuePlotlyElementResize(specPlotRef.current);
            }}
            onUpdate={(_figure, graphDiv) => {
              specPlotRef.current = graphDiv as PlotlyHTMLElement;
            }}
          />
        </div>
      )}
    </div>
  );
}
