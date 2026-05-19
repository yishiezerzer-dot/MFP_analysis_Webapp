export type FrameMode = "none" | "half" | "full";

export interface AxisLimits {
  xMin: number | null;
  xMax: number | null;
  yMin: number | null;
  yMax: number | null;
}

export interface LabelSettings {
  enabled: boolean;
  fontSize: number;
  color: string;
}

export interface ChartSettings {
  title: string;
  xTitle: string;
  yTitle: string;
  height: number;
  color: string;
  lineWidth: number;
  barWidth: number;
  titleSize: number;
  axisTitleSize: number;
  tickSize: number;
  showGrid: boolean;
  frameMode: FrameMode;
  showScaleBars: boolean;
  annotationConnectorColor?: string;
  annotationConnectorOpacity?: number;
  axis: AxisLimits;
  labels: LabelSettings;
}

export interface EICOverlaySettings {
  normalize: boolean;
  stack: boolean;
  stackGap: number;
  opacity: number;
  showLegend: boolean;
}

export interface GraphSettings {
  tic: ChartSettings;
  uv: ChartSettings;
  spectrum: ChartSettings;
  eic: ChartSettings;
  eicOverlay: EICOverlaySettings;
}

export const GRAPH_SETTINGS_DEFAULT_STORAGE_KEY = "mfp.lcms.graphSettings.default";

export const DEFAULT_AXIS_LIMITS: AxisLimits = {
  xMin: null,
  xMax: null,
  yMin: null,
  yMax: null,
};

export const DEFAULT_GRAPH_SETTINGS: GraphSettings = {
  tic: {
    title: "",
    xTitle: "RT",
    yTitle: "TIC",
    height: 360,
    color: "#1e2636",
    lineWidth: 1.5,
    barWidth: 0.5,
    titleSize: 14,
    axisTitleSize: 13,
    tickSize: 12,
    showGrid: true,
    frameMode: "half",
    showScaleBars: true,
    axis: { ...DEFAULT_AXIS_LIMITS },
    labels: { enabled: false, fontSize: 10, color: "#46536a" },
  },
  uv: {
    title: "",
    xTitle: "RT",
    yTitle: "Signal",
    height: 320,
    color: "#5573b9",
    lineWidth: 1.5,
    barWidth: 0.5,
    titleSize: 14,
    axisTitleSize: 13,
    tickSize: 12,
    showGrid: true,
    frameMode: "half",
    showScaleBars: true,
    annotationConnectorColor: "#334155",
    annotationConnectorOpacity: 0.7,
    axis: { ...DEFAULT_AXIS_LIMITS },
    labels: { enabled: false, fontSize: 10, color: "#46536a" },
  },
  spectrum: {
    title: "",
    xTitle: "m/z",
    yTitle: "intensity",
    height: 360,
    color: "#323c50",
    lineWidth: 1.5,
    barWidth: 0.5,
    titleSize: 14,
    axisTitleSize: 13,
    tickSize: 12,
    showGrid: true,
    frameMode: "half",
    showScaleBars: true,
    axis: { ...DEFAULT_AXIS_LIMITS },
    labels: { enabled: true, fontSize: 10, color: "#46536a" },
  },
  eic: {
    title: "",
    xTitle: "RT",
    yTitle: "EIC intensity",
    height: 300,
    color: "#7c3aed",
    lineWidth: 1.5,
    barWidth: 0.5,
    titleSize: 14,
    axisTitleSize: 13,
    tickSize: 12,
    showGrid: true,
    frameMode: "half",
    showScaleBars: true,
    axis: { ...DEFAULT_AXIS_LIMITS },
    labels: { enabled: false, fontSize: 10, color: "#46536a" },
  },
  eicOverlay: {
    normalize: false,
    stack: false,
    stackGap: 110,
    opacity: 0.9,
    showLegend: true,
  },
};

export function cloneGraphSettings(settings: GraphSettings): GraphSettings {
  return JSON.parse(JSON.stringify(settings)) as GraphSettings;
}

export function mergeChartSettings(base: ChartSettings, saved?: Partial<ChartSettings>): ChartSettings {
  return {
    ...base,
    ...(saved ?? {}),
    axis: { ...base.axis, ...(saved?.axis ?? {}) },
    labels: { ...base.labels, ...(saved?.labels ?? {}) },
  };
}

export function mergeGraphSettings(saved?: Partial<GraphSettings>): GraphSettings {
  const base = cloneGraphSettings(DEFAULT_GRAPH_SETTINGS);
  if (!saved) return base;
  return {
    tic: mergeChartSettings(base.tic, saved.tic),
    uv: mergeChartSettings(base.uv, saved.uv),
    spectrum: mergeChartSettings(base.spectrum, saved.spectrum),
    eic: mergeChartSettings(base.eic, saved.eic),
    eicOverlay: { ...base.eicOverlay, ...(saved.eicOverlay ?? {}) },
  };
}

export function loadGraphSettingsDefault(): GraphSettings {
  if (typeof window === "undefined") return mergeGraphSettings();
  try {
    const stored = window.localStorage.getItem(GRAPH_SETTINGS_DEFAULT_STORAGE_KEY);
    return stored
      ? mergeGraphSettings(JSON.parse(stored) as Partial<GraphSettings>)
      : mergeGraphSettings();
  } catch {
    return mergeGraphSettings();
  }
}

export function saveGraphSettingsDefault(settings: GraphSettings): void {
  window.localStorage.setItem(
    GRAPH_SETTINGS_DEFAULT_STORAGE_KEY,
    JSON.stringify(settings),
  );
}
