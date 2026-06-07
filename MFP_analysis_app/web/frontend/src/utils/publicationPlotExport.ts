import type { Config, Data, Layout, PlotlyHTMLElement } from "plotly.js";

export type PublicationExportFormat = "svg" | "png";

export interface PublicationSizePreset {
  label: string;
  widthMm: number;
  heightMm: number;
}

export interface PublicationExportSettings {
  widthMm: number;
  heightMm: number;
  dpi: number;
  legendFontSize: number;
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

export const PUBLICATION_WIDTH_PRESETS: PublicationSizePreset[] = [
  { label: "90 x 60 mm", widthMm: 90, heightMm: 60 },
  { label: "135 x 80 mm", widthMm: 135, heightMm: 80 },
  { label: "180 x 100 mm", widthMm: 180, heightMm: 100 },
  { label: "180 x 120 mm", widthMm: 180, heightMm: 120 },
];

export const DEFAULT_PUBLICATION_SIZE = PUBLICATION_WIDTH_PRESETS[2];

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
  const plotWidthPx = mmToLogicalPx(settings.widthMm);
  const plotHeightPx = mmToLogicalPx(settings.heightMm);
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
  const size = `${Math.round(settings.widthMm)}x${Math.round(settings.heightMm)}mm`;
  return format === "png" ? `${size}_${clampPublicationDpi(settings.dpi)}dpi` : `${size}_vector`;
}

export function sanitizeFilenamePart(value: string, fallback = "figure"): string {
  const clean = value.trim().replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9_-]+/g, "_");
  return clean || fallback;
}

export function describePublicationExport(settings: PublicationExportSettings): string {
  const dpi = clampPublicationDpi(settings.dpi);
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
  };
  const data = clonePlotData(source.data ?? [], request.format, options?.dataOverrides);
  const reserveLegend = shouldReserveLegend(source.layout, options?.layoutOverrides);
  const pixels = publicationExportPixels(request, { reserveLegend });
  const layout = buildPublicationLayout(source.layout, pixels, request.legendFontSize, options?.layoutOverrides);
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

function buildPublicationLayout(
  sourceLayout: Partial<Layout> | undefined,
  pixels: PublicationExportPixels,
  legendFontSize: number,
  overrides?: Partial<Layout>,
): Partial<Layout> {
  const source = clonePlain(sourceLayout ?? {});
  const sourceMargin = source.margin ?? {};
  const overrideMargin = overrides?.margin ?? {};
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
      l: 58,
      t: source.title ? 28 : 14,
      ...(source.margin ?? {}),
      ...(overrides?.margin ?? {}),
      r: rightMargin,
    },
    font: {
      family: "Arial, Helvetica, sans-serif",
      size: 10,
      color: "#111827",
      ...(source.font ?? {}),
      ...(overrides?.font ?? {}),
    },
    paper_bgcolor: "#ffffff",
    plot_bgcolor: "#ffffff",
  };
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
  layout.xaxis = exportAxis(source.xaxis, overrides?.xaxis) as Layout["xaxis"];
  layout.yaxis = exportAxis(source.yaxis, overrides?.yaxis) as Layout["yaxis"];
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

function exportAxis(source: unknown, override: unknown): unknown {
  const sourceAxis = isRecord(source) ? source : {};
  const overrideAxis = isRecord(override) ? override : {};
  return {
    ...sourceAxis,
    ...overrideAxis,
    titlefont: { size: 10, ...(isRecord(sourceAxis.titlefont) ? sourceAxis.titlefont : {}), ...(isRecord(overrideAxis.titlefont) ? overrideAxis.titlefont : {}) },
    tickfont: { size: 8, ...(isRecord(sourceAxis.tickfont) ? sourceAxis.tickfont : {}), ...(isRecord(overrideAxis.tickfont) ? overrideAxis.tickfont : {}) },
    linecolor: "#111827",
    linewidth: 1,
    tickcolor: "#111827",
    tickwidth: 1,
  };
}

function clonePlotData(data: Data[], format: PublicationExportFormat, overrides?: Partial<Data>): Data[] {
  return data.map((trace) => {
    const cloned = clonePlain(trace) as Data;
    if (format === "svg" && isRecord(cloned) && cloned.type === "scattergl") {
      cloned.type = "scatter";
    }
    return { ...cloned, ...overrides };
  }) as Data[];
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
  return JSON.parse(JSON.stringify(value)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
