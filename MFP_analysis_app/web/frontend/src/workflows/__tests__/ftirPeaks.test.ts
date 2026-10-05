import { describe, expect, it } from "vitest";
import { FTIR_DEFAULTS, ftirRequest } from "../ftirPeaks";

describe("Identify FTIR peaks: answers → settings", () => {
  it("uses the sample type's preset and the chosen number of peaks", () => {
    const request = ftirRequest({ ...FTIR_DEFAULTS, sample: "ATR sample", amount: "main", exclude: ["amide", "amine"] }, "s1");
    expect(request.sid).toBe("s1");
    expect(request.preprocess).toMatchObject({ baseline: "rubberband", atr_correction: true });
    expect(request.peaks).toEqual({ top_n: 10, min_prominence: 0.02 });
    expect(request.exclude).toEqual(["amide", "amine"]);
  });

  it("leaves a raw film unprocessed", () => {
    expect(ftirRequest({ ...FTIR_DEFAULTS, sample: "Raw film" }, "s1").preprocess).toMatchObject({ baseline: "none", smoothing_window: 0 });
  });
});
