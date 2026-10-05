import { describe, expect, it } from "vitest";
import { displayY, fromDisplayY } from "../FTIRView";

describe("FTIR transmittance display", () => {
  it("shows absorbance as %T and converts chart clicks back", () => {
    expect(displayY(0, "transmittance")).toBeCloseTo(100);
    expect(displayY(1, "transmittance")).toBeCloseTo(10);
    expect(displayY(0.3, "absorbance")).toBe(0.3);
    expect(fromDisplayY(displayY(0.42, "transmittance"), "transmittance")).toBeCloseTo(0.42);
  });
});
