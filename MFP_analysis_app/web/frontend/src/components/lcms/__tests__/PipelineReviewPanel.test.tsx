import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { PipelineLabel, PipelineResult } from "../../../api";
import { PipelineReviewPanel } from "../PipelineReviewPanel";
import { validMonomers } from "../PipelineDialog";
import { pipelineUvLabels } from "../../../lcms/pipelineLabels";

const review = vi.fn();
vi.mock("../../../api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../../api")>();
  return { ...real, api: { ...real.api, lcmsPipeline: { ...real.api.lcmsPipeline, review: (...args: unknown[]) => review(...args) } } };
});

function label(over: Partial<PipelineLabel>): PipelineLabel {
  return {
    id: "P1-1", peak_id: "P1", rank: 1, text: "2-GA [M+H]⁺", species: "2-GA", series: "GA", dp: 2, counts: { GA: 2 },
    variant: "", adduct: "H", charge: 1, mz: 135.03, abs_err_da: 0.01, intensity: 1e6, rel_intensity: 0.8, score: 0.8,
    ions: [], eic_apex_rt_min: 3.9, series_support: 1, support_members: [1], status: "ok", reasons: [], review: "approved",
    layout: { id: "P1-1", ax: 4, ay: -40, axRef: "pixel", ayRef: "pixel", callout: null, shown_text: "2-GA [M+H]⁺",
      box: { x0: 0, y0: 0, x1: 1, y1: 1 }, leader: { x0: 0, y0: 0, x1: 1, y1: 1 } },
    ...over,
  };
}

function result(labels: PipelineLabel[]): PipelineResult {
  return {
    session_id: "s1", display_name: "run.mzML", uv_filename: "uv.csv", polarity: "positive",
    alignment: { offset_min: 0.12, method: "xcorr", score: 0.9, step_min: 0.01 }, uv_noise: 0.1, uv_rt: [], uv_signal: [],
    peaks: [
      { id: "P1", rt_min: 3.78, ms_rt_min: 3.9, apex: 57, start_min: 3.7, end_min: 3.85, width_min: 0.12, area: 7, sn: 68,
        prominence: 55, prominence_rel: 0.5, n_scans: 3, base_peak_intensity: 1e6, reasons: [], label_ids: ["P1-1", "P1-2", "P1-3"] },
    ],
    labels,
    settings: { monomers: [{ name: "GA", mass: 76.016 }], polarity: "positive", tolerance_da: 0.5, adducts: ["H", "Na"],
      rules: { top_k: 2 } as PipelineResult["settings"]["rules"] },
    messages: [], created_at: "",
  };
}

const LABELS = [
  label({}),
  label({ id: "P1-2", rank: 2, text: "8-GA [M+Na]⁺", species: "8-GA", dp: 8, status: "flagged", review: "pending", layout: null,
    series_support: 0, support_members: [], reasons: ["isolated: no lower-DP GA member found, likely not real"] }),
  label({ id: "P1-3", rank: 3, text: "5-GA [M+H]⁺", status: "alternative", review: "pending", layout: null }),
];

afterEach(() => {
  cleanup();
  review.mockReset();
});

describe("PipelineReviewPanel", () => {
  it("lists the kept candidates with status, reasons and series support", () => {
    render(<PipelineReviewPanel jobId="j1" result={result(LABELS)} onResult={() => {}} onJump={() => {}} onClose={() => {}} />);
    expect(screen.getByText("2-GA [M+H]⁺")).toBeDefined();
    expect(screen.getByText("flagged")).toBeDefined();
    expect(screen.getByText(/isolated: no lower-DP GA member/)).toBeDefined();
    expect(screen.getByText("100%")).toBeDefined();
    expect(screen.queryByText("5-GA [M+H]⁺")).toBeNull(); // rank 3 hidden until "All candidates"
    fireEvent.change(screen.getByLabelText("Show"), { target: { value: "all" } });
    expect(screen.getByText("5-GA [M+H]⁺")).toBeDefined();
  });

  it("approves and un-approves through the API and passes the new result on", async () => {
    const updated = result(LABELS.map((l) => (l.id === "P1-2" ? { ...l, review: "approved" as const } : l)));
    review.mockResolvedValue(updated);
    const onResult = vi.fn();
    render(<PipelineReviewPanel jobId="j1" result={result(LABELS)} onResult={onResult} onJump={() => {}} onClose={() => {}} />);
    fireEvent.click(screen.getByLabelText("Approve 8-GA [M+Na]⁺"));
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(updated));
    expect(review).toHaveBeenCalledWith("j1", [{ id: "P1-2", review: "approved" }]);
    fireEvent.click(screen.getByLabelText("Approve 2-GA [M+H]⁺"));
    await waitFor(() => expect(review).toHaveBeenLastCalledWith("j1", [{ id: "P1-1", review: "pending" }]));
  });

  it("jumps to the peak when a row is clicked, but not from the review buttons", () => {
    review.mockResolvedValue(result(LABELS));
    const onJump = vi.fn();
    render(<PipelineReviewPanel jobId="j1" result={result(LABELS)} onResult={() => {}} onJump={onJump} onClose={() => {}} />);
    const row = screen.getByText("2-GA [M+H]⁺").closest("tr") as HTMLElement;
    fireEvent.click(row);
    expect(onJump).toHaveBeenCalledWith(expect.objectContaining({ id: "P1", ms_rt_min: 3.9 }));
    onJump.mockReset();
    fireEvent.click(within(row).getByLabelText("Reject 2-GA [M+H]⁺"));
    expect(onJump).not.toHaveBeenCalled();
  });
});

describe("pipeline labels on the UV chart", () => {
  it("loads only approved labels, with the layout offsets and pipeline ids", () => {
    const uv = pipelineUvLabels(result(LABELS));
    expect(uv).toEqual([
      expect.objectContaining({ id: "pipeline:P1-1", uv_rt_min: 3.78, signal: 57, ax: 4, ay: -40, axRef: "pixel", ayRef: "pixel", source_ms_rt_min: 3.9 }),
    ]);
  });

  it("accepts only monomers with a name and a positive mass", () => {
    expect(validMonomers([{ name: " Ser ", mass: 87.032 }, { name: "", mass: 75 }, { name: "Gly", mass: Number.NaN }, { name: "1x", mass: 5 }])).toEqual([
      { name: "Ser", mass: 87.032 },
    ]);
  });
});
