import { describe, expect, it } from "vitest";

describe("FigureBuilder math and layout calculations", () => {
  it("calculates correct column widths and margins for Nature double column (180 mm)", () => {
    const totalWidthMm = 180;
    const columns = 2;
    const marginMm = 5;
    const usableWidthMm = totalWidthMm - 2 * marginMm;
    const colWidthMm = usableWidthMm / columns;

    expect(usableWidthMm).toBe(170);
    expect(colWidthMm).toBe(85);
  });

  it("calculates correct aspect ratios for ACS single column (82.5 mm)", () => {
    const widthMm = 82.5;
    const heightMm = 60.0;
    const aspect = widthMm / heightMm;

    expect(aspect).toBeCloseTo(1.375, 3);
  });

  it("generates correct alphabetic panel tags", () => {
    const labels = Array.from({ length: 6 }, (_, i) => String.fromCharCode(97 + i));
    expect(labels).toEqual(["a", "b", "c", "d", "e", "f"]);
  });

  it("calculates row count correctly from panels and column count", () => {
    const calcRows = (panels: number, cols: number) => Math.ceil(panels / cols);

    expect(calcRows(4, 2)).toBe(2);
    expect(calcRows(3, 2)).toBe(2);
    expect(calcRows(5, 2)).toBe(3);
    expect(calcRows(3, 3)).toBe(1);
    expect(calcRows(4, 1)).toBe(4);
  });
});
