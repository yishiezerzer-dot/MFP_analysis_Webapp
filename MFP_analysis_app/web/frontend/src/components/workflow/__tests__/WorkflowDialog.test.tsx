import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { WorkflowDialog, rememberedAnswers, type Workflow } from "../WorkflowDialog";

interface Answers {
  name: string;
  file: string;
}

function makeWorkflow(run = vi.fn(async () => "Done")): Workflow<Answers> {
  return {
    id: "test",
    title: "Test workflow",
    defaults: { name: "", file: "" },
    transient: ["file"],
    steps: [
      {
        id: "name",
        question: "What is it called?",
        explain: "Any name you like.",
        render: (a, set) => <input aria-label="name" value={a.name} onChange={(e) => set({ name: e.target.value })} />,
        check: (a) => (a.name ? null : "Type a name."),
      },
      {
        id: "file",
        question: "Which file?",
        explain: "The file to use.",
        render: (a, set) => <input aria-label="file" value={a.file} onChange={(e) => set({ file: e.target.value })} />,
      },
    ],
    summary: (a) => [`Call it ${a.name}`, `Use ${a.file || "no file"}`],
    run,
  };
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("WorkflowDialog", () => {
  it("blocks Next until the step is answered and explains on I don't know", () => {
    render(<WorkflowDialog workflow={makeWorkflow()} onClose={() => {}} />);
    expect(screen.getByText("Step 1 of 2")).toBeDefined();
    expect((screen.getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Type a name.")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: /i don't know/i }));
    expect(screen.getByText("Any name you like.")).toBeDefined();
    fireEvent.change(screen.getByLabelText("name"), { target: { value: "Plate 3" } });
    expect((screen.getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows what it will do, runs, and remembers answers except transient ones", async () => {
    const run = vi.fn(async () => "Done");
    const onClose = vi.fn();
    const wf = makeWorkflow(run);
    render(<WorkflowDialog workflow={wf} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText("name"), { target: { value: "Plate 3" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.change(screen.getByLabelText("file"), { target: { value: "a.xlsx" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("This will:")).toBeDefined();
    expect(screen.getByText("Call it Plate 3")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(run).toHaveBeenCalledWith({ name: "Plate 3", file: "a.xlsx" });
    expect(rememberedAnswers(wf)).toEqual({ name: "Plate 3", file: "" });
  });
});
