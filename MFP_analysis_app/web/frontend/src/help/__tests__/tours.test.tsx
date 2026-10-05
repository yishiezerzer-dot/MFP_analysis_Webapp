import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { getControl } from "../controls";
import { TOURS } from "../tours";
import { TourProvider, useTour } from "../TourProvider";

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
});
afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("tours", () => {
  it("only point at controls that exist in the registry, with 5–7 short steps", () => {
    for (const tour of TOURS) {
      expect(tour.steps.length, tour.id).toBeGreaterThanOrEqual(5);
      expect(tour.steps.length, tour.id).toBeLessThanOrEqual(7);
      for (const step of tour.steps) {
        expect(getControl(step.control), `${tour.id} → ${step.control}`).toBeDefined();
        expect(step.text.length, step.control).toBeLessThanOrEqual(160);
      }
    }
  });
});

function StartButton() {
  const { startTour } = useTour();
  return (
    <button type="button" onClick={() => startTour("ai")}>
      start
    </button>
  );
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <TourProvider>
        <StartButton />
      </TourProvider>
    </MemoryRouter>,
  );
}

describe("TourProvider", () => {
  it("offers the tab's tour once", () => {
    renderAt("/ftir");
    expect(screen.getByRole("dialog", { name: /offer: ftir/i })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "No thanks" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    cleanup();
    renderAt("/ftir");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("does not offer a tour on Home", () => {
    renderAt("/home");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("steps forward and back and closes with Esc", async () => {
    window.localStorage.setItem("mfp.tour.offered.ftir", "1");
    renderAt("/ftir");
    fireEvent.click(screen.getByRole("button", { name: "start" }));
    const dialog = () => screen.getByRole("dialog", { name: "AI Assistant in one minute" });
    expect(dialog().textContent).toContain("1 of 5");
    expect(dialog().textContent).toContain("Choose a provider");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(dialog().textContent).toContain("2 of 5");
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(dialog().textContent).toContain("1 of 5");
    await act(async () => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
