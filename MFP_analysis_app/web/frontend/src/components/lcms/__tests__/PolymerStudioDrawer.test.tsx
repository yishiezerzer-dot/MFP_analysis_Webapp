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

    expect(screen.getByText("Tolerance")).toBeDefined();
    expect(screen.getByText(/Positive Adducts/i)).toBeDefined();
  });

  it("renders target file selector and handles session switching", () => {
    const handleSelectSession = vi.fn();
    const settings = loadPolymerUiSettings();
    const sessions = [
      { session_id: "s1", display_name: "Sample_A.mzML" },
      { session_id: "s2", display_name: "Sample_B.mzML" },
    ];

    render(
      <PolymerStudioDrawer
        open={true}
        onClose={vi.fn()}
        polarity="positive"
        settings={settings}
        onChange={vi.fn()}
        onExpectedProducts={vi.fn()}
        onKendrick={vi.fn()}
        canOpenExpectedProducts={false}
        canOpenKendrick={false}
        onSaveDefaults={vi.fn()}
        sessions={sessions}
        activeSessionId="s1"
        onSelectSession={handleSelectSession}
      />,
    );

    const targetFileSelect = screen.getByRole("combobox", { name: /Target File/i }) as HTMLSelectElement;
    expect(targetFileSelect).toBeDefined();
    expect(targetFileSelect.value).toBe("s1");

    fireEvent.change(targetFileSelect, { target: { value: "s2" } });
    expect(handleSelectSession).toHaveBeenCalledWith("s2");
  });

  it("handles copy from session and apply to all sessions", () => {
    const handleCopy = vi.fn();
    const handleApplyAll = vi.fn();
    const settings = loadPolymerUiSettings();
    const sessions = [
      { session_id: "s1", display_name: "Sample_A.mzML" },
      { session_id: "s2", display_name: "Sample_B.mzML" },
    ];

    render(
      <PolymerStudioDrawer
        open={true}
        onClose={vi.fn()}
        polarity="positive"
        settings={settings}
        onChange={vi.fn()}
        onExpectedProducts={vi.fn()}
        onKendrick={vi.fn()}
        canOpenExpectedProducts={false}
        canOpenKendrick={false}
        onSaveDefaults={vi.fn()}
        sessions={sessions}
        activeSessionId="s1"
        onCopyFromSession={handleCopy}
        onApplyToAllSessions={handleApplyAll}
      />,
    );

    const copySelect = screen.getByRole("combobox", { name: /Copy from file/i });
    expect(copySelect).toBeDefined();
    fireEvent.change(copySelect, { target: { value: "s2" } });
    expect(handleCopy).toHaveBeenCalledWith("s2");

    const applyAllBtn = screen.getByRole("button", { name: /Apply to all open files/i });
    expect(applyAllBtn).toBeDefined();
    fireEvent.click(applyAllBtn);
    expect(handleApplyAll).toHaveBeenCalled();
  });
});
