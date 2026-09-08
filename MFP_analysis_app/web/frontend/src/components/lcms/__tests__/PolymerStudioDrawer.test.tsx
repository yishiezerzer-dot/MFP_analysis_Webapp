import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { PolymerStudioDrawer } from "../PolymerStudioDrawer";
import { loadPolymerUiSettings } from "../../../lcms/analysis";

afterEach(() => {
  cleanup();
});

describe("PolymerStudioDrawer", () => {
  it("does not render when closed", () => {
    const settings = loadPolymerUiSettings();
    render(
      <PolymerStudioDrawer
        open={false}
        onClose={vi.fn()}
        polarity="positive"
        settings={settings}
        onChange={vi.fn()}
        onExpectedProducts={vi.fn()}
        onKendrick={vi.fn()}
        canOpenExpectedProducts={false}
        canOpenKendrick={false}
        onSaveDefaults={vi.fn()}
      />,
    );
    expect(screen.queryByText(/Polymer Studio/i)).toBeNull();
  });

  it("renders when open and handles enabling matching", () => {
    const handleChange = vi.fn();
    const settings = loadPolymerUiSettings();

    render(
      <PolymerStudioDrawer
        open={true}
        onClose={vi.fn()}
        polarity="positive"
        settings={settings}
        onChange={handleChange}
        onExpectedProducts={vi.fn()}
        onKendrick={vi.fn()}
        canOpenExpectedProducts={true}
        canOpenKendrick={true}
        onSaveDefaults={vi.fn()}
      />,
    );

    expect(screen.getByText(/Polymer Studio/i)).toBeDefined();

    const enableCheckbox = screen.getByRole("checkbox", { name: /enable spectrum matching/i });
    fireEvent.click(enableCheckbox);

    expect(handleChange).toHaveBeenCalled();
    const updatedSettings = handleChange.mock.calls[0][0];
    expect(updatedSettings.shared.enabled).toBe(true);
  });

  it("switches sub-tabs", () => {
    const settings = loadPolymerUiSettings();
    render(
      <PolymerStudioDrawer
        open={true}
        onClose={vi.fn()}
        polarity="positive"
        settings={settings}
        onChange={vi.fn()}
        onExpectedProducts={vi.fn()}
        onKendrick={vi.fn()}
        canOpenExpectedProducts={true}
        canOpenKendrick={true}
        onSaveDefaults={vi.fn()}
      />,
    );

    const adductsTab = screen.getByRole("button", { name: /Adducts & Tol/i });
    fireEvent.click(adductsTab);

    expect(screen.getByText(/Tolerance/i)).toBeDefined();
    expect(screen.getByText(/Positive Adducts/i)).toBeDefined();
  });
});
