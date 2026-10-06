// Look of the FTIR spectrum chart: settings, presets, Plotly styling and peak-label arrangement.

export type PlotFrameMode = "none" | "half" | "full";
export type LegendPosition = "auto" | "hidden" | "top-right" | "top-left" | "bottom-right" | "outside";

export interface GraphSettings {
  lineWidth: number;
  frame: PlotFrameMode;
  showTicks: boolean;
  showGrid: boolean;
  showScaleBars?: boolean;
  showGroupRegions?: boolean;
  overlayMode?: "overlay" | "offset" | "stacked";
  peakLabelColor: string;
  peakLabelSize: number;
  axisTitleSize: number;
  axisTickSize: number;
  traceColors: Record<string, string>;
  fontFamily: string;
  tickLabelBold: boolean;
  axisTitleBold: boolean;
  peakLabelBold: boolean;
  tickWidth: number;
  tickLength: number;
  axisLineWidth: number;
  tickDirection: "outside" | "inside";
  minorTicks: boolean;
  xTickStep: number | null;
  yTickStep: number | null;
  yMin: number | null;
  yMax: number | null;
  peakLabelOrientation: "horizontal" | "vertical";
  peakLabelStyle: "box" | "plain";
  showPeakMarkers: boolean;
  legend: LegendPosition;
}

export const FONT_FAMILIES = [
  { label: "Arial", value: "Arial, Helvetica, sans-serif" },
  { label: "Helvetica", value: "Helvetica, Arial, sans-serif" },
  { label: "Times New Roman", value: "\"Times New Roman\", Times, serif" },
  { label: "Calibri", value: "Calibri, Carlito, sans-serif" },
  { label: "App font", value: "Inter, system-ui, sans-serif" },
];

export const DEFAULT_GRAPH_SETTINGS: GraphSettings = {
  lineWidth: 1.4,
  frame: "half",
  showTicks: true,
  showGrid: true,
  showGroupRegions: false,
  overlayMode: "overlay",
  peakLabelColor: "#dc2626",
  peakLabelSize: 10,
  axisTitleSize: 13,
  axisTickSize: 12,
  traceColors: {},
  fontFamily: FONT_FAMILIES[0].value,
  tickLabelBold: false,
  axisTitleBold: false,
  peakLabelBold: false,
  tickWidth: 1,
  tickLength: 5,
  axisLineWidth: 1,
  tickDirection: "outside",
  minorTicks: false,
  xTickStep: null,
  yTickStep: null,
  yMin: null,
  yMax: null,
  peakLabelOrientation: "horizontal",
  peakLabelStyle: "box",
  showPeakMarkers: true,
  legend: "auto",
};

// Only the look; colours of individual traces and the overlay mode are left as they are.
export type DesignPreset = Omit<GraphSettings, "traceColors" | "overlayMode" | "showGroupRegions" | "showScaleBars" | "yMin" | "yMax">;

export const DESIGN_PRESETS: Record<"Screen" | "Paper" | "Slide", DesignPreset> = {
  Screen: {
    ...DEFAULT_GRAPH_SETTINGS,
  },
  Paper: {
    ...DEFAULT_GRAPH_SETTINGS,
    lineWidth: 1,
    frame: "full",
    showGrid: false,
    peakLabelColor: "#111827",
    peakLabelSize: 8,
    axisTitleSize: 10,
    axisTickSize: 9,
    fontFamily: FONT_FAMILIES[0].value,
    tickDirection: "inside",
    tickLength: 4,
    minorTicks: true,
    peakLabelOrientation: "vertical",
    peakLabelStyle: "plain",
    showPeakMarkers: false,
    legend: "top-right",
  },
  Slide: {
    ...DEFAULT_GRAPH_SETTINGS,
    lineWidth: 2.5,
    frame: "half",
    showGrid: false,
    peakLabelSize: 16,
    axisTitleSize: 20,
    axisTickSize: 16,
    tickLabelBold: true,
    axisTitleBold: true,
    peakLabelBold: true,
    tickWidth: 2,
    tickLength: 7,
    axisLineWidth: 2,
    legend: "top-right",
  },
};

export function applyPreset(current: GraphSettings, preset: DesignPreset): GraphSettings {
  return {
    ...current,
    ...preset,
    traceColors: current.traceColors,
    overlayMode: current.overlayMode,
    showGroupRegions: current.showGroupRegions,
    showScaleBars: current.showScaleBars,
    yMin: current.yMin,
    yMax: current.yMax,
  };
}

const clamp = (value: unknown, lo: number, hi: number, fallback: number) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fallback;
};
const positiveOrNull = (value: unknown) => {
  const n = Number(value);
  return value != null && value !== "" && Number.isFinite(n) && n > 0 ? n : null;
};
const numberOrNull = (value: unknown) => {
  const n = Number(value);
  return value != null && value !== "" && Number.isFinite(n) ? n : null;
};

export function mergeGraphSettings(value: Partial<GraphSettings>): GraphSettings {
  const d = DEFAULT_GRAPH_SETTINGS;
  const merged = { ...d, ...value };
  return {
    ...merged,
    peakLabelSize: clamp(value.peakLabelSize, 6, 28, d.peakLabelSize),
    axisTitleSize: clamp(value.axisTitleSize, 8, 28, d.axisTitleSize),
    axisTickSize: clamp(value.axisTickSize, 8, 24, d.axisTickSize),
    tickWidth: clamp(value.tickWidth, 0.5, 4, d.tickWidth),
    tickLength: clamp(value.tickLength, 2, 12, d.tickLength),
    axisLineWidth: clamp(value.axisLineWidth, 0.5, 4, d.axisLineWidth),
    xTickStep: positiveOrNull(value.xTickStep),
    yTickStep: positiveOrNull(value.yTickStep),
    yMin: numberOrNull(value.yMin),
    yMax: numberOrNull(value.yMax),
    traceColors: value.traceColors ?? {},
  };
}

// Plotly 2.33+ font weight; the bundled @types lag behind.
export function font(size: number, family: string, bold: boolean, color?: string): Record<string, unknown> {
  return { size, family, weight: bold ? 700 : 400, ...(color ? { color } : {}) };
}

export function axisStyle(s: GraphSettings, color: string, step: number | null): Record<string, unknown> {
  return {
    tickfont: font(s.axisTickSize, s.fontFamily, s.tickLabelBold),
    ticks: s.showTicks ? s.tickDirection : "",
    tickwidth: s.tickWidth,
    ticklen: s.tickLength,
    tickcolor: color,
    linewidth: s.axisLineWidth,
    linecolor: color,
    showgrid: s.showGrid,
    zeroline: false,
    automargin: true,
    ...(step ? { dtick: step, tick0: 0 } : {}),
    ...(s.minorTicks && s.showTicks
      ? { minor: { ticks: s.tickDirection, ticklen: Math.max(2, Math.round(s.tickLength * 0.6)), tickwidth: s.tickWidth, tickcolor: color, showgrid: false } }
      : {}),
  };
}

export function legendLayout(position: LegendPosition, overlayCount: number): Record<string, unknown> {
  if (position === "hidden" || (position === "auto" && overlayCount < 2)) return { showlegend: false };
  const place: Record<Exclude<LegendPosition, "auto" | "hidden">, Record<string, unknown>> = {
    "top-right": { x: 0.99, y: 0.99, xanchor: "right", yanchor: "top" },
    "top-left": { x: 0.01, y: 0.99, xanchor: "left", yanchor: "top" },
    "bottom-right": { x: 0.99, y: 0.01, xanchor: "right", yanchor: "bottom" },
    outside: { x: 1.02, y: 1, xanchor: "left", yanchor: "top" },
  };
  return position === "auto" ? { showlegend: true } : { showlegend: true, legend: { ...place[position], bgcolor: "rgba(255,255,255,0.7)" } };
}

export function peakLabelStyle(s: GraphSettings, color: string, background: string): Record<string, unknown> {
  const boxed = s.peakLabelStyle === "box";
  return {
    textangle: s.peakLabelOrientation === "vertical" ? -90 : 0,
    bgcolor: boxed ? background : "rgba(0,0,0,0)",
    bordercolor: boxed ? color : "rgba(0,0,0,0)",
    borderpad: boxed ? 2 : 0,
    font: font(s.peakLabelSize, s.fontFamily, s.peakLabelBold, color),
  };
}

// The y range comes from the data only. Plotly's autorange also stretches to fit annotation
// boxes, so changing label size, orientation or text size used to move the axis numbers.
export function dataYRange(
  series: number[][],
  labelSide: "top" | "bottom",
  user: { min: number | null; max: number | null },
): [number, number] | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (const ys of series)
    for (const y of ys)
      if (Number.isFinite(y)) {
        lo = Math.min(lo, y);
        hi = Math.max(hi, y);
      }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
  const span = hi - lo || Math.abs(hi) || 1;
  // Headroom for the peak labels on the side they sit.
  const auto: [number, number] =
    labelSide === "top" ? [lo - 0.04 * span, hi + 0.12 * span] : [lo - 0.12 * span, hi + 0.04 * span];
  const min = user.min ?? auto[0];
  const max = user.max ?? auto[1];
  return min < max ? [min, max] : [max, min];
}

// --------------------------- label arrangement ---------------------------

export interface LabelToPlace {
  key: string;
  // Arrow head (the peak), in pixels inside the plot area; y grows downwards.
  px: number;
  py: number;
  text: string;
}

export interface ArrangeOptions {
  direction: "up" | "down";
  fontSize: number;
  vertical: boolean;
  plotWidth: number;
  plotHeight: number;
  // Highest (direction "up") or lowest ("down") pixel y of the curve between two pixel x positions.
  curveEdge: (x0: number, x1: number) => number;
  gap?: number;
}

export function labelSize(text: string, fontSize: number, vertical: boolean): { width: number; height: number } {
  const along = text.length * fontSize * 0.56 + 8;
  const across = fontSize + 8;
  return vertical ? { width: across, height: along } : { width: along, height: across };
}

interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

const overlaps = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

// Places each label just clear of the curve and of the labels already placed, stacking upwards
// (absorbance) or downwards (transmittance). Labels keep the left-to-right order of their peaks so
// arrows don't cross; among the free spots the one with the shortest arrow wins.
// Returns Plotly annotation offsets (ax, ay) from each peak to its label's centre.
function stackLabels(labels: LabelToPlace[], opts: ArrangeOptions): { offsets: Record<string, { ax: number; ay: number }>; clean: boolean } {
  const gap = opts.gap ?? 4;
  const up = opts.direction === "up";
  const placed: Box[] = [];
  let clean = true;
  const out: Record<string, { ax: number; ay: number }> = {};
  const sorted = [...labels].sort((a, b) => a.px - b.px);
  let leftLimit = 0;

  for (const label of sorted) {
    const { width, height } = labelSize(label.text, opts.fontSize, opts.vertical);
    const stackAt = (cx: number): Box => {
      const x0 = cx - width / 2;
      const x1 = cx + width / 2;
      const edge = opts.curveEdge(x0, x1);
      // Clear the curve under the label; straight above the peak also leave room for a short arrow.
      // Beside the peak (e.g. a band that reaches the top) only the curve under the label matters.
      const beside = x0 > label.px || x1 < label.px;
      const floor = beside ? edge : up ? Math.min(edge, label.py - 12) : Math.max(edge, label.py + 12);
      let y = up ? floor - gap - height : floor + gap;
      for (let guard = 0; guard < 60; guard += 1) {
        const box = { x0, x1, y0: y, y1: y + height };
        const hit = placed.find((q) => overlaps({ ...box, x0: x0 - gap, x1: x1 + gap }, q));
        if (!hit) return box;
        y = up ? hit.y0 - gap - height : hit.y1 + gap;
      }
      return { x0, x1, y0: y, y1: y + height };
    };
    const inside = (box: Box) => box.y0 >= 0 && box.y1 <= opts.plotHeight;
    let best: { box: Box; cost: number } | null = null;
    for (const step of [0, 0.25, -0.25, 0.5, -0.5, 0.75, -0.75, 1, -1, 1.5, -1.5, 2, -2, 3, -3]) {
      const cx = Math.max(width / 2, Math.min(opts.plotWidth - width / 2, label.px + Math.sign(step) * (Math.abs(step) * width + (Math.abs(step) >= 1 ? gap : 0))));
      const box = stackAt(cx);
      const arrow = Math.hypot((box.x0 + box.x1) / 2 - label.px, (up ? box.y1 : box.y0) - label.py);
      // Leaving the plot is worst; a centre left of the previous label's (crossing arrows) next.
      const cost = arrow + (inside(box) ? 0 : 10_000) + (cx < leftLimit ? 5_000 : 0);
      if (!best || cost < best.cost) best = { box, cost };
    }
    if (!best) continue;
    let box = best.box;
    if (best.cost >= 5_000) clean = false;
    // Nothing free inside the plot: keep it inside even if it overlaps.
    const h = box.y1 - box.y0;
    const y0 = Math.max(0, Math.min(opts.plotHeight - h, box.y0));
    box = { ...box, y0, y1: y0 + h };
    placed.push(box);
    leftLimit = (box.x0 + box.x1) / 2;
    out[label.key] = {
      ax: Math.round((box.x0 + box.x1) / 2 - label.px),
      ay: Math.round((box.y0 + box.y1) / 2 - label.py),
    };
  }
  return { offsets: out, clean };
}

// Fallback when stacking can't fit: labels in rows along the top (or bottom) edge, each row in the
// left-to-right order of its peaks, with as few rows as fit the width.
function railLabels(labels: LabelToPlace[], opts: ArrangeOptions): Record<string, { ax: number; ay: number }> {
  const gap = opts.gap ?? 4;
  const up = opts.direction === "up";
  const sorted = [...labels].sort((a, b) => a.px - b.px);
  const sizes = sorted.map((l) => labelSize(l.text, opts.fontSize, opts.vertical));
  const layoutRows = (rows: number) => {
    const centres = new Array<number>(sorted.length).fill(0);
    let fits = true;
    for (let row = 0; row < rows; row += 1) {
      const idx = sorted.map((_, i) => i).filter((i) => i % rows === row);
      // Forward: as close to the peak as the previous label allows; backward: pull back inside the plot.
      let right = -Infinity;
      for (const i of idx) {
        const w = sizes[i].width;
        centres[i] = Math.max(sorted[i].px, right + gap + w / 2, w / 2);
        right = centres[i] + w / 2;
      }
      let left = opts.plotWidth + gap;
      for (const i of [...idx].reverse()) {
        const w = sizes[i].width;
        centres[i] = Math.min(centres[i], left - gap - w / 2);
        left = centres[i] - w / 2;
      }
      if (idx.length && left < 0) fits = false;
    }
    return { centres, fits };
  };
  let rows = 1;
  let result = layoutRows(rows);
  while (!result.fits && rows < sorted.length) {
    rows += 1;
    result = layoutRows(rows);
  }
  const rowHeight = Math.max(...sizes.map((s) => s.height)) + gap;
  const centres = [...result.centres];
  const cyOf = (i: number) => {
    const row = i % rows;
    return up ? gap + rowHeight * row + rowHeight / 2 : opts.plotHeight - gap - rowHeight * row - rowHeight / 2;
  };
  // A label right over a peak that reaches into its row would cover the peak: move it beside the
  // peak when its row has room there.
  sorted.forEach((label, i) => {
    const w = sizes[i].width;
    const half = sizes[i].height / 2;
    const covers = up ? label.py < cyOf(i) + half : label.py > cyOf(i) - half;
    if (!covers || Math.abs(centres[i] - label.px) > w / 2 + 2) return;
    const neighbours = sorted.map((_, j) => j).filter((j) => j !== i && j % rows === i % rows);
    const free = (cx: number) =>
      cx - w / 2 >= 0 &&
      cx + w / 2 <= opts.plotWidth &&
      neighbours.every((j) => Math.abs(centres[j] - cx) >= (sizes[j].width + w) / 2 + gap);
    const side = [label.px + w / 2 + 3, label.px - w / 2 - 3].find(free);
    if (side !== undefined) centres[i] = side;
  });
  const out: Record<string, { ax: number; ay: number }> = {};
  sorted.forEach((label, i) => {
    out[label.key] = { ax: Math.round(centres[i] - label.px), ay: Math.round(cyOf(i) - label.py) };
  });
  return out;
}

// Stacks labels just above their peaks when they fit; otherwise lines them up in rows.
export function arrangeLabels(labels: LabelToPlace[], opts: ArrangeOptions): Record<string, { ax: number; ay: number }> {
  const stacked = stackLabels(labels, opts);
  return stacked.clean ? stacked.offsets : railLabels(labels, opts);
}

// "Save as my default": one design per browser, restored with "Use my default".
const DESIGN_DEFAULT_KEY = "mfp.ftir.graphSettings.default";

export function readDesignDefault(): GraphSettings | null {
  try {
    const raw = window.localStorage.getItem(DESIGN_DEFAULT_KEY);
    return raw ? mergeGraphSettings(JSON.parse(raw) as Partial<GraphSettings>) : null;
  } catch {
    return null;
  }
}

export function writeDesignDefault(settings: GraphSettings): void {
  try {
    window.localStorage.setItem(DESIGN_DEFAULT_KEY, JSON.stringify(settings));
  } catch {
    // storage unavailable: the design still applies now
  }
}
