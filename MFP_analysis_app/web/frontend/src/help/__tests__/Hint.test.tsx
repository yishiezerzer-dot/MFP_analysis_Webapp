import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HelpProvider } from "../HelpProvider";
import { HelpOpenButton } from "../HelpShell";

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <HelpProvider>
        <HelpOpenButton />
      </HelpProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Hint", () => {
  it("marks the control and shows label and explanation on hover", () => {
    vi.useFakeTimers();
    const { container } = renderAt("/plate-reader");
    const marked = container.querySelector('[data-control="app.help"]');
    expect(marked).not.toBeNull();
    fireEvent.mouseEnter(marked as Element);
    act(() => {
      vi.advanceTimersByTime(450);
    });
    expect(screen.getByRole("tooltip").textContent).toMatch(/^Help — Opens the guide for this tab/);
  });

  it("opens this tab's help with the Help button and with F1", () => {
    renderAt("/plate-reader");
    fireEvent.click(screen.getByRole("button", { name: "Help" }));
    expect(screen.getByRole("dialog").textContent).toContain("Plate Reader — help");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.keyDown(window, { key: "F1" });
    expect(screen.getByRole("dialog").textContent).toContain("Plate Reader — help");
  });
});
