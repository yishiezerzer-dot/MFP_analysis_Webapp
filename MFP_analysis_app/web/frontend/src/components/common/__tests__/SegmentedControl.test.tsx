import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SegmentedControl } from "../SegmentedControl";

describe("SegmentedControl", () => {
  it("renders options and triggers onChange", () => {
    const handleChange = vi.fn();
    const options = [
      { value: "inspect", label: "Inspect" },
      { value: "slice", label: "Slice" },
    ];

    render(
      <SegmentedControl
        options={options}
        value="inspect"
        onChange={handleChange}
        ariaLabel="Mode selection"
      />,
    );

    const inspectBtn = screen.getByRole("radio", { name: /inspect/i });
    const sliceBtn = screen.getByRole("radio", { name: /slice/i });

    expect(inspectBtn.getAttribute("aria-checked")).toBe("true");
    expect(sliceBtn.getAttribute("aria-checked")).toBe("false");

    fireEvent.click(sliceBtn);
    expect(handleChange).toHaveBeenCalledWith("slice");
  });

  it("does not trigger onChange when clicking disabled option", () => {
    const handleChange = vi.fn();
    const options = [
      { value: "opt1", label: "Option 1" },
      { value: "opt2", label: "Option 2", disabled: true },
    ];

    render(
      <SegmentedControl
        options={options}
        value="opt1"
        onChange={handleChange}
      />,
    );

    const opt2 = screen.getByRole("radio", { name: /option 2/i });
    fireEvent.click(opt2);
    expect(handleChange).not.toHaveBeenCalled();
  });
});
