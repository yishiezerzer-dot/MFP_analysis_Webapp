import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { PAPER_DEFAULTS, bundleText, paperSettings } from "../paperPrep";
import { PaperFigureExportToolbar, exportShownFigures, shownFigureCount } from "../../components/PaperFigureExportToolbar";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("Prepare for paper", () => {
  it("turns the journal answer into export settings", () => {
    expect(paperSettings({ ...PAPER_DEFAULTS, sizeId: "nature-double", dpi: 300 })).toEqual({ widthMm: 180, heightMm: 100, dpi: 300, legendFontSize: 9 });
  });

  it("describes what an experiment contains", () => {
    expect(bundleText({ experiment_tag: "x", sessions: [], counts: { lcms: 1, ftir: 0, plate_reader: 3 } })).toBe("1 LC-MS run, 3 plates");
  });

  it("exports only charts that are shown and enabled, at the given settings", () => {
    const shown = vi.fn();
    const disabled = vi.fn();
    render(
      <>
        <PaperFigureExportToolbar onExport={shown} storageKey="a" />
        <PaperFigureExportToolbar onExport={disabled} storageKey="b" disabled />
      </>,
    );
    // jsdom has no layout: treat every element as shown.
    const spy = vi.spyOn(HTMLElement.prototype, "offsetParent", "get").mockReturnValue(document.body);
    expect(shownFigureCount()).toBe(1);
    const settings = paperSettings(PAPER_DEFAULTS);
    exportShownFigures(settings, ["svg", "png"]);
    expect(shown.mock.calls.map((c) => c[0])).toEqual(["svg", "png"]);
    expect(shown).toHaveBeenCalledWith("svg", settings);
    expect(disabled).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
