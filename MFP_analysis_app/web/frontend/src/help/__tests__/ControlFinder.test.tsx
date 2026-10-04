import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HelpProvider } from "../HelpProvider";
import { ControlFinder } from "../../components/ControlFinder";
import { ToastProvider } from "../../components/Toast";

function renderFinder() {
  return render(
    <MemoryRouter initialEntries={["/plate-reader"]}>
      <ToastProvider>
        <HelpProvider>
          <ControlFinder />
        </HelpProvider>
      </ToastProvider>
    </MemoryRouter>,
  );
}

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
});
afterEach(cleanup);

describe("ControlFinder", () => {
  it("opens with Ctrl+K, filters as you type and closes with Esc", () => {
    renderFinder();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "find a con" } });
    const options = screen.getAllByRole("option");
    expect(options[0].textContent).toContain("Find a control");
    expect(options[0].getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens the help drawer at a help topic chosen with the keyboard", () => {
    renderFinder();
    fireEvent.click(screen.getByRole("button", { name: /find a control/i }));
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "excluded wells" } });
    const topicIndex = screen.getAllByRole("option").findIndex((o) => o.textContent?.startsWith("Help:"));
    expect(topicIndex).toBeGreaterThanOrEqual(0);
    for (let i = 0; i < topicIndex; i++) fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByRole("dialog").textContent).toContain("Plate Reader — help");
  });
});
