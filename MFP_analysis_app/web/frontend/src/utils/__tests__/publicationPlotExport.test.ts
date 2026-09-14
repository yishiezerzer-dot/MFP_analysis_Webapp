import { describe, expect, it } from "vitest";
import {
  clampPublicationDpi,
  clampPublicationFontSize,
  clampPublicationMm,
  describePublicationExport,
  finalRasterPx,
  mmToLogicalPx,
  publicationExportPixels,
  pngScaleForDpi,
  publicationFilenameSuffix,
  PUBLICATION_WIDTH_PRESETS,
  pxToLogicalMm,
  sanitizeAnnotation,
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

  it("provides standard journal size presets for ACS, Nature, and RSC", () => {
    const acsSingle = PUBLICATION_WIDTH_PRESETS.find((p) => p.id === "acs-single");
    const acsDouble = PUBLICATION_WIDTH_PRESETS.find((p) => p.id === "acs-double");
    const natureSingle = PUBLICATION_WIDTH_PRESETS.find((p) => p.id === "nature-single");
    const natureDouble = PUBLICATION_WIDTH_PRESETS.find((p) => p.id === "nature-double");
    const rscSingle = PUBLICATION_WIDTH_PRESETS.find((p) => p.id === "rsc-single");
    const rscDouble = PUBLICATION_WIDTH_PRESETS.find((p) => p.id === "rsc-double");

    expect(acsSingle?.widthMm).toBe(82.5);
    expect(acsDouble?.widthMm).toBe(177.8);
    expect(natureSingle?.widthMm).toBe(89);
    expect(natureDouble?.widthMm).toBe(180);
    expect(rscSingle?.widthMm).toBe(83);
    expect(rscDouble?.widthMm).toBe(171);
  });

  it("converts pixels to logical mm correctly", () => {
    expect(pxToLogicalMm(96)).toBe(25.4);
    expect(pxToLogicalMm(1200)).toBeCloseTo(317.5, 1);
  });

  it("supports 1:1 Current View pixel calculations with sourceDimensionsPx", () => {
    const settings = {
      widthMm: 317.5,
      heightMm: 105.8,
      dpi: 600,
      legendFontSize: 13,
      isCurrentView: true,
      sourceDimensionsPx: { width: 1420, height: 420 },
    };
    const pixels = publicationExportPixels(settings, { reserveLegend: false });
    expect(pixels.plotWidthPx).toBe(1420);
    expect(pixels.plotHeightPx).toBe(420);
    expect(pixels.canvasWidthPx).toBe(1420);
    expect(pixels.canvasHeightPx).toBe(420);
  });

  it("generates 1:1 display filename suffixes", () => {
    const settings = {
      widthMm: 317.5,
      heightMm: 105.8,
      dpi: 600,
      legendFontSize: 13,
      isCurrentView: true,
    };
    expect(publicationFilenameSuffix(settings, "png")).toBe("1to1_display_600dpi");
    expect(publicationFilenameSuffix(settings, "svg")).toBe("1to1_display_vector");
  });

  it("describes 1:1 current view export accurately", () => {
    const settings = {
      widthMm: 317.5,
      heightMm: 105.8,
      dpi: 600,
      legendFontSize: 13,
      isCurrentView: true,
      sourceDimensionsPx: { width: 1200, height: 400 },
    };
    const desc = describePublicationExport(settings);
    expect(desc).toContain("Current View 1:1");
    expect(desc).toContain("1200 x 400 px");
    expect(desc).toContain("7500 x 2500 px"); // 1200 * 6.25, 400 * 6.25
  });

  it("sanitizes annotations by stripping private Plotly runtime DOM keys", () => {
    const dirtyAnnotation = {
      x: 523.2345,
      y: 100,
      text: "Peak 1",
      textangle: "-90",
      showarrow: true,
      arrowhead: 2,
      arrowcolor: "#7c3aed",
      ax: 0,
      ay: -46,
      bgcolor: "rgba(124, 58, 237, 0.12)",
      font: { size: 10, color: "#7c3aed" },
      // Plotly runtime internal DOM nodes / metadata:
      _dragRef: {},
      _text: { text: "Peak 1" },
      _arrowpath: {},
      _rect: {},
      _textBBox: { width: 60, height: 14 },
    };

    const clean = sanitizeAnnotation(dirtyAnnotation);
    expect(clean.x).toBe(523.2345);
    expect(clean.text).toBe("Peak 1");
    expect(clean.textangle).toBe("-90");
    expect(clean.showarrow).toBe(true);
    expect(clean.arrowcolor).toBe("#7c3aed");
    expect(clean.ay).toBe(-46);
    expect(clean.font).toEqual({ size: 10, color: "#7c3aed" });

    // Ensure all '_' prefixed properties were stripped
    expect(clean).not.toHaveProperty("_dragRef");
    expect(clean).not.toHaveProperty("_text");
    expect(clean).not.toHaveProperty("_arrowpath");
    expect(clean).not.toHaveProperty("_rect");
    expect(clean).not.toHaveProperty("_textBBox");
  });
});
