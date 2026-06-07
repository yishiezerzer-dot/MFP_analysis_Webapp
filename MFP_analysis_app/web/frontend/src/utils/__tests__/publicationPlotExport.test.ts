import { describe, expect, it } from "vitest";
import {
  clampPublicationDpi,
  clampPublicationFontSize,
  clampPublicationMm,
  finalRasterPx,
  mmToLogicalPx,
  publicationExportPixels,
  pngScaleForDpi,
  publicationFilenameSuffix,
} from "../publicationPlotExport";

describe("publication plot export sizing", () => {
  it("uses CSS pixels for logical Plotly layout size", () => {
    expect(mmToLogicalPx(25.4)).toBe(96);
    expect(mmToLogicalPx(180)).toBe(680);
  });

  it("uses DPI only for final raster dimensions and scale", () => {
    expect(finalRasterPx(25.4, 600)).toBe(600);
    expect(finalRasterPx(180, 600)).toBe(4252);
    expect(pngScaleForDpi(600)).toBeCloseTo(6.25);
  });

  it("clamps unsupported DPI values", () => {
    expect(clampPublicationDpi(12)).toBe(72);
    expect(clampPublicationDpi(1500)).toBe(1200);
    expect(clampPublicationDpi(Number.NaN)).toBe(600);
  });

  it("clamps manual publication dimensions", () => {
    expect(clampPublicationMm(12, 90)).toBe(30);
    expect(clampPublicationMm(300, 90)).toBe(260);
    expect(clampPublicationMm(Number.NaN, 90)).toBe(90);
    expect(clampPublicationMm(135.26, 90)).toBe(135.3);
  });

  it("clamps manual legend font size", () => {
    expect(clampPublicationFontSize(2)).toBe(4);
    expect(clampPublicationFontSize(48)).toBe(36);
    expect(clampPublicationFontSize(Number.NaN, 13)).toBe(13);
    expect(clampPublicationFontSize(12.4)).toBe(12);
  });

  it("keeps legend reserve outside the requested plot area", () => {
    const settings = { widthMm: 180, heightMm: 100, dpi: 600, legendFontSize: 13 };
    expect(publicationExportPixels(settings, { reserveLegend: false })).toEqual({
      plotWidthPx: 680,
      plotHeightPx: 378,
      canvasWidthPx: 680,
      canvasHeightPx: 378,
      legendReserveWidthPx: 0,
    });
    expect(publicationExportPixels(settings, { reserveLegend: true })).toEqual({
      plotWidthPx: 680,
      plotHeightPx: 378,
      canvasWidthPx: 824,
      canvasHeightPx: 378,
      legendReserveWidthPx: 144,
    });
  });

  it("keeps SVG suffix vector-specific and PNG suffix DPI-specific", () => {
    const settings = { widthMm: 180, heightMm: 100, dpi: 600, legendFontSize: 13 };
    expect(publicationFilenameSuffix(settings, "svg")).toBe("180x100mm_vector");
    expect(publicationFilenameSuffix(settings, "png")).toBe("180x100mm_600dpi");
  });
});
