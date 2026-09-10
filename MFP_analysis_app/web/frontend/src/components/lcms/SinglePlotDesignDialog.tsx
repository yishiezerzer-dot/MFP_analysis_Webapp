import { useState } from "react";
import clsx from "clsx";
import {
  DEFAULT_OVERLAY_LABEL_SETTINGS,
  DEFAULT_POLYMER_LABEL_SETTINGS,
  OVERLAY_PALETTE,
  type AxisLimits,
  type ChartOverlaySettings,
  type ChartSettings,
  type EICOverlaySettings,
  type FrameMode,
  type GraphId,
  type GraphSettings,
  type LabelSettings,
  type OverlayLabelSettings,
  type PolymerLabelSettings,
} from "../../lcms/settings";
import {
  Check,
  ColorSetting,
  GroupBox,
  Modal,
  NumberSetting,
  Row,
  SelectSetting,
  TextSetting,
} from "./DialogControls";

export interface SinglePlotDesignDialogProps {
  graphId: GraphId;
  settings: GraphSettings;
  onChange: (updater: (prev: GraphSettings) => GraphSettings) => void;
  overlayEicEnabled?: boolean;
  setOverlayEicEnabled?: (value: boolean) => void;
  overlayTraceNames?: string[];
  overlaySessions?: Array<{ sessionId: string; displayName: string }>;
  onSetDefault: () => void;
  onReset: () => void;
  onClose: () => void;
}

const PLOT_LABELS: Record<GraphId, { title: string; desc: string }> = {
  tic: {
    title: "Total Ion Chromatogram (TIC)",
    desc: "Configure TIC line color, dimensions, axis titles, and scale limits.",
  },
  eic: {
    title: "Extracted Ion Chromatogram (EIC)",
    desc: "Configure EIC line color, dimensions, axis limits, and multi-trace overlay behavior.",
  },
  uv: {
    title: "UV Chromatogram",
    desc: "Configure UV trace styling, peak label font size, colors, and connector lines.",
  },
  spectrum: {
    title: "MS1 Spectrum",
    desc: "Configure MS1 stick plot bar color, width, peak m/z label formatting, and limits.",
  },
};

export function SinglePlotDesignDialog({
  graphId,
  settings,
  onChange,
  overlayEicEnabled = false,
  setOverlayEicEnabled,
  overlayTraceNames = [],
  overlaySessions = [],
  onSetDefault,
  onReset,
  onClose,
}: SinglePlotDesignDialogProps) {
  const meta = PLOT_LABELS[graphId] ?? {
    title: "Plot Design",
    desc: "Configure plot design and appearance.",
  };
  const s = settings[graphId];

  const updateChart = (patch: Partial<ChartSettings>) => {
    onChange((prev) => ({ ...prev, [graphId]: { ...prev[graphId], ...patch } }));
  };

  const updateAxis = (patch: Partial<AxisLimits>) => {
    onChange((prev) => ({
      ...prev,
      [graphId]: { ...prev[graphId], axis: { ...prev[graphId].axis, ...patch } },
    }));
  };

  const updateLabels = (patch: Partial<LabelSettings>) => {
    onChange((prev) => ({
      ...prev,
      [graphId]: { ...prev[graphId], labels: { ...prev[graphId].labels, ...patch } },
    }));
  };

  const polySettings = s.polymerLabels ?? DEFAULT_POLYMER_LABEL_SETTINGS;

  const updatePolymerLabels = (patch: Partial<PolymerLabelSettings>) => {
    onChange((prev) => ({
      ...prev,
      [graphId]: {
        ...prev[graphId],
        polymerLabels: {
          ...(prev[graphId].polymerLabels ?? DEFAULT_POLYMER_LABEL_SETTINGS),
          ...patch,
        },
      },
    }));
  };

  const updateEicOverlay = (patch: Partial<EICOverlaySettings>) => {
    onChange((prev) => ({
      ...prev,
      eicOverlay: { ...prev.eicOverlay, ...patch },
    }));
  };

  const overlayCfg = s.overlaySettings ?? {};

  const updateOverlaySettings = (patch: Partial<ChartOverlaySettings>) => {
    onChange((prev) => ({
      ...prev,
      [graphId]: {
        ...prev[graphId],
        overlaySettings: { ...(prev[graphId].overlaySettings ?? {}), ...patch },
      },
    }));
  };

  const overlayLabels = s.overlayLabels ?? DEFAULT_OVERLAY_LABEL_SETTINGS;

  const updateOverlayLabels = (patch: Partial<OverlayLabelSettings>) => {
    onChange((prev) => ({
      ...prev,
      [graphId]: {
        ...prev[graphId],
        overlayLabels: {
          ...(prev[graphId].overlayLabels ?? DEFAULT_OVERLAY_LABEL_SETTINGS),
          ...patch,
        },
      },
    }));
  };

  const hasLabels = graphId === "spectrum" || graphId === "uv";
  const tabs = [
    { id: "layout" as const, label: "Layout & Titles", icon: "📐" },
    { id: "traces" as const, label: "Traces & Overlays", icon: "🎨" },
    ...(hasLabels ? [{ id: "labels" as const, label: "Peak Labels", icon: "🏷️" }] : []),
    { id: "axes" as const, label: "Axes & Limits", icon: "📏" },
  ];
  const [activeTab, setActiveTab] = useState<"layout" | "traces" | "labels" | "axes">("layout");

  return (
    <Modal
      title={`🎨 ${meta.title} Design`}
      onClose={onClose}
      width="max-w-2xl"
      footer={
        <div className="flex w-full items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded-md border border-ink-200 bg-surface px-3 py-1.5 text-xs text-ink-700 hover:bg-ink-100"
              onClick={onReset}
            >
              Reset defaults
            </button>
            <button
              type="button"
              className="rounded-md border border-brand-200 bg-brand-50 px-3 py-1.5 text-xs font-medium text-brand-700 hover:bg-brand-100"
              onClick={onSetDefault}
            >
              Set current as default
            </button>
          </div>
          <button type="button" className="btn-primary text-xs" onClick={onClose}>
            Done
          </button>
        </div>
      }
    >
      <div className="mb-4 text-xs text-ink-600">{meta.desc}</div>

      {/* Tab Navigation */}
      <div className="mb-4 flex flex-wrap items-center gap-1.5 border-b border-ink-100 pb-2.5">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className={clsx(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              activeTab === t.id
                ? "bg-brand-50 font-semibold text-brand-700 shadow-xs border border-brand-200"
                : "text-ink-600 hover:bg-ink-100 hover:text-ink-900 border border-transparent",
            )}
            onClick={() => setActiveTab(t.id)}
          >
            <span>{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-4">
        {/* Layout & Dimensions */}
        <div className={activeTab === "layout" ? undefined : "hidden"}>
        <GroupBox title="Layout & Grid">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <label className="flex items-center gap-2 text-xs text-ink-700 cursor-pointer select-none">
              <input
                type="checkbox"
                className="rounded border-ink-300 text-brand-600 focus:ring-brand-500"
                checked={s.showGrid}
                onChange={(e) => updateChart({ showGrid: e.target.checked })}
              />
              <span>Gridlines</span>
            </label>
            <label className="flex items-center gap-2 text-xs text-ink-700 cursor-pointer select-none">
              <input
                type="checkbox"
                className="rounded border-ink-300 text-brand-600 focus:ring-brand-500"
                checked={s.showScaleBars}
                onChange={(e) => updateChart({ showScaleBars: e.target.checked })}
              />
              <span>Axis scale bars</span>
            </label>
          </div>

          <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <NumberSetting
              label="Plot height (px)"
              value={s.height}
              min={180}
              max={900}
              step={10}
              onChange={(value) => updateChart({ height: value ?? s.height })}
            />
            <SelectSetting
              label="Border frame"
              value={s.frameMode}
              options={[
                { value: "none", label: "No frame" },
                { value: "half", label: "Half frame (L-shape)" },
                { value: "full", label: "Full frame (Box)" },
              ]}
              onChange={(value) => updateChart({ frameMode: value as FrameMode })}
            />
          </div>
        </GroupBox>
        </div>

        {/* Trace Styling */}
        <div className={activeTab === "traces" ? undefined : "hidden"}>
        <GroupBox title={graphId === "spectrum" ? "Bar Appearance" : "Line Appearance"}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <ColorSetting
              label={graphId === "spectrum" ? "Bar color" : "Line color"}
              value={s.color}
              onChange={(value) => updateChart({ color: value })}
            />
            {graphId === "spectrum" ? (
              <NumberSetting
                label="Bar width"
                value={s.barWidth}
                min={0.05}
                max={5}
                step={0.05}
                onChange={(value) => updateChart({ barWidth: value ?? s.barWidth })}
              />
            ) : (
              <NumberSetting
                label="Line width"
                value={s.lineWidth}
                min={0.5}
                max={6}
                step={0.25}
                onChange={(value) => updateChart({ lineWidth: value ?? s.lineWidth })}
              />
            )}
          </div>
        </GroupBox>
        </div>

        {/* Overlay Configuration & Comparison Modes */}
        <div className={activeTab === "traces" ? undefined : "hidden"}>
        {(graphId === "tic" || graphId === "uv" || graphId === "spectrum") && (
          <GroupBox title="Overlay & Multi-Trace Settings">
            <p className="mb-2 text-[11px] text-ink-500">
              Control visualization modes, stacking, opacity, and peak alignment when multiple traces/files are compared.
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {(graphId === "tic" || graphId === "uv") && (
                <SelectSetting
                  label="Display mode"
                  value={
                    overlayCfg.mode === "normalized" || overlayCfg.chromatogramMode === "normalized"
                      ? "normalized"
                      : overlayCfg.mode === "stacked" || overlayCfg.chromatogramMode === "stacked"
                      ? "stacked"
                      : "raw"
                  }
                  options={[
                    { value: "raw", label: "Standard Overlay (Shared Axis)" },
                    { value: "normalized", label: "Normalized (% Base Peak 0–100%)" },
                    { value: "stacked", label: "Stacked / Waterfall" },
                  ]}
                  onChange={(v) =>
                    updateOverlaySettings({
                      mode: v as any,
                      chromatogramMode: v as any,
                    })
                  }
                />
              )}
              {graphId === "spectrum" && (
                <SelectSetting
                  label="Display mode"
                  value={
                    overlayCfg.mode === "butterfly_normalized" || overlayCfg.spectrumMode === "butterfly_normalized"
                      ? "butterfly_normalized"
                      : overlayCfg.mode === "butterfly" || overlayCfg.spectrumMode === "butterfly"
                      ? "butterfly"
                      : overlayCfg.mode === "normalized" || overlayCfg.spectrumMode === "normalized"
                      ? "normalized"
                      : "raw"
                  }
                  options={[
                    { value: "raw", label: "Standard Overlay (Shared bars)" },
                    { value: "butterfly", label: "Mirrored / Butterfly (Head-to-Tail, absolute AU)" },
                    { value: "butterfly_normalized", label: "Mirrored / Butterfly % (Head-to-Tail, 0 to ±100% Base Peak)" },
                    { value: "normalized", label: "Normalized (% Base Peak 0–100%)" },
                  ]}
                  onChange={(v) =>
                    updateOverlaySettings({
                      mode: v as any,
                      spectrumMode: (v === "raw" ? "overlay" : v) as any,
                    })
                  }
                />
              )}
              <NumberSetting
                label="Trace opacity"
                value={overlayCfg.opacity ?? overlayCfg.traceOpacity ?? 0.85}
                min={0.1}
                max={1.0}
                step={0.05}
                onChange={(v) =>
                  updateOverlaySettings({
                    opacity: v ?? 0.85,
                    traceOpacity: v ?? 0.85,
                  })
                }
              />
              {(graphId === "tic" || graphId === "uv") &&
                (overlayCfg.mode === "stacked" || overlayCfg.chromatogramMode === "stacked") && (
                  <NumberSetting
                    label="Stacking gap (% offset)"
                    value={overlayCfg.stackGap ?? overlayCfg.stackingGapPercent ?? 15}
                    min={5}
                    max={100}
                    step={5}
                    onChange={(v) =>
                      updateOverlaySettings({
                        stackGap: v ?? 15,
                        stackingGapPercent: v ?? 15,
                      })
                    }
                  />
                )}
            </div>

            {graphId === "spectrum" && (
              <div className="mt-2 flex flex-col gap-2 rounded border border-ink-100 bg-ink-50/40 p-2.5">
                <Check
                  label="Snap comparison spectrum to nearest local TIC apex"
                  checked={overlayCfg.snapApex ?? false}
                  onChange={(v) => updateOverlaySettings({ snapApex: v })}
                />
                {overlayCfg.snapApex && (
                  <div className="w-full sm:w-1/2">
                    <NumberSetting
                      label="Apex search window (± min)"
                      value={overlayCfg.snapToleranceMin ?? 0.05}
                      min={0.01}
                      max={0.5}
                      step={0.01}
                      onChange={(v) =>
                        updateOverlaySettings({ snapToleranceMin: v ?? 0.05 })
                      }
                    />
                  </div>
                )}
              </div>
            )}
          </GroupBox>
        )}
        </div>

        {/* Overlay Peak Labels */}
        <div className={activeTab === "labels" ? undefined : "hidden"}>
        {(graphId === "spectrum" || graphId === "uv") &&
          ((overlaySessions && overlaySessions.length > 0) ||
            (overlayTraceNames && overlayTraceNames.length > 0)) && (
            <GroupBox title="Overlay Peak Labels">
              <p className="mb-2.5 text-[11px] text-ink-500">
                Customize the orientation, box, font size, and color of overlaid peak labels.
              </p>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <label className="flex items-center gap-2 text-xs text-ink-700 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    className="rounded border-ink-300 text-brand-600 focus:ring-brand-500"
                    checked={overlayLabels.enabled}
                    onChange={(e) => updateOverlayLabels({ enabled: e.target.checked })}
                  />
                  <span className="font-medium">Enable overlay peak annotations</span>
                </label>
                <label className="flex items-center gap-2 text-xs text-ink-700 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    className="rounded border-ink-300 text-brand-600 focus:ring-brand-500"
                    checked={overlayLabels.useTraceColor}
                    onChange={(e) => updateOverlayLabels({ useTraceColor: e.target.checked })}
                  />
                  <span>Match each overlay's trace color</span>
                </label>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {!overlayLabels.useTraceColor && (
                  <ColorSetting
                    label="Label & accent color"
                    value={overlayLabels.color}
                    onChange={(value) => updateOverlayLabels({ color: value })}
                  />
                )}
                <NumberSetting
                  label="Font size"
                  value={overlayLabels.fontSize}
                  min={6}
                  max={24}
                  step={1}
                  onChange={(value) =>
                    updateOverlayLabels({ fontSize: value ?? overlayLabels.fontSize })
                  }
                />
                <SelectSetting
                  label="Text orientation"
                  value={overlayLabels.orientation}
                  options={[
                    { value: "horizontal", label: "Horizontal (0°)" },
                    { value: "vertical", label: "Vertical (-90°)" },
                  ]}
                  onChange={(value) =>
                    updateOverlayLabels({ orientation: value as "horizontal" | "vertical" })
                  }
                />
                <div className="flex flex-col justify-center gap-2 pt-1">
                  <label className="flex items-center gap-2 text-xs text-ink-700 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      className="rounded border-ink-300 text-brand-600 focus:ring-brand-500"
                      checked={overlayLabels.showBox ?? true}
                      onChange={(e) => updateOverlayLabels({ showBox: e.target.checked })}
                    />
                    <span>Show surrounding box</span>
                  </label>
                  <label className="flex items-center gap-2 text-xs text-ink-700 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      className="rounded border-ink-300 text-brand-600 focus:ring-brand-500"
                      checked={overlayLabels.showArrow ?? true}
                      onChange={(e) => updateOverlayLabels({ showArrow: e.target.checked })}
                    />
                    <span>Show arrow pointer to peak</span>
                  </label>
                </div>
              </div>
            </GroupBox>
          )}
        </div>

        {/* Overlay Trace Colors */}
        <div className={activeTab === "traces" ? undefined : "hidden"}>
        {((overlaySessions && overlaySessions.length > 0) ||
          (overlayTraceNames && overlayTraceNames.length > 0)) && (
          <GroupBox title="Overlay Trace Colors">
            <p className="mb-2.5 text-[11px] text-ink-500">
              Customize line/bar colors and peak label colors for each overlaid trace.
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {overlaySessions && overlaySessions.length > 0
                ? overlaySessions.map((sess, i) => {
                    const currentColor =
                      s.overlayColorsBySessionId?.[sess.sessionId] ??
                      s.overlayColors?.[i] ??
                      OVERLAY_PALETTE[i % OVERLAY_PALETTE.length];
                    const currentLabelColor =
                      overlayLabels.colorsBySessionId?.[sess.sessionId] ?? currentColor;
                    return (
                      <div
                        key={sess.sessionId}
                        className="flex flex-col gap-2 rounded-lg border border-ink-200/80 bg-ink-50/40 p-2.5"
                      >
                        <div
                          className="text-xs font-semibold text-ink-800 truncate"
                          title={sess.displayName}
                        >
                          Overlay {i + 1}: {sess.displayName}
                        </div>
                        <div className="flex flex-col gap-2">
                          <ColorSetting
                            label="Trace color"
                            value={currentColor}
                            onChange={(newColor) => {
                              const updated = [
                                ...(s.overlayColors ??
                                  OVERLAY_PALETTE.slice(0, overlaySessions.length)),
                              ];
                              while (updated.length <= i) {
                                updated.push(
                                  OVERLAY_PALETTE[
                                    updated.length % OVERLAY_PALETTE.length
                                  ],
                                );
                              }
                              updated[i] = newColor;
                              updateChart({
                                overlayColors: updated,
                                overlayColorsBySessionId: {
                                  ...(s.overlayColorsBySessionId ?? {}),
                                  [sess.sessionId]: newColor,
                                },
                              });
                            }}
                          />
                          {(graphId === "spectrum" || graphId === "uv") && (
                            <ColorSetting
                              label="Peak label color"
                              value={currentLabelColor}
                              onChange={(newLabelColor) => {
                                updateOverlayLabels({
                                  colorsBySessionId: {
                                    ...(overlayLabels.colorsBySessionId ?? {}),
                                    [sess.sessionId]: newLabelColor,
                                  },
                                });
                              }}
                            />
                          )}
                        </div>
                      </div>
                    );
                  })
                : overlayTraceNames.map((name, i) => {
                    const currentColor =
                      s.overlayColors?.[i] ?? OVERLAY_PALETTE[i % OVERLAY_PALETTE.length];
                    return (
                      <ColorSetting
                        key={i}
                        label={`Overlay ${i + 1}: ${name}`}
                        value={currentColor}
                        onChange={(newColor) => {
                          const updated = [
                            ...(s.overlayColors ??
                              OVERLAY_PALETTE.slice(0, overlayTraceNames.length)),
                          ];
                          while (updated.length <= i) {
                            updated.push(
                              OVERLAY_PALETTE[
                                updated.length % OVERLAY_PALETTE.length
                              ],
                            );
                          }
                          updated[i] = newColor;
                          updateChart({ overlayColors: updated });
                        }}
                      />
                    );
                  })}
            </div>
          </GroupBox>
        )}
        </div>

        {/* Titles & Typography */}
        <div className={activeTab === "layout" ? undefined : "hidden"}>
        <GroupBox title="Titles & Typography">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <TextSetting
              label="Graph title"
              value={s.title}
              placeholder="Auto-generated or custom title"
              onChange={(value) => updateChart({ title: value })}
            />
            <NumberSetting
              label="Title font size"
              value={s.titleSize}
              min={8}
              max={30}
              step={1}
              onChange={(value) => updateChart({ titleSize: value ?? s.titleSize })}
            />
            <TextSetting
              label="X-axis title"
              value={s.xTitle}
              onChange={(value) => updateChart({ xTitle: value })}
            />
            <TextSetting
              label="Y-axis title"
              value={s.yTitle}
              onChange={(value) => updateChart({ yTitle: value })}
            />
            <NumberSetting
              label="Axis label font size"
              value={s.axisTitleSize}
              min={8}
              max={28}
              step={1}
              onChange={(value) => updateChart({ axisTitleSize: value ?? s.axisTitleSize })}
            />
            <NumberSetting
              label="Tick mark font size"
              value={s.tickSize}
              min={8}
              max={24}
              step={1}
              onChange={(value) => updateChart({ tickSize: value ?? s.tickSize })}
            />
          </div>
        </GroupBox>
        </div>

        {/* Axis Limits */}
        <div className={activeTab === "axes" ? undefined : "hidden"}>
        <GroupBox title="Axis Limits">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <NumberSetting
              label="X min"
              value={s.axis.xMin}
              nullable
              onChange={(value) => updateAxis({ xMin: value })}
            />
            <NumberSetting
              label="X max"
              value={s.axis.xMax}
              nullable
              onChange={(value) => updateAxis({ xMax: value })}
            />
            <NumberSetting
              label="Y min"
              value={s.axis.yMin}
              nullable
              onChange={(value) => updateAxis({ yMin: value })}
            />
            <NumberSetting
              label="Y max"
              value={s.axis.yMax}
              nullable
              onChange={(value) => updateAxis({ yMax: value })}
            />
          </div>
          <p className="mt-1 text-[11px] text-ink-500">
            Leave blank to allow Plotly to dynamically auto-scale to visible data.
          </p>
        </GroupBox>
        </div>

        {/* Plot-specific: Spectrum Peak Labels */}
        <div className={activeTab === "labels" ? undefined : "hidden"}>
        {graphId === "spectrum" && (
          <GroupBox title="MS Peak Labels">
            <div className="mb-2">
              <label className="flex items-center gap-2 text-xs text-ink-700 cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="rounded border-ink-300 text-brand-600 focus:ring-brand-500"
                  checked={s.labels.enabled}
                  onChange={(e) => updateLabels({ enabled: e.target.checked })}
                />
                <span className="font-medium">Enable spectrum peak annotations</span>
              </label>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <NumberSetting
                label="Label font size"
                value={s.labels.fontSize}
                min={6}
                max={24}
                step={1}
                onChange={(value) =>
                  updateLabels({ fontSize: value ?? s.labels.fontSize })
                }
              />
              <ColorSetting
                label="Label color"
                value={s.labels.color}
                onChange={(value) => updateLabels({ color: value })}
              />
            </div>
          </GroupBox>
        )}
        </div>

        {/* Plot-specific: Polymer Match Labels */}
        <div className={activeTab === "labels" ? undefined : "hidden"}>
        {graphId === "spectrum" && (
          <GroupBox title="Polymer Match Labels">
            <p className="mb-2.5 text-[11px] text-ink-500">
              Customize the orientation, box, font size, and color of matched polymer peak labels.
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <ColorSetting
                label="Label & accent color"
                value={polySettings.color}
                onChange={(value) => updatePolymerLabels({ color: value })}
              />
              <NumberSetting
                label="Font size"
                value={polySettings.fontSize}
                min={6}
                max={24}
                step={1}
                onChange={(value) =>
                  updatePolymerLabels({ fontSize: value ?? polySettings.fontSize })
                }
              />
              <SelectSetting
                label="Text orientation"
                value={polySettings.orientation}
                options={[
                  { value: "horizontal", label: "Horizontal (0°)" },
                  { value: "vertical", label: "Vertical (-90°)" },
                ]}
                onChange={(value) =>
                  updatePolymerLabels({ orientation: value as "horizontal" | "vertical" })
                }
              />
              <div className="flex flex-col justify-center gap-2 pt-1">
                <label className="flex items-center gap-2 text-xs text-ink-700 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    className="rounded border-ink-300 text-brand-600 focus:ring-brand-500"
                    checked={polySettings.showBox}
                    onChange={(e) => updatePolymerLabels({ showBox: e.target.checked })}
                  />
                  <span>Show surrounding box</span>
                </label>
                <label className="flex items-center gap-2 text-xs text-ink-700 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    className="rounded border-ink-300 text-brand-600 focus:ring-brand-500"
                    checked={polySettings.showArrow}
                    onChange={(e) => updatePolymerLabels({ showArrow: e.target.checked })}
                  />
                  <span>Show arrow pointer to peak</span>
                </label>
              </div>
            </div>
          </GroupBox>
        )}
        </div>

        {/* Plot-specific: UV Labels & Connectors */}
        <div className={activeTab === "labels" ? undefined : "hidden"}>
        {graphId === "uv" && (
          <GroupBox title="UV Peak Labels & Connectors">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <NumberSetting
                label="Label font size"
                value={s.labels.fontSize}
                min={6}
                max={24}
                step={1}
                onChange={(value) =>
                  updateLabels({ fontSize: value ?? s.labels.fontSize })
                }
              />
              <ColorSetting
                label="Label text color"
                value={s.labels.color}
                onChange={(value) => updateLabels({ color: value })}
              />
              <ColorSetting
                label="Connector line color"
                value={s.annotationConnectorColor ?? "#334155"}
                onChange={(value) => updateChart({ annotationConnectorColor: value })}
              />
              <NumberSetting
                label="Connector line opacity"
                value={s.annotationConnectorOpacity ?? 0.7}
                min={0}
                max={1}
                step={0.05}
                onChange={(value) =>
                  updateChart({
                    annotationConnectorOpacity: Math.min(1, Math.max(0, value ?? 0.7)),
                  })
                }
              />
            </div>
          </GroupBox>
        )}
        </div>

        {/* Plot-specific: EIC Multi-trace Overlay */}
        <div className={activeTab === "traces" ? undefined : "hidden"}>
        {graphId === "eic" && (
          <GroupBox title="EIC Overlay & Stacking">
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {setOverlayEicEnabled && (
                <label className="flex items-center gap-2 text-xs text-ink-700 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    className="rounded border-ink-300 text-brand-600 focus:ring-brand-500"
                    checked={overlayEicEnabled}
                    onChange={(e) => setOverlayEicEnabled(e.target.checked)}
                  />
                  <span>Overlay generated EICs</span>
                </label>
              )}
              <label className="flex items-center gap-2 text-xs text-ink-700 cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="rounded border-ink-300 text-brand-600 focus:ring-brand-500"
                  checked={settings.eicOverlay.showLegend}
                  onChange={(e) => updateEicOverlay({ showLegend: e.target.checked })}
                />
                <span>Show trace legend</span>
              </label>
              <label className="flex items-center gap-2 text-xs text-ink-700 cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="rounded border-ink-300 text-brand-600 focus:ring-brand-500"
                  checked={settings.eicOverlay.normalize}
                  onChange={(e) => updateEicOverlay({ normalize: e.target.checked })}
                />
                <span>Normalize each trace to 100%</span>
              </label>
              <label className="flex items-center gap-2 text-xs text-ink-700 cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="rounded border-ink-300 text-brand-600 focus:ring-brand-500"
                  checked={settings.eicOverlay.stack}
                  onChange={(e) => updateEicOverlay({ stack: e.target.checked })}
                />
                <span>Stack traces vertically</span>
              </label>
            </div>
            <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <NumberSetting
                label="Overlay opacity"
                value={settings.eicOverlay.opacity}
                min={0.1}
                max={1}
                step={0.05}
                onChange={(value) =>
                  updateEicOverlay({ opacity: Math.min(1, Math.max(0.1, value ?? 0.9)) })
                }
              />
              <NumberSetting
                label="Stack gap (%)"
                value={settings.eicOverlay.stackGap}
                min={10}
                max={300}
                step={5}
                onChange={(value) =>
                  updateEicOverlay({ stackGap: Math.max(10, value ?? 110) })
                }
              />
            </div>
          </GroupBox>
        )}
        </div>
      </div>
    </Modal>
  );
}
