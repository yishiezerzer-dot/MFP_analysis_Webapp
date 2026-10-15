import type { PipelineResult } from "../api";
import type { UVTextLabel } from "./viewShared";

// The pipeline's approved labels as UV chart labels, with its de-overlapped offsets (pixels from the
// peak). Ids start with "pipeline:" so a new result replaces them without touching manual labels.
export function pipelineUvLabels(result: PipelineResult): UVTextLabel[] {
  const peaks = new Map(result.peaks.map((p, index) => [p.id, { peak: p, index }]));
  return result.labels.flatMap((label) => {
    const hit = peaks.get(label.peak_id);
    if (label.review !== "approved" || !hit) return [];
    return [
      {
        id: `pipeline:${label.id}`,
        kind: "polymer" as const,
        uv_rt_min: hit.peak.rt_min,
        signal: hit.peak.apex,
        // Full text: callout numbers only make sense next to the figure's footnote.
        text: label.text,
        source_ms_rt_min: hit.peak.ms_rt_min,
        source_peak_index: hit.index,
        ...(label.layout ? { ax: label.layout.ax, ay: label.layout.ay, axRef: "pixel" as const, ayRef: "pixel" as const } : {}),
      },
    ];
  });
}
