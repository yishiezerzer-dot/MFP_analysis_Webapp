import type { Config, Data, Layout, PlotlyHTMLElement } from "plotly.js";
import { PLOTLY_THEME_COLORS } from "../theme/ThemeProvider";

export type PublicationExportFormat = "svg" | "png";

export interface PublicationSizePreset {
  id: string;
  label: string;
  category: "ACS" | "Nature" | "RSC" | "Standard";
  widthMm: number;
  heightMm: number;
  defaultLegendFontSize?: number;
}

export interface PublicationExportSettings {
  widthMm: number;
  heightMm: number;
  dpi: number;
  legendFontSize: number;
  isCurrentView?: boolean;
  sourceDimensionsPx?: { width?: number; height?: number };
}

export interface PublicationExportPixels {
  plotWidthPx: number;
  plotHeightPx: number;
  canvasWidthPx: number;
  canvasHeightPx: number;
  legendReserveWidthPx: number;
}

export interface PublicationExportRequest extends PublicationExportSettings {
  format: PublicationExportFormat;
  filename: string;
}

export const CURRENT_VIEW_PRESET_ID = "current-view";

export const PUBLICATION_WIDTH_PRESETS: PublicationSizePreset[] = [
  // ACS (American Chemical Society - JACS, Macromolecules, Chem. Mater., etc.)
  { id: "acs-single", label: "ACS Single Col (82.5 x 60 mm)", category: "ACS", widthMm: 82.5, heightMm: 60, defaultLegendFontSize: 9 },
  { id: "acs-double", label: "ACS Double Col (177.8 x 100 mm)", category: "ACS", widthMm: 177.8, heightMm: 100, defaultLegendFontSize: 10 },

  // Nature Portfolio (Nat. Chem., Nat. Mater., Nat. Commun., etc.)
  { id: "nature-single", label: "Nature Single Col (89 x 60 mm)", category: "Nature", widthMm: 89, heightMm: 60, defaultLegendFontSize: 8 },
  { id: "nature-double", label: "Nature Double Col (180 x 100 mm)", category: "Nature", widthMm: 180, heightMm: 100, defaultLegendFontSize: 9 },

  // RSC (Royal Society of Chemistry - Chem. Sci., Analyst, etc.)
  { id: "rsc-single", label: "RSC Single Col (83 x 60 mm)", category: "RSC", widthMm: 83, heightMm: 60, defaultLegendFontSize: 9 },
  { id: "rsc-double", label: "RSC Double Col (171 x 100 mm)", category: "RSC", widthMm: 171, heightMm: 100, defaultLegendFontSize: 10 },

  // Standard Presets
  { id: "std-90x60", label: "Standard Small (90 x 60 mm)", category: "Standard", widthMm: 90, heightMm: 60, defaultLegendFontSize: 10 },
  { id: "std-135x80", label: "Standard Medium (135 x 80 mm)", category: "Standard", widthMm: 135, heightMm: 80, defaultLegendFontSize: 11 },
  { id: "std-180x100", label: "Standard Large (180 x 100 mm)", category: "Standard", widthMm: 180, heightMm: 100, defaultLegendFontSize: 12 },
  { id: "std-180x120", label: "Standard Full-Page (180 x 120 mm)", category: "Standard", widthMm: 180, heightMm: 120, defaultLegendFontSize: 12 },
];

export const DEFAULT_PUBLICATION_SIZE = PUBLICATION_WIDTH_PRESETS[3]; // Nature Double Col (180 x 100 mm)

export const PUBLICATION_DPI_PRESETS = [300, 600, 1200] as const;

export const DEFAULT_PUBLICATION_DPI = 600;

export const DEFAULT_PUBLICATION_LEGEND_FONT_SIZE = 13;

export const PUBLICATION_EXPORT_STORAGE_KEY = "mfp-publication-plot-export";

const MM_PER_INCH = 25.4;
const CSS_DPI = 96;
const DPI_MIN = 72;
const DPI_MAX = 1200;
const SIZE_MIN_MM = 30;
const SIZE_MAX_MM = 260;
const FONT_SIZE_MIN = 4;
const FONT_SIZE_MAX = 36;
const LEGEND_RESERVE_MM = 38;

export function clampPublicationDpi(dpi: number): number {
  const n = Math.round(dpi);
  if (!Number.isFinite(n)) return DEFAULT_PUBLICATION_DPI;
  return Math.min(DPI_MAX, Math.max(DPI_MIN, n));
}

export function clampPublicationMm(mm: number, fallback: number): number {
  const n = Math.round(mm * 10) / 10;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(SIZE_MAX_MM, Math.max(SIZE_MIN_MM, n));
}

export function clampPublicationFontSize(size: number, fallback = DEFAULT_PUBLICATION_LEGEND_FONT_SIZE): number {
  const n = Math.round(size);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, n));
}

export function mmToLogicalPx(mm: number): number {
  return Math.max(1, Math.round((mm / MM_PER_INCH) * CSS_DPI));
}

export function pxToLogicalMm(px: number): number {
  return Math.round(((px / CSS_DPI) * MM_PER_INCH) * 10) / 10;
}

export function finalRasterPx(mm: number, dpi: number): number {
  return Math.max(1, Math.round((mm / MM_PER_INCH) * clampPublicationDpi(dpi)));
}

export function pngScaleForDpi(dpi: number): number {
  return clampPublicationDpi(dpi) / CSS_DPI;
}

export function publicationExportPixels(
  settings: PublicationExportSettings,
  options?: { reserveLegend?: boolean },
): PublicationExportPixels {
  let plotWidthPx: number;
  let plotHeightPx: number;

  if (
    settings.isCurrentView &&
    settings.sourceDimensionsPx &&
    typeof settings.sourceDimensionsPx.width === "number" &&
    settings.sourceDimensionsPx.width > 0 &&
    typeof settings.sourceDimensionsPx.height === "number" &&
    settings.sourceDimensionsPx.height > 0
  ) {
    plotWidthPx = Math.max(1, Math.round(settings.sourceDimensionsPx.width));
    plotHeightPx = Math.max(1, Math.round(settings.sourceDimensionsPx.height));
  } else {
    plotWidthPx = mmToLogicalPx(settings.widthMm);
    plotHeightPx = mmToLogicalPx(settings.heightMm);
  }

  const legendReserveWidthPx = options?.reserveLegend ? mmToLogicalPx(LEGEND_RESERVE_MM) : 0;
  return {
    plotWidthPx,
    plotHeightPx,
    canvasWidthPx: plotWidthPx + legendReserveWidthPx,
    canvasHeightPx: plotHeightPx,
    legendReserveWidthPx,
  };
}

export function publicationFilenameSuffix(settings: PublicationExportSettings, format: PublicationExportFormat): string {
  if (settings.isCurrentView) {
    return format === "png"
      ? `1to1_display_${clampPublicationDpi(settings.dpi)}dpi`
      : "1to1_display_vector";
  }
  const size = `${Math.round(settings.widthMm)}x${Math.round(settings.heightMm)}mm`;
  return format === "png" ? `${size}_${clampPublicationDpi(settings.dpi)}dpi` : `${size}_vector`;
}

export function sanitizeFilenamePart(value: string, fallback = "figure"): string {
  const clean = value.trim().replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9_-]+/g, "_");
  return clean || fallback;
}

export function describePublicationExport(settings: PublicationExportSettings): string {
  const dpi = clampPublicationDpi(settings.dpi);
  if (settings.isCurrentView) {
    const wPx = settings.sourceDimensionsPx?.width ?? mmToLogicalPx(settings.widthMm);
    const hPx = settings.sourceDimensionsPx?.height ?? mmToLogicalPx(settings.heightMm);
    const scale = pngScaleForDpi(dpi);
    const rasterW = Math.round(wPx * scale);
    const rasterH = Math.round(hPx * scale);
    return `Current View 1:1 (${wPx} x ${hPx} px card). PNG @ ${dpi} DPI -> ${rasterW} x ${rasterH} px. Exact screen aspect ratio & active zoom.`;
  }
  return `Plot area ${settings.widthMm} x ${settings.heightMm} mm, PNG ${dpi} DPI -> ${finalRasterPx(settings.widthMm, dpi)} x ${finalRasterPx(settings.heightMm, dpi)} px. Legends export vertically on the right with extra space.`;
}

export async function exportPlotlyPublicationImage(
  graphDiv: PlotlyHTMLElement,
  request: PublicationExportRequest,
  options?: {
    layoutOverrides?: Partial<Layout>;
    dataOverrides?: Partial<Data>;
    config?: Partial<Config>;
  },
): Promise<void> {
  const plotlyModule = await import("plotly.js-dist-min");
  const plotly = plotlyModule.default;
  const source = graphDiv as PlotlyHTMLElement & {
    data?: Data[];
    layout?: Partial<Layout>;
    _fullLayout?: Record<string, unknown>;
  };
  const data = clonePlotData(source.data ?? [], request.format, options?.dataOverrides);
  const reserveLegend = shouldReserveLegend(source.layout, options?.layoutOverrides);
  const pixels = publicationExportPixels(request, { reserveLegend });
  const layout = buildPublicationLayout(
    source.layout,
    source._fullLayout,
    pixels,
    request.legendFontSize,
    options?.layoutOverrides,
    Boolean(request.isCurrentView),
  );
  const tempDiv = document.createElement("div");
  tempDiv.style.position = "fixed";
  tempDiv.style.left = "-10000px";
  tempDiv.style.top = "0";
  tempDiv.style.width = `${pixels.canvasWidthPx}px`;
  tempDiv.style.height = `${pixels.canvasHeightPx}px`;
  tempDiv.style.pointerEvents = "none";
  tempDiv.setAttribute("aria-hidden", "true");
  document.body.appendChild(tempDiv);
  try {
    await plotly.newPlot(tempDiv, data, layout, {
      displaylogo: false,
      responsive: false,
      staticPlot: true,
      ...options?.config,
    });
    await plotly.downloadImage(tempDiv as unknown as PlotlyHTMLElement, {
      format: request.format,
      filename: request.filename,
      width: pixels.canvasWidthPx,
      height: pixels.canvasHeightPx,
      scale: request.format === "png" ? pngScaleForDpi(request.dpi) : 1,
    });
  } finally {
    plotly.purge(tempDiv);
    tempDiv.remove();
  }
}

export function sanitizeAnnotation(ann: unknown): Record<string, unknown> {
  if (!isRecord(ann)) return {};
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(ann)) {
    // Strip private Plotly runtime DOM / D3 references (e.g. _dragRef, _text, _arrowpath, _rect)
    if (key.startsWith("_") || typeof value === "function") continue;
    clean[key] = clonePlain(value);
  }
  return clean;
}

export function buildPublicationLayout(
  sourceLayout: Partial<Layout> | undefined,
  fullLayout: Record<string, unknown> | undefined,
  pixels: PublicationExportPixels,
  legendFontSize: number,
  overrides?: Partial<Layout>,
  isCurrentView?: boolean,
): Partial<Layout> {
  const source = cleanObjectTree(sourceLayout ?? {});
  // Figures are always exported on white; the night theme's light text colour is screen-only.
  if (isRecord(source.font) && source.font.color === PLOTLY_THEME_COLORS.night.screenFontColor) {
    delete source.font.color;
  }
  const sourceMargin = isRecord(source.margin) ? source.margin : {};
  const overrideMargin = isRecord(overrides?.margin) ? overrides.margin : {};

  const leftMargin = typeof overrideMargin.l === "number"
    ? overrideMargin.l
    : typeof sourceMargin.l === "number"
    ? Math.max(68, sourceMargin.l)
    : 68;

  const topMargin = typeof overrideMargin.t === "number"
    ? overrideMargin.t
    : typeof sourceMargin.t === "number"
    ? sourceMargin.t
    : (source.title ? 28 : 16);

  const bottomMargin = typeof overrideMargin.b === "number"
    ? overrideMargin.b
    : typeof sourceMargin.b === "number"
    ? sourceMargin.b
    : 45;

  const rightMargin = (typeof sourceMargin.r === "number" ? sourceMargin.r : 18) +
    (typeof overrideMargin.r === "number" ? overrideMargin.r - (typeof sourceMargin.r === "number" ? sourceMargin.r : 18) : 0) +
    pixels.legendReserveWidthPx;

  const layout: Partial<Layout> = {
    ...source,
    ...overrides,
    autosize: false,
    width: pixels.canvasWidthPx,
    height: pixels.canvasHeightPx,
    margin: {
      l: leftMargin,
      t: topMargin,
      b: bottomMargin,
      r: rightMargin,
    },
    font: isCurrentView && isRecord(source.font)
      ? { ...source.font, ...(overrides?.font ?? {}) }
      : {
          family: "Arial, Helvetica, sans-serif",
          size: 10,
          color: "#111827",
          ...(isRecord(source.font) ? source.font : {}),
          ...(overrides?.font ?? {}),
        },
    paper_bgcolor: "#ffffff",
    plot_bgcolor: "#ffffff",
    barmode: (overrides?.barmode ?? source.barmode ?? "overlay") as Layout["barmode"],
    bargap: typeof overrides?.bargap === "number"
      ? overrides.bargap
      : typeof source.bargap === "number"
      ? source.bargap
      : 0,
  };

  // Preserve active live zoom range if available from Plotly's _fullLayout or source
  const fullXAxis = isRecord(fullLayout?.xaxis) ? (fullLayout.xaxis as Record<string, unknown>) : undefined;
  const liveXRange = (Array.isArray(fullXAxis?.range) ? fullXAxis.range : undefined) ??
    (isRecord(source.xaxis) && Array.isArray(source.xaxis.range) ? source.xaxis.range : undefined);

  const fullYAxis = isRecord(fullLayout?.yaxis) ? (fullLayout.yaxis as Record<string, unknown>) : undefined;
  const liveYRange = (Array.isArray(fullYAxis?.range) ? fullYAxis.range : undefined) ??
    (isRecord(source.yaxis) && Array.isArray(source.yaxis.range) ? source.yaxis.range : undefined);

  if (layout.showlegend && pixels.legendReserveWidthPx > 0) {
    const legendFont = {
      ...(isRecord(source.legend) && isRecord(source.legend.font) ? source.legend.font : {}),
      ...(isRecord(overrides?.legend) && isRecord(overrides.legend.font) ? overrides.legend.font : {}),
      size: clampPublicationFontSize(legendFontSize, readAxisTitleFontSize(source, overrides)),
    };
    layout.legend = {
      ...(isRecord(source.legend) ? source.legend : {}),
      ...(isRecord(overrides?.legend) ? overrides?.legend : {}),
      font: legendFont,
      orientation: "v",
      x: 1.02,
      xanchor: "left",
      y: 1,
      yanchor: "top",
    } as Layout["legend"];
  }

  layout.xaxis = exportAxis(source.xaxis, overrides?.xaxis, isCurrentView, liveXRange) as Layout["xaxis"];
  layout.yaxis = exportAxis(source.yaxis, overrides?.yaxis, isCurrentView, liveYRange) as Layout["yaxis"];

  // Sanitize all annotations so live DOM nodes do not break newPlot
  if (Array.isArray(layout.annotations)) {
    layout.annotations = layout.annotations.map(sanitizeAnnotation) as Layout["annotations"];
  }

  return layout;
}

function readAxisTitleFontSize(source: Partial<Layout>, overrides?: Partial<Layout>): number {
  const overrideSize = readOneAxisTitleFontSize(overrides?.xaxis) ?? readOneAxisTitleFontSize(overrides?.yaxis);
  const sourceSize = readOneAxisTitleFontSize(source.xaxis) ?? readOneAxisTitleFontSize(source.yaxis);
  return overrideSize ?? sourceSize ?? 10;
}

function readOneAxisTitleFontSize(axis: unknown): number | null {
  if (!isRecord(axis)) return null;
  const title = axis.title;
  if (isRecord(title) && isRecord(title.font) && typeof title.font.size === "number" && Number.isFinite(title.font.size)) {
    return title.font.size;
  }
  const titlefont = axis.titlefont;
  if (isRecord(titlefont) && typeof titlefont.size === "number" && Number.isFinite(titlefont.size)) {
    return titlefont.size;
  }
  return null;
}

function shouldReserveLegend(sourceLayout: Partial<Layout> | undefined, overrides?: Partial<Layout>): boolean {
  if (overrides?.showlegend === false) return false;
  if (overrides?.showlegend === true) return true;
  return sourceLayout?.showlegend === true;
}

function exportAxis(
  source: unknown,
  override: unknown,
  isCurrentView?: boolean,
  liveRange?: unknown[],
): unknown {
  const sourceAxis = isRecord(source) ? source : {};
  const overrideAxis = isRecord(override) ? override : {};

  // Strip private Plotly runtime keys
  const cleanSource: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(sourceAxis)) {
    if (!k.startsWith("_") && typeof v !== "function") {
      cleanSource[k] = clonePlain(v);
    }
  }

  // If a live range is available and no override is provided, preserve it and disable autorange
  if (
    Array.isArray(liveRange) &&
    liveRange.length === 2 &&
    Number.isFinite(Number(liveRange[0])) &&
    Number.isFinite(Number(liveRange[1])) &&
    !overrideAxis.range
  ) {
    cleanSource.range = [Number(liveRange[0]), Number(liveRange[1])];
    cleanSource.autorange = false;
  }

  // On screen axes show ×10ⁿ; exported figures keep the e-notation they have always used.
  if (cleanSource.exponentformat === "power") cleanSource.exponentformat = "e";

  if (isCurrentView) {
    return {
      ...cleanSource,
      ...overrideAxis,
    };
  }

  return {
    ...cleanSource,
    titlefont: {
      size: 10,
      ...(isRecord(cleanSource.titlefont) ? cleanSource.titlefont : {}),
      ...(isRecord(overrideAxis.titlefont) ? overrideAxis.titlefont : {}),
    },
    tickfont: {
      size: 8,
      ...(isRecord(cleanSource.tickfont) ? cleanSource.tickfont : {}),
      ...(isRecord(overrideAxis.tickfont) ? overrideAxis.tickfont : {}),
    },
    linecolor: cleanSource.linecolor ?? "#111827",
    linewidth: cleanSource.linewidth ?? 1,
    tickcolor: cleanSource.tickcolor ?? "#111827",
    tickwidth: cleanSource.tickwidth ?? 1,
    ticks: cleanSource.ticks ?? "outside",
    ticklen: cleanSource.ticklen ?? 4,
    showline: cleanSource.showline ?? true,
    mirror: cleanSource.mirror ?? true,
    ...overrideAxis,
  };
}

export function clonePlotData(data: Data[], format: PublicationExportFormat, overrides?: Partial<Data>): Data[] {
  return data.map((trace) => {
    // If trace has original _input, prefer it to bypass stale Plotly DOM bindings
    const sourceTrace = isRecord(trace) && isRecord((trace as unknown as { _input?: unknown })._input)
      ? (trace as unknown as { _input: unknown })._input
      : trace;
    const cloned = cleanObjectTree(sourceTrace) as Record<string, unknown>;

    // A trace drawn in a theme colour on screen carries its own colour in meta.exportColor.
    const exportColor = isRecord(cloned.meta) ? cloned.meta.exportColor : undefined;
    if (typeof exportColor === "string") {
      if (isRecord(cloned.line)) cloned.line = { ...cloned.line, color: exportColor };
      if (isRecord(cloned.marker) && typeof cloned.marker.color === "string") {
        cloned.marker = { ...cloned.marker, color: exportColor };
      }
    }

    if (format === "svg" && cloned.type === "scattergl") {
      cloned.type = "scatter";
    }

    // For mass spectrometry centroid bar traces:
    // Ensure an outline stroke is present so thin bars do not disappear in SVG or low-res raster
    if (cloned.type === "bar") {
      const marker = isRecord(cloned.marker) ? { ...cloned.marker } : {};
      const markerColor = (marker.color as string) || "#2563eb";
      const existingLine = isRecord(marker.line) ? marker.line : {};
      const lineWidth = typeof existingLine.width === "number" && existingLine.width > 0 ? existingLine.width : 0.8;
      marker.line = {
        color: existingLine.color || markerColor,
        width: lineWidth,
        ...existingLine,
      };
      cloned.marker = marker;
    }

    return { ...cloned, ...overrides } as Data;
  }) as Data[];
}

function cleanObjectTree(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {};
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (k.startsWith("_") || typeof v === "function") continue;
    if (Array.isArray(v)) {
      result[k] = v.map((item) => (isRecord(item) ? cleanObjectTree(item) : clonePlain(item)));
    } else if (isRecord(v)) {
      result[k] = cleanObjectTree(v);
    } else {
      result[k] = clonePlain(v);
    }
  }
  return result;
}

function clonePlain<T>(value: T): T {
  if (value == null) return value;
  if (typeof structuredClone === "function") {
    try {
      return structuredClone(value);
    } catch {
      // Fall through to JSON cloning for Plotly's plain data/layout objects.
    }
  }
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    return value;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
