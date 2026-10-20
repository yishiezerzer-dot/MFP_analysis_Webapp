import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { PipelineRunSummary } from "../../../api";
import { PipelineRunsDialog } from "../PipelineRunsDialog";

const list = vi.fn();
const deleteRun = vi.fn();
vi.mock("../../../api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../../api")>();
  return {
    ...real,
    api: {
      ...real.api,
      lcmsPipeline: {
        ...real.api.lcmsPipeline,
        list: () => list(),
        deleteRun: (id: string) => deleteRun(id),
      },
    },
  };
});

function run(over: Partial<PipelineRunSummary>): PipelineRunSummary {
  return {
    job_id: "j1", status: "done", created_at: "2026-10-20T08:00:00+00:00", session_id: "s1", uploaded: true,
    file_open: true, display_name: "G1 LCMS.mzML", uv_filename: "G1.CSV", n_peaks: 35, approved: 25, ...over,
  };
}

afterEach(() => {
  cleanup();
  list.mockReset();
  deleteRun.mockReset();
});

describe("PipelineRunsDialog", () => {
  it("lists past runs; a run whose file was closed can't be reopened", async () => {
    list.mockResolvedValue([run({}), run({ job_id: "j2", display_name: "L1 LCMS.mzML", file_open: false })]);
    const onOpen = vi.fn();
    render(<PipelineRunsDialog onOpen={onOpen} onDeleted={() => {}} onClose={() => {}} />);
    const g1 = (await screen.findByText("G1 LCMS.mzML")).closest("li") as HTMLElement;
    expect(within(g1).getByText(/35 peaks · 25 approved/)).toBeDefined();
    fireEvent.click(within(g1).getByRole("button", { name: /open review/i }));
    expect(onOpen).toHaveBeenCalledWith("j1");
    const l1 = screen.getByText("L1 LCMS.mzML").closest("li") as HTMLElement;
    expect((within(l1).getByRole("button", { name: /open review/i }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/deleted automatically after 5 days/i)).toBeDefined();
  });

  it("deletes a run after a confirmation and says when its file was closed", async () => {
    list.mockResolvedValue([run({})]);
    deleteRun.mockResolvedValue({ deleted: true, file_closed: true });
    const onDeleted = vi.fn();
    render(<PipelineRunsDialog onOpen={() => {}} onDeleted={onDeleted} onClose={() => {}} />);
    const row = (await screen.findByText("G1 LCMS.mzML")).closest("li") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: /^delete run/i }));
    expect(deleteRun).not.toHaveBeenCalled();
    fireEvent.click(within(row).getByRole("button", { name: /yes, delete/i }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith("j1", true, "s1"));
    expect(deleteRun).toHaveBeenCalledWith("j1");
    await waitFor(() => expect(screen.queryByText("G1 LCMS.mzML")).toBeNull());
  });
});
