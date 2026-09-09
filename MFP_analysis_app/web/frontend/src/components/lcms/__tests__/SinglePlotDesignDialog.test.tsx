import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { SinglePlotDesignDialog } from "../SinglePlotDesignDialog";
import { loadGraphSettingsDefault } from "../../../lcms/settings";

afterEach(() => {
  cleanup();
});

describe("SinglePlotDesignDialog", () => {
  it("renders TIC plot design controls without MS or UV label controls", () => {
    const settings = loadGraphSettingsDefault();
    render(
      <SinglePlotDesignDialog
        graphId="tic"
        settings={settings}
        onChange={vi.fn()}
        onSetDefault={vi.fn()}
        onReset={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText(/Total Ion Chromatogram \(TIC\) Design/i)).toBeDefined();
    expect(screen.getByText(/Line Appearance/i)).toBeDefined();
    expect(screen.queryByText(/MS Peak Labels/i)).toBeNull();
    expect(screen.queryByText(/Polymer Match Labels/i)).toBeNull();
    expect(screen.queryByText(/UV Peak Labels & Connectors/i)).toBeNull();
    expect(screen.queryByText(/EIC Overlay & Stacking/i)).toBeNull();
  });

  it("renders UV chromatogram design with UV connector controls", () => {
    const settings = loadGraphSettingsDefault();
    render(
      <SinglePlotDesignDialog
        graphId="uv"
        settings={settings}
        onChange={vi.fn()}
        onSetDefault={vi.fn()}
        onReset={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText(/UV Chromatogram Design/i)).toBeDefined();
    expect(screen.getByText(/UV Peak Labels & Connectors/i)).toBeDefined();
    expect(screen.getByText(/Connector line color/i)).toBeDefined();
    expect(screen.queryByText(/MS Peak Labels/i)).toBeNull();
  });

  it("renders MS1 spectrum design with Bar and Peak label controls", () => {
    const settings = loadGraphSettingsDefault();
    render(
      <SinglePlotDesignDialog
        graphId="spectrum"
        settings={settings}
        onChange={vi.fn()}
        onSetDefault={vi.fn()}
        onReset={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText(/MS1 Spectrum Design/i)).toBeDefined();
    expect(screen.getByText(/Bar Appearance/i)).toBeDefined();
    expect(screen.getByText(/MS Peak Labels/i)).toBeDefined();
    expect(screen.getByText(/Polymer Match Labels/i)).toBeDefined();
    expect(screen.getByText(/Show surrounding box/i)).toBeDefined();
    expect(screen.getByText(/Show arrow pointer to peak/i)).toBeDefined();
    expect(screen.queryByText(/Connector line color/i)).toBeNull();
  });

  it("renders EIC design with overlay and stacking controls", () => {
    const settings = loadGraphSettingsDefault();
    const handleEicOverlay = vi.fn();
    render(
      <SinglePlotDesignDialog
        graphId="eic"
        settings={settings}
        onChange={vi.fn()}
        overlayEicEnabled={true}
        setOverlayEicEnabled={handleEicOverlay}
        onSetDefault={vi.fn()}
        onReset={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText(/Extracted Ion Chromatogram \(EIC\) Design/i)).toBeDefined();
    expect(screen.getByText(/EIC Overlay & Stacking/i)).toBeDefined();
    expect(screen.getByText(/Stack traces vertically/i)).toBeDefined();
  });

  it("calls onClose when clicking Done or Close", () => {
    const settings = loadGraphSettingsDefault();
    const handleClose = vi.fn();
    render(
      <SinglePlotDesignDialog
        graphId="tic"
        settings={settings}
        onChange={vi.fn()}
        onSetDefault={vi.fn()}
        onReset={vi.fn()}
        onClose={handleClose}
      />,
    );

    const doneBtn = screen.getByRole("button", { name: /^done$/i });
    fireEvent.click(doneBtn);
    expect(handleClose).toHaveBeenCalled();
  });
});
