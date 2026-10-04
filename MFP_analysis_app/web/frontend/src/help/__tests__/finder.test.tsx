import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { useState } from "react";
import type { ControlHint } from "../controls";
import { scoreControl, searchFinder } from "../controlSearch";
import { FLASH_ATTR, hasPanelHandler, revealControl, useRevealPanel } from "../reveal";

const baseline: ControlHint = {
  id: "ftir.test.baseline",
  tab: "ftir",
  label: "Baseline lambda",
  what: "How stiff the fitted baseline is. Higher = smoother.",
  keywords: ["background", "asls"],
};
const exportSvg: ControlHint = {
  id: "lcms.test.export",
  tab: "lcms",
  label: "Export figure",
  what: "Save the chart as SVG or PNG for a paper, including a baseline correction note.",
};

describe("scoreControl", () => {
  it("matches word starts in label, keywords and explanation, ignoring case and accents", () => {
    expect(scoreControl(baseline, "Basel", "ftir")).toBeGreaterThan(0);
    expect(scoreControl(baseline, "backgr", "ftir")).toBeGreaterThan(0);
    expect(scoreControl(baseline, "smoother", "ftir")).toBeGreaterThan(0);
    expect(scoreControl(baseline, "aseline", "ftir")).toBe(0);
    expect(scoreControl({ ...baseline, label: "Café filter" }, "cafe", "ftir")).toBeGreaterThan(0);
  });

  it("ranks a label match above an explanation match, and the current tab first", () => {
    expect(scoreControl(baseline, "baseline", "lcms")).toBeGreaterThan(scoreControl(exportSvg, "baseline", "lcms") - 30);
    expect(scoreControl(baseline, "baseline", "ftir")).toBeGreaterThan(scoreControl(baseline, "baseline", "lcms"));
    expect(scoreControl(exportSvg, "export", "lcms")).toBeGreaterThan(scoreControl(exportSvg, "svg", "lcms"));
  });

  it("needs every query word to match", () => {
    expect(scoreControl(baseline, "baseline zebra", "ftir")).toBe(0);
  });
});

describe("searchFinder", () => {
  it("finds app-wide controls and help topics", () => {
    const results = searchFinder("help", "plate-reader");
    expect(results[0]).toMatchObject({ kind: "control", control: { id: "app.help" } });
    const topics = searchFinder("excluded wells", "plate-reader").filter((r) => r.kind === "topic");
    expect(topics.length).toBeGreaterThan(0);
  });

  it("returns nothing for an empty query", () => {
    expect(searchFinder("   ", "ftir")).toEqual([]);
  });
});

function Panel() {
  const [open, setOpen] = useState(false);
  useRevealPanel({ "test.panel": () => setOpen(true) });
  return open ? (
    <span data-control="app.help">
      <button type="button">inside</button>
    </span>
  ) : null;
}

describe("revealControl", () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = () => {};
  });
  afterEach(cleanup);

  it("registers panel handlers while the view is mounted", () => {
    const { unmount } = render(<Panel />);
    expect(hasPanelHandler("test.panel")).toBe(true);
    unmount();
    expect(hasPanelHandler("test.panel")).toBe(false);
  });

  it("flashes and focuses a control that is on screen", async () => {
    render(
      <span data-control="app.help">
        <button type="button">Help</button>
      </span>,
    );
    expect(await revealControl("app.help")).toBe("shown");
    const marked = document.querySelector('[data-control="app.help"]') as HTMLElement;
    expect(marked.hasAttribute(FLASH_ATTR)).toBe(true);
    expect(document.activeElement?.textContent).toBe("Help");
  });

  it("reports a control that never appears", async () => {
    expect(await revealControl("app.findControl", 50)).toBe("not-found");
  });
});
