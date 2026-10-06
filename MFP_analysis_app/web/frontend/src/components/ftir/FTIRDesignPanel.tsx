import type { ReactNode } from "react";
import clsx from "clsx";
import { Hint } from "../Hint";
import {
  DESIGN_PRESETS,
  FONT_FAMILIES,
  applyPreset,
  type GraphSettings,
  type LegendPosition,
  type PlotFrameMode,
} from "./plotDesign";

function Field(props: { label: string; hint: string; children: ReactNode; className?: string }) {
  return (
    <Hint id={props.hint} className={clsx("min-w-0 w-full", props.className)}>
      <div className="min-w-0 flex-1">
        <div className="label">{props.label}</div>
        {props.children}
      </div>
    </Hint>
  );
}

function Check(props: { hint: string; label: string; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean }) {
  return (
    <Hint id={props.hint} className="min-w-0 w-full">
      <label className="flex min-h-9 flex-1 items-center gap-2 self-end rounded-md border border-ink-200 bg-surface px-2 py-1 text-[13px]">
        <input type="checkbox" checked={props.checked} disabled={props.disabled} onChange={(e) => props.onChange(e.target.checked)} />
        {props.label}
      </label>
    </Hint>
  );
}

function Section(props: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">{props.title}</h4>
        {props.aside}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{props.children}</div>
    </section>
  );
}

const numberInput = (value: number, min: number, max: number, step: number, onChange: (v: number) => void) => (
  <input
    type="number"
    className="input w-full"
    min={min}
    max={max}
    step={step}
    value={value}
    onChange={(e) => {
      const n = Number(e.target.value);
      if (Number.isFinite(n)) onChange(Math.max(min, Math.min(max, n)));
    }}
  />
);

// Empty means automatic.
const optionalNumber = (value: number | null, placeholder: string, onChange: (v: number | null) => void, min?: number) => (
  <input
    type="number"
    className="input w-full"
    placeholder={placeholder}
    min={min}
    step="any"
    value={value ?? ""}
    onChange={(e) => {
      const raw = e.target.value.trim();
      const n = Number(raw);
      onChange(raw === "" || !Number.isFinite(n) || (min !== undefined && n < min) ? null : n);
    }}
  />
);

export function FTIRDesignPanel(props: {
  settings: GraphSettings;
  onChange: (next: GraphSettings) => void;
  colorRows: { key: string; label: string; defaultColor: string }[];
  traceColor: (key: string, fallback: string) => string;
  yUnit: string;
  onArrangeLabels: () => void;
  onResetLabels: () => void;
  canArrange: boolean;
  onSaveDefault: () => void;
  onUseDefault: (() => void) | null;
}) {
  const s = props.settings;
  const set = (patch: Partial<GraphSettings>) => props.onChange({ ...s, ...patch });

  return (
    <div className="mb-3 flex flex-col gap-4 rounded-md border border-ink-200 bg-ink-50/50 p-3">
      <Section
        title="Style"
        aside={
          <div className="flex flex-wrap gap-1.5">
            <Hint id="ftir.saveDesignDefault">
              <button type="button" className="btn-ghost border border-ink-200 px-2 py-1 text-xs" onClick={props.onSaveDefault}>
                Save as my default
              </button>
            </Hint>
            {props.onUseDefault && (
              <button type="button" className="btn-ghost border border-ink-200 px-2 py-1 text-xs" onClick={props.onUseDefault}>
                Use my default
              </button>
            )}
          </div>
        }
      >
        <Hint id="ftir.designPresets" className="min-w-0 w-full sm:col-span-2 xl:col-span-4">
          <div className="flex flex-1 flex-wrap gap-1.5">
            {(Object.keys(DESIGN_PRESETS) as (keyof typeof DESIGN_PRESETS)[]).map((name) => (
              <button
                key={name}
                type="button"
                className="btn-ghost border border-ink-200 bg-surface px-3 py-1 text-xs"
                onClick={() => props.onChange(applyPreset(s, DESIGN_PRESETS[name]))}
              >
                {name}
              </button>
            ))}
          </div>
        </Hint>
      </Section>

      <Section title="Lines and frame">
        <Field hint="ftir.lineWidth" label="Line width">
          {numberInput(s.lineWidth, 0.5, 8, 0.1, (lineWidth) => set({ lineWidth }))}
        </Field>
        <Field hint="ftir.frame" label="Frame">
          <select className="input w-full" value={s.frame} onChange={(e) => set({ frame: e.target.value as PlotFrameMode })}>
            <option value="none">No frame</option>
            <option value="half">Half frame</option>
            <option value="full">Full frame</option>
          </select>
        </Field>
        <Check hint="ftir.grid" label="Gridlines" checked={s.showGrid} onChange={(showGrid) => set({ showGrid })} />
        <Check hint="ftir.groupRegions" label="Group regions" checked={Boolean(s.showGroupRegions)} onChange={(showGroupRegions) => set({ showGroupRegions })} />
      </Section>

      <Section title="Axes and ticks">
        <Check hint="ftir.ticks" label="Tick marks" checked={s.showTicks} onChange={(showTicks) => set({ showTicks })} />
        <Field hint="ftir.tickDirection" label="Ticks point">
          <select className="input w-full" value={s.tickDirection} disabled={!s.showTicks} onChange={(e) => set({ tickDirection: e.target.value as GraphSettings["tickDirection"] })}>
            <option value="outside">Outside</option>
            <option value="inside">Inside</option>
          </select>
        </Field>
        <Check hint="ftir.minorTicks" label="Minor ticks" checked={s.minorTicks} disabled={!s.showTicks} onChange={(minorTicks) => set({ minorTicks })} />
        <Field hint="ftir.tickWidth" label="Tick thickness">
          {numberInput(s.tickWidth, 0.5, 4, 0.5, (tickWidth) => set({ tickWidth }))}
        </Field>
        <Field hint="ftir.tickLength" label="Tick length">
          {numberInput(s.tickLength, 2, 12, 1, (tickLength) => set({ tickLength }))}
        </Field>
        <Field hint="ftir.axisLineWidth" label="Axis line thickness">
          {numberInput(s.axisLineWidth, 0.5, 4, 0.5, (axisLineWidth) => set({ axisLineWidth }))}
        </Field>
        <Field hint="ftir.xTickStep" label="x tick every (cm⁻¹)">
          {optionalNumber(s.xTickStep, "auto", (xTickStep) => set({ xTickStep }), 0)}
        </Field>
        <Field hint="ftir.yTickStep" label={`y tick every (${props.yUnit})`}>
          {optionalNumber(s.yTickStep, "auto", (yTickStep) => set({ yTickStep }), 0)}
        </Field>
        <Field hint="ftir.yRange" label="y from">
          {optionalNumber(s.yMin, "auto", (yMin) => set({ yMin }))}
        </Field>
        <Field hint="ftir.yRange" label="y to">
          {optionalNumber(s.yMax, "auto", (yMax) => set({ yMax }))}
        </Field>
      </Section>

      <Section title="Text">
        <Field hint="ftir.fontFamily" label="Font">
          <select className="input w-full" value={s.fontFamily} onChange={(e) => set({ fontFamily: e.target.value })}>
            {FONT_FAMILIES.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </Field>
        <Field hint="ftir.axisTitleSize" label="Axis title size">
          {numberInput(s.axisTitleSize, 8, 28, 1, (axisTitleSize) => set({ axisTitleSize }))}
        </Field>
        <Field hint="ftir.axisTickSize" label="Tick label size">
          {numberInput(s.axisTickSize, 8, 24, 1, (axisTickSize) => set({ axisTickSize }))}
        </Field>
        <div className="grid gap-2">
          <Check hint="ftir.axisTitleBold" label="Bold axis titles" checked={s.axisTitleBold} onChange={(axisTitleBold) => set({ axisTitleBold })} />
          <Check hint="ftir.tickLabelBold" label="Bold tick labels" checked={s.tickLabelBold} onChange={(tickLabelBold) => set({ tickLabelBold })} />
        </div>
        <Field hint="ftir.legend" label="Legend">
          <select className="input w-full" value={s.legend} onChange={(e) => set({ legend: e.target.value as LegendPosition })}>
            <option value="auto">Automatic (with overlays)</option>
            <option value="hidden">Hidden</option>
            <option value="top-right">Top right</option>
            <option value="top-left">Top left</option>
            <option value="bottom-right">Bottom right</option>
            <option value="outside">Outside, right</option>
          </select>
        </Field>
      </Section>

      <Section
        title="Peak labels"
        aside={
          <div className="flex flex-wrap gap-1.5">
            <Hint id="ftir.arrangeLabels">
              <button type="button" className="btn-ghost border border-ink-200 px-2 py-1 text-xs" disabled={!props.canArrange} onClick={props.onArrangeLabels}>
                Auto-arrange
              </button>
            </Hint>
            <Hint id="ftir.resetLabels">
              <button type="button" className="btn-ghost border border-ink-200 px-2 py-1 text-xs" disabled={!props.canArrange} onClick={props.onResetLabels}>
                Reset positions
              </button>
            </Hint>
          </div>
        }
      >
        <Field hint="ftir.labelColor" label="Colour">
          <input
            type="color"
            className="h-9 w-full cursor-pointer rounded-md border border-ink-200 bg-surface px-2"
            value={s.peakLabelColor}
            onChange={(e) => set({ peakLabelColor: e.target.value })}
          />
        </Field>
        <Field hint="ftir.labelSize" label="Size">
          {numberInput(s.peakLabelSize, 6, 28, 1, (peakLabelSize) => set({ peakLabelSize }))}
        </Field>
        <Field hint="ftir.labelOrientation" label="Orientation">
          <select className="input w-full" value={s.peakLabelOrientation} onChange={(e) => set({ peakLabelOrientation: e.target.value as GraphSettings["peakLabelOrientation"] })}>
            <option value="horizontal">Horizontal</option>
            <option value="vertical">Vertical</option>
          </select>
        </Field>
        <Field hint="ftir.labelStyle" label="Label">
          <select className="input w-full" value={s.peakLabelStyle} onChange={(e) => set({ peakLabelStyle: e.target.value as GraphSettings["peakLabelStyle"] })}>
            <option value="box">In a box</option>
            <option value="plain">Text only</option>
          </select>
        </Field>
        <Check hint="ftir.labelBold" label="Bold labels" checked={s.peakLabelBold} onChange={(peakLabelBold) => set({ peakLabelBold })} />
        <Check hint="ftir.peakMarkers" label="Peak markers (▼)" checked={s.showPeakMarkers} onChange={(showPeakMarkers) => set({ showPeakMarkers })} />
      </Section>

      <Hint id="ftir.traceColors" className="w-full">
        <section className="flex flex-1 flex-col gap-2">
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">Trace colours</h4>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {props.colorRows.map((row) => (
              <label key={row.key} className="flex items-center justify-between gap-2 rounded-md border border-ink-200 bg-surface px-2 py-1.5 text-xs">
                <span className="truncate">{row.label}</span>
                <input
                  type="color"
                  value={props.traceColor(row.key, row.defaultColor)}
                  onChange={(event) => set({ traceColors: { ...s.traceColors, [row.key]: event.target.value } })}
                />
              </label>
            ))}
          </div>
        </section>
      </Hint>
    </div>
  );
}
