import type { PipelineResult } from "../api";
import type { UVTextLabel } from "./viewShared";

// The pipeline's approved labels as UV chart labels. Ids start with "pipeline:" so a new result
// replaces them without touching manual labels. Labels are placed by their centre in data units
// (UV time + the run's offset, in the chart's time unit; UV signal), the same convention as the
// chart's series-stairs arrange, so they land right on a chart of any size; pixel offsets are the
// fallback for results without data positions.
export function pipelineUvLabels(result: PipelineResult, rtScale = 1): UVTextLabel[] {
  const peaks = new Map(result.peaks.map((p, index) => [p.id, { peak: p, index }]));
  const offset = result.alignment.offset_min;
  return result.labels.flatMap((label) => {
    const hit = peaks.get(label.peak_id);
    if (label.review !== "approved" || !hit) return [];
    const layout = label.layout;
    const placement = !layout
      ? {}
      : layout.x_data != null && layout.y_data != null
        ? { ax: (layout.x_data + offset) * rtScale, ay: layout.y_data, axRef: "x" as const, ayRef: "y" as const }
        : { ax: layout.ax, ay: layout.ay, axRef: "pixel" as const, ayRef: "pixel" as const };
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
        ...placement,
      },
    ];
  });
}
