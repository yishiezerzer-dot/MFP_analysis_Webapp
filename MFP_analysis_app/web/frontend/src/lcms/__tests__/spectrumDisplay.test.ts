import { describe, expect, it } from "vitest";
import { spectrumDefaultRange, visibleLabelMask } from "../viewShared";

describe("spectrumDefaultRange", () => {
  it("fits significant peaks with 5% margin left and 10% right, ignoring low noise far out", () => {
    const mz = [100, 150, 200, 1400];
    const intensity = [1000, 500, 800, 1]; // 1400 is 0.1% of base: noise
    const [lo, hi] = spectrumDefaultRange(mz, intensity)!;
    expect(lo).toBeCloseTo(95);
    expect(hi).toBeCloseTo(210);
  });

  it("always includes labelled peaks, even small ones", () => {
    const [, hi] = spectrumDefaultRange([100, 200, 600], [1000, 800, 1], [600])!;
    expect(hi).toBeCloseTo(650);
  });

  it("never goes below zero and handles a single peak", () => {
    const [lo, hi] = spectrumDefaultRange([2], [10])!;
    expect(lo).toBeGreaterThanOrEqual(0);
    expect(hi).toBeGreaterThan(2);
  });

  it("returns undefined without data", () => {
    expect(spectrumDefaultRange([], [])).toBeUndefined();
  });
});

describe("visibleLabelMask", () => {
  const box = (x: number, priority: number, pinned = false) => ({ x, y: 50, width: 40, height: 14, priority, pinned });

  it("hides the lower-priority label of an overlapping pair", () => {
    expect(visibleLabelMask([box(100, 5), box(120, 9)])).toEqual([false, true]);
  });

  it("keeps labels that do not overlap", () => {
    expect(visibleLabelMask([box(100, 5), box(200, 9)])).toEqual([true, true]);
  });

  it("always keeps pinned (dragged) labels", () => {
    expect(visibleLabelMask([box(100, 1, true), box(110, 9)])).toEqual([true, false]);
  });

  it("is deterministic for equal priorities (earlier label wins)", () => {
    expect(visibleLabelMask([box(100, 5), box(110, 5)])).toEqual([true, false]);
  });
});
