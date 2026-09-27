import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SideRail } from "../SideRail";

function renderRail(compact: boolean) {
  vi.stubGlobal("matchMedia", () => ({ matches: compact, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  render(
    <SideRail label="Sessions" rail={<span>rail items</span>}>
      {(close) => (
        <button type="button" onClick={close}>
          Sample_A
        </button>
      )}
    </SideRail>,
  );
  return screen.getByRole("complementary", { name: "Sessions" });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SideRail", () => {
  it("is always open on desktop widths", () => {
    const rail = renderRail(false);
    expect(rail.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Sample_A")).toBeDefined();
  });

  it("is a rail on laptops that opens on click and closes on Escape or outside click", () => {
    const rail = renderRail(true);
    expect(rail.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByText("rail items")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Open sessions" }));
    expect(rail.getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(rail.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: "Open sessions" }));
    fireEvent.mouseDown(document.body);
    expect(rail.getAttribute("aria-expanded")).toBe("false");
  });

  it("lets the content close the overlay (e.g. after choosing an item)", () => {
    const rail = renderRail(true);
    fireEvent.click(screen.getByRole("button", { name: "Open sessions" }));
    fireEvent.click(screen.getByText("Sample_A"));
    expect(rail.getAttribute("aria-expanded")).toBe("false");
  });
});
