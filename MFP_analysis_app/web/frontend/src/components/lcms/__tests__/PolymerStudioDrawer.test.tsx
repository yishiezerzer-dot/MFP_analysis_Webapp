import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { PolymerStudioDrawer } from "../PolymerStudioDrawer";
import { PolymerDialog } from "../PolymerDialog";
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

    const enableCheckbox = screen.getByRole("checkbox", { name: /enable polymer matching on spectrum/i });
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

    fireEvent.click(screen.getByRole("button", { name: /^Adducts$/i }));
    expect(screen.getByText(/Positive Adducts/i)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: /Masses & Variants/i }));
    expect(screen.getByRole("spinbutton", { name: /Per-bond delta/i })).toBeDefined();
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

  it("shows tolerance, max DP and min intensity without switching tabs", () => {
    const handleChange = vi.fn();
    render(
      <PolymerStudioDrawer
        open={true}
        onClose={vi.fn()}
        polarity="positive"
        settings={loadPolymerUiSettings()}
        onChange={handleChange}
        onExpectedProducts={vi.fn()}
        onKendrick={vi.fn()}
        canOpenExpectedProducts={false}
        canOpenKendrick={false}
        onSaveDefaults={vi.fn()}
      />,
    );
    expect(screen.getByRole("combobox", { name: /Tolerance unit/i })).toBeDefined();
    expect(screen.getByRole("spinbutton", { name: /Max DP/i })).toBeDefined();
    expect(screen.getByRole("spinbutton", { name: /Min rel intensity/i })).toBeDefined();
    fireEvent.change(screen.getByRole("spinbutton", { name: /^Tolerance$/i }), { target: { value: "7" } });
    expect(handleChange.mock.calls[0][0].shared.tol_value).toBe(7);
  });

  it("offers exactly the same settings as the Polymer Match dialog", () => {
    const controlNames = () =>
      [...document.querySelectorAll("input, select, textarea")]
        .map((el) => {
          const input = el as HTMLInputElement;
          return (
            input.getAttribute("aria-label") ||
            input.closest("label")?.textContent?.trim() ||
            input.title ||
            input.placeholder
          );
        })
        .sort();
    const settings = loadPolymerUiSettings();
    const sessions = [
      { session_id: "s1", display_name: "Sample_A.mzML" },
      { session_id: "s2", display_name: "Sample_B.mzML" },
    ];
    for (const polarity of ["positive", "negative"] as const) {
      render(
        <PolymerDialog
          polarity={polarity}
          settings={settings}
          onChange={vi.fn()}
          onClose={vi.fn()}
          sessions={sessions}
          activeSessionId="s1"
          onSelectSession={vi.fn()}
          onCopyFromSession={vi.fn()}
          onApplyToAllSessions={vi.fn()}
        />,
      );
      const dialogControls = controlNames();
      cleanup();

      render(
        <PolymerStudioDrawer
          open={true}
          onClose={vi.fn()}
          polarity={polarity}
          settings={settings}
          onChange={vi.fn()}
          onExpectedProducts={vi.fn()}
          onKendrick={vi.fn()}
          canOpenExpectedProducts={false}
          canOpenKendrick={false}
          onSaveDefaults={vi.fn()}
          sessions={sessions}
          activeSessionId="s1"
          onSelectSession={vi.fn()}
          onCopyFromSession={vi.fn()}
          onApplyToAllSessions={vi.fn()}
        />,
      );
      const studioControls = new Set<string | null>();
      for (const tab of [/^Monomers$/i, /^Adducts$/i, /Masses & Variants/i]) {
        fireEvent.click(screen.getByRole("button", { name: tab }));
        controlNames().forEach((name) => studioControls.add(name));
      }
      cleanup();

      expect([...studioControls].sort()).toEqual([...new Set(dialogControls)].sort());
      expect(screen.queryByText(/Polymer Studio/i)).toBeNull();
    }
  });
});
