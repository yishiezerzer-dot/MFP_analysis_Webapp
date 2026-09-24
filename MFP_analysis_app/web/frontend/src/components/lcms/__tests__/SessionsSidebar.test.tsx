import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SessionsSidebar } from "../SessionsSidebar";
import type { LCMSSessionSummary } from "../../../api";

const session = {
  session_id: "s1",
  display_name: "Sample_A.mzML",
  ms1_count: 10,
  rt_min: 0,
  rt_max: 5,
  polarities: ["positive"],
} as unknown as LCMSSessionSummary;

function renderCompact(onSelect = vi.fn()) {
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  render(
    <SessionsSidebar
      sessions={[session]}
      activeSid="s1"
      projects={[]}
      sessionProjectById={{}}
      activeProjectId="__all"
      onSelect={onSelect}
      onRemove={vi.fn()}
      onCreateProject={vi.fn()}
      onDeleteProject={vi.fn()}
      onMoveSession={vi.fn()}
      onSelectProject={vi.fn()}
    />,
  );
  return screen.getByRole("complementary", { name: "Sessions" });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SessionsSidebar on laptop widths", () => {
  it("starts as a rail and opens on click", () => {
    const rail = renderCompact();
    expect(rail.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Open sessions" }));
    expect(rail.getAttribute("aria-expanded")).toBe("true");
  });

  it("closes on Escape and on a click outside", () => {
    const rail = renderCompact();
    fireEvent.click(screen.getByRole("button", { name: "Open sessions" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(rail.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: "Open sessions" }));
    fireEvent.mouseDown(document.body);
    expect(rail.getAttribute("aria-expanded")).toBe("false");
  });

  it("closes after choosing a session", () => {
    const onSelect = vi.fn();
    const rail = renderCompact(onSelect);
    fireEvent.click(screen.getByRole("button", { name: "Open sessions" }));
    fireEvent.click(screen.getByText("Sample_A.mzML"));
    expect(onSelect).toHaveBeenCalledWith("s1");
    expect(rail.getAttribute("aria-expanded")).toBe("false");
  });
});
