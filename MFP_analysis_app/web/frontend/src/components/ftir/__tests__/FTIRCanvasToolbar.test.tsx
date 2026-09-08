import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FTIRCanvasToolbar } from "../FTIRCanvasToolbar";

describe("FTIRCanvasToolbar", () => {
  it("renders peak mode options and handles switching", () => {
    const handleModeChange = vi.fn();
    render(
      <FTIRCanvasToolbar
        mode="none"
        onModeChange={handleModeChange}
        manualPeakCount={0}
        onClearManual={vi.fn()}
      />,
    );

    expect(screen.getByText(/Peak Tool:/i)).toBeDefined();
    const addBtn = screen.getByRole("radio", { name: /add peak/i });
    fireEvent.click(addBtn);

    expect(handleModeChange).toHaveBeenCalledWith("add");
  });

  it("shows hint banner and clear button when manual peaks exist", () => {
    const handleClear = vi.fn();
    render(
      <FTIRCanvasToolbar
        mode="add"
        onModeChange={vi.fn()}
        manualPeakCount={3}
        onClearManual={handleClear}
      />,
    );

    expect(screen.getByText(/Click spectrum to place peak/i)).toBeDefined();
    const clearBtn = screen.getByRole("button", { name: /Clear Manual \(3\)/i });
    fireEvent.click(clearBtn);
    expect(handleClear).toHaveBeenCalled();
  });
});
