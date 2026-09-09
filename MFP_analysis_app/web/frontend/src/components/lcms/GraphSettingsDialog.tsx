import {
  DEFAULT_POLYMER_LABEL_SETTINGS,
  type AxisLimits,
  type ChartSettings,
  type EICOverlaySettings,
  type FrameMode,
  type GraphId,
  type GraphSettings,
  type LabelSettings,
  type PolymerLabelSettings,
} from "../../lcms/settings";
import {
  ColorSetting,
  Modal,
  NumberSetting,
  SelectSetting,
  TextSetting,
} from "./DialogControls";

export function GraphSettingsDialog({
  settings,
  onChange,
  overlayEicEnabled,
  setOverlayEicEnabled,
  onSetDefault,
  onReset,
  onClose,
}: {
  settings: GraphSettings;
  onChange: (updater: (prev: GraphSettings) => GraphSettings) => void;
  overlayEicEnabled: boolean;
  setOverlayEicEnabled: (value: boolean) => void;
  onSetDefault: () => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const updateChart = (id: GraphId, patch: Partial<ChartSettings>) => {
    onChange((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  };
  const updateAxis = (id: GraphId, patch: Partial<AxisLimits>) => {
    onChange((prev) => ({
      ...prev,
      [id]: { ...prev[id], axis: { ...prev[id].axis, ...patch } },
    }));
  };
  const updateLabels = (id: GraphId, patch: Partial<LabelSettings>) => {
    onChange((prev) => ({
      ...prev,
      [id]: { ...prev[id], labels: { ...prev[id].labels, ...patch } },
    }));
  };
  const updatePolymerLabels = (id: GraphId, patch: Partial<PolymerLabelSettings>) => {
    onChange((prev) => ({
      ...prev,
      [id]: {
        ...prev[id],
        polymerLabels: {
          ...(prev[id].polymerLabels ?? DEFAULT_POLYMER_LABEL_SETTINGS),
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

  const section = (id: GraphId, label: string) => {
    const s = settings[id];
    const labelsAvailable = id === "spectrum" || id === "uv";
    const labelControlsTitle = id === "uv" ? "UV labels" : "Peak labels";
    return (
      <section className="rounded-lg border border-ink-200 bg-surface p-4" key={id}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">{label}</h3>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-xs text-ink-600">
              <input
                type="checkbox"
                checked={s.showGrid}
                onChange={(e) => updateChart(id, { showGrid: e.target.checked })}
              />
              Grid
            </label>
            <label className="flex items-center gap-2 text-xs text-ink-600">
              <input
                type="checkbox"
                checked={s.showScaleBars}
                onChange={(e) =>
                  updateChart(id, { showScaleBars: e.target.checked })
                }
              />
              Axis scale bars
            </label>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <TextSetting
            label="Graph title"
            value={s.title}
            placeholder="No title"
            onChange={(value) => updateChart(id, { title: value })}
          />
          <NumberSetting
            label="Height (px)"
            value={s.height}
            min={180}
            max={900}
            step={10}
            onChange={(value) => updateChart(id, { height: value ?? s.height })}
          />
          <TextSetting
            label="X-axis title"
            value={s.xTitle}
            onChange={(value) => updateChart(id, { xTitle: value })}
          />
          <TextSetting
            label="Y-axis title"
            value={s.yTitle}
            onChange={(value) => updateChart(id, { yTitle: value })}
          />
          <ColorSetting
            label={id === "spectrum" ? "Bar color" : "Line color"}
            value={s.color}
            onChange={(value) => updateChart(id, { color: value })}
          />
          {id === "spectrum" ? (
            <NumberSetting
              label="Bar width"
              value={s.barWidth}
              min={0.05}
              max={5}
              step={0.05}
              onChange={(value) => updateChart(id, { barWidth: value ?? s.barWidth })}
            />
          ) : (
            <NumberSetting
              label="Line width"
              value={s.lineWidth}
              min={0.5}
              max={6}
              step={0.25}
              onChange={(value) => updateChart(id, { lineWidth: value ?? s.lineWidth })}
            />
          )}
          <NumberSetting
            label="Title size"
            value={s.titleSize}
            min={8}
            max={30}
            step={1}
            onChange={(value) => updateChart(id, { titleSize: value ?? s.titleSize })}
          />
          <NumberSetting
            label="Axis label size"
            value={s.axisTitleSize}
            min={8}
            max={28}
            step={1}
            onChange={(value) =>
              updateChart(id, { axisTitleSize: value ?? s.axisTitleSize })
            }
          />
          <NumberSetting
            label="Tick size"
            value={s.tickSize}
            min={8}
            max={24}
            step={1}
            onChange={(value) => updateChart(id, { tickSize: value ?? s.tickSize })}
          />
          <SelectSetting
            label="Frame"
            value={s.frameMode}
            options={[
              { value: "none", label: "No frame" },
              { value: "half", label: "Half frame" },
              { value: "full", label: "Full frame" },
            ]}
            onChange={(value) => updateChart(id, { frameMode: value as FrameMode })}
          />
        </div>

        <div className="mt-4">
          <div className="label">Axis limits</div>
          <div className="mt-2 grid grid-cols-4 gap-2">
            <NumberSetting
              label="X min"
              value={s.axis.xMin}
              nullable
              onChange={(value) => updateAxis(id, { xMin: value })}
            />
            <NumberSetting
              label="X max"
              value={s.axis.xMax}
              nullable
              onChange={(value) => updateAxis(id, { xMax: value })}
            />
            <NumberSetting
              label="Y min"
              value={s.axis.yMin}
              nullable
              onChange={(value) => updateAxis(id, { yMin: value })}
            />
            <NumberSetting
              label="Y max"
              value={s.axis.yMax}
              nullable
              onChange={(value) => updateAxis(id, { yMax: value })}
            />
          </div>
          <p className="mt-1 text-[11px] text-ink-500">
            Leave min/max blank to keep Plotly auto-scaling that axis.
          </p>
        </div>

        {id === "eic" && (
          <div className="mt-4 rounded-md border border-ink-200 bg-ink-50/40 p-3">
            <div className="mb-2 label">EIC overlay analysis</div>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex items-center gap-2 text-xs text-ink-600">
                <input
                  type="checkbox"
                  checked={overlayEicEnabled}
                  onChange={(event) => setOverlayEicEnabled(event.target.checked)}
                />
                Overlay generated EICs
              </label>
              <label className="flex items-center gap-2 text-xs text-ink-600">
                <input
                  type="checkbox"
                  checked={settings.eicOverlay.showLegend}
                  onChange={(event) => updateEicOverlay({ showLegend: event.target.checked })}
                />
                Show legend
              </label>
              <label className="flex items-center gap-2 text-xs text-ink-600">
                <input
                  type="checkbox"
                  checked={settings.eicOverlay.normalize}
                  onChange={(event) => updateEicOverlay({ normalize: event.target.checked })}
                />
                Normalize each EIC to 100%
              </label>
              <label className="flex items-center gap-2 text-xs text-ink-600">
                <input
                  type="checkbox"
                  checked={settings.eicOverlay.stack}
                  onChange={(event) => updateEicOverlay({ stack: event.target.checked })}
                />
                Stack traces vertically
              </label>
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
          </div>
        )}

        <div className="mt-4 rounded-md border border-ink-200 bg-ink-50/40 p-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="label">{labelControlsTitle}</div>
            {id !== "uv" && (
              <label className="flex items-center gap-2 text-xs text-ink-600">
                <input
                  type="checkbox"
                  checked={s.labels.enabled}
                  disabled={!labelsAvailable}
                  onChange={(e) => updateLabels(id, { enabled: e.target.checked })}
                />
                Enabled
              </label>
            )}
          </div>
          {labelsAvailable ? (
            <div className="grid grid-cols-2 gap-3">
              <NumberSetting
                label="Label size"
                value={s.labels.fontSize}
                min={6}
                max={24}
                step={1}
                onChange={(value) =>
                  updateLabels(id, { fontSize: value ?? s.labels.fontSize })
                }
              />
              <ColorSetting
                label="Label color"
                value={s.labels.color}
                onChange={(value) => updateLabels(id, { color: value })}
              />
              {id === "uv" && (
                <ColorSetting
                  label="Connector line color"
                  value={s.annotationConnectorColor ?? "#334155"}
                  onChange={(value) => updateChart(id, { annotationConnectorColor: value })}
                />
              )}
              {id === "uv" && (
                <NumberSetting
                  label="Connector line opacity"
                  value={s.annotationConnectorOpacity ?? 0.7}
                  min={0}
                  max={1}
                  step={0.05}
                  onChange={(value) =>
                    updateChart(id, {
                      annotationConnectorOpacity: Math.min(1, Math.max(0, value ?? 0.7)),
                    })
                  }
                />
              )}
            </div>
          ) : (
            <p className="text-xs text-ink-500">
              Reserved for future {label} label controls.
            </p>
          )}
        </div>

        {id === "spectrum" && (
          <div className="mt-4 rounded-md border border-ink-200 bg-ink-50/40 p-3">
            <div className="mb-2 label">Polymer match labels</div>
            <div className="grid grid-cols-2 gap-3">
              <ColorSetting
                label="Label & accent color"
                value={(s.polymerLabels ?? DEFAULT_POLYMER_LABEL_SETTINGS).color}
                onChange={(value) => updatePolymerLabels(id, { color: value })}
              />
              <NumberSetting
                label="Font size"
                value={(s.polymerLabels ?? DEFAULT_POLYMER_LABEL_SETTINGS).fontSize}
                min={6}
                max={24}
                step={1}
                onChange={(value) =>
                  updatePolymerLabels(id, {
                    fontSize: value ?? (s.polymerLabels ?? DEFAULT_POLYMER_LABEL_SETTINGS).fontSize,
                  })
                }
              />
              <SelectSetting
                label="Orientation"
                value={(s.polymerLabels ?? DEFAULT_POLYMER_LABEL_SETTINGS).orientation}
                options={[
                  { value: "horizontal", label: "Horizontal (0°)" },
                  { value: "vertical", label: "Vertical (-90°)" },
                ]}
                onChange={(value) =>
                  updatePolymerLabels(id, { orientation: value as "horizontal" | "vertical" })
                }
              />
              <div className="flex flex-col justify-center gap-2 pt-1">
                <label className="flex items-center gap-2 text-xs text-ink-600">
                  <input
                    type="checkbox"
                    checked={(s.polymerLabels ?? DEFAULT_POLYMER_LABEL_SETTINGS).showBox}
                    onChange={(e) => updatePolymerLabels(id, { showBox: e.target.checked })}
                  />
                  Show box around label
                </label>
                <label className="flex items-center gap-2 text-xs text-ink-600">
                  <input
                    type="checkbox"
                    checked={(s.polymerLabels ?? DEFAULT_POLYMER_LABEL_SETTINGS).showArrow}
                    onChange={(e) => updatePolymerLabels(id, { showArrow: e.target.checked })}
                  />
                  Show arrow pointer to peak
                </label>
              </div>
            </div>
          </div>
        )}
      </section>
    );
  };

  return (
    <Modal
      title="Graph Settings"
      onClose={onClose}
      footer={
        <>
          <button
            className="rounded-md border border-ink-200 bg-surface px-3 py-1.5 text-sm text-ink-700 hover:bg-ink-100"
            onClick={onReset}
          >
            Reset defaults
          </button>
          <button
            className="rounded-md border border-brand-200 bg-brand-50 px-3 py-1.5 text-sm font-medium text-brand-700 hover:bg-brand-100"
            onClick={onSetDefault}
          >
            Set current as default
          </button>
          <button className="btn-primary" onClick={onClose}>
            Done
          </button>
        </>
      }
    >
      <div className="mb-4 text-sm text-ink-600">
        Configure LCMS plot appearance. Axis limits apply only when both min and
        max are filled for that axis.
      </div>
      <div className="flex flex-col gap-4">
        {section("tic", "TIC")}
        {section("eic", "EIC")}
        {section("uv", "UV chromatogram")}
        {section("spectrum", "MS1 spectrum")}
      </div>
    </Modal>
  );
}
