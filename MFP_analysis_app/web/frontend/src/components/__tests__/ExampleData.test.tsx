import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const example = {
  id: "ftir-plga",
  module: "ftir",
  route: "/ftir",
  title: "PLGA film (FTIR, synthetic)",
  description: "A made-up spectrum.",
  try_this: ["Pick peaks.", "Deconvolute the carbonyl."],
};

vi.mock("../../api", () => ({
  api: {
    examples: {
      list: vi.fn(async () => [example]),
      open: vi.fn(async () => ({ example_id: "ftir-plga", module: "ftir", route: "/ftir", session_ids: ["s1"] })),
    },
  },
}));

import { api } from "../../api";
import { ExampleTips, TryExampleButton } from "../ExampleData";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("TryExampleButton", () => {
  it("opens this tab's example and passes the new session ids on", async () => {
    const onOpened = vi.fn();
    render(<TryExampleButton module="ftir" onOpened={onOpened} />);
    fireEvent.click(await screen.findByRole("button", { name: /try with example data/i }));
    await waitFor(() => expect(onOpened).toHaveBeenCalledWith(["s1"]));
    expect(api.examples.open).toHaveBeenCalledWith("ftir-plga");
  });
});

describe("ExampleTips", () => {
  it("shows the steps only for example files, and stays hidden once dismissed", async () => {
    const { rerender } = render(<ExampleTips module="ftir" activeName="my sample.csv" />);
    await waitFor(() => expect(api.examples.list).toHaveBeenCalled());
    expect(screen.queryByText("Try this")).toBeNull();

    rerender(<ExampleTips module="ftir" activeName="Example – PLGA film.csv" />);
    expect(await screen.findByText("Try this")).toBeDefined();
    expect(screen.getByText("Deconvolute the carbonyl.")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: /hide example tips/i }));
    expect(screen.queryByText("Try this")).toBeNull();
    rerender(<ExampleTips module="ftir" activeName="Example – PLGA film.csv" />);
    expect(screen.queryByText("Try this")).toBeNull();
  });
});
