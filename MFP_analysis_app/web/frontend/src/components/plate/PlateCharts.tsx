import { useRef, type RefObject } from "react";
import Plot from "react-plotly.js";
import type { Data, Layout, PlotlyHTMLElement } from "plotly.js";
import type { PlateAnalysis, PlateGroupResult } from "../../api";
import { exportColorMeta, usePlotlyTheme } from "../../theme/ThemeProvider";
import { useContainerSize } from "../../lcms/viewShared";
import { formatConcentration } from "../../utils/plateLayout";
import type { ChartDesign } from "./ResultCard";

export const PLATE_CHART_HEIGHT = 270;
const FALLBACK_COLOUR = "#405a9c";

type Theme = ReturnType<typeof usePlotlyTheme>;

// Group colours are dark; on the night background they are lifted towards white. Exports keep
// the original colour (exportColorMeta).
function screenColour(hex: string, theme: Theme["theme"]): string {
  if (theme !== "night") return hex;
  const n = parseInt(hex.slice(1), 16);
  const lift = (c: number) => Math.round(c + (255 - c) * 0.45);
  return `rgb(${lift((n >> 16) & 255)}, ${lift((n >> 8) & 255)}, ${lift(n & 255)})`;
}

function colourOf(g: PlateGroupResult): string {
  return g.colour || FALLBACK_COLOUR;
}

function concentrations(a: PlateAnalysis): number[] {
  return [...new Set(a.groups.flatMap((g) => g.points.map((p) => p.concentration)))].sort((x, y) => x - y);
}

function baseLayout(pt: Theme, design: ChartDesign): Partial<Layout> {
  const axis = { gridcolor: pt.gridColor, zerolinecolor: pt.zerolineColor, linecolor: pt.gridColor, automargin: true };
  return {
    title: design.title ? { text: design.title, font: { size: 13 } } : undefined,
    paper_bgcolor: pt.paper_bgcolor,
    plot_bgcolor: pt.plot_bgcolor,
    font: { family: "IBM Plex Sans, sans-serif", size: 12, color: pt.screenFontColor ?? pt.fontColor },
    margin: { l: 56, r: 12, t: design.title ? 32 : 8, b: 44 },
    showlegend: true,
    legend: { orientation: "h", x: 0, y: 1.02, yanchor: "bottom", bgcolor: "rgba(0,0,0,0)", font: { size: 12 } },
    xaxis: { ...axis, title: { text: design.xLabel } },
    yaxis: { ...axis, title: { text: design.yLabel }, rangemode: "tozero" },
    hovermode: "closest",
  };
}

function log2Axis(a: PlateAnalysis): Partial<Layout["xaxis"]> {
  const c = concentrations(a).filter((x) => x > 0);
  return { type: "log", tickvals: c, ticktext: c.map(formatConcentration) };
}

export function doseTraces(a: PlateAnalysis, theme: Theme["theme"], showFit: boolean): Data[] {
  const c = concentrations(a).filter((x) => x > 0);
  const span = c.length ? [c[0], c[c.length - 1]] : [];
  return a.groups.flatMap((g) => {
    const colour = colourOf(g);
    const screen = screenColour(colour, theme);
    const pts = g.points.filter((p) => p.mean != null);
    const traces: Data[] = [
      {
        type: "scatter",
        mode: "lines+markers",
        name: g.name,
        legendgroup: g.id,
        x: pts.map((p) => p.concentration),
        y: pts.map((p) => p.mean as number),
        error_y: { type: "data", array: pts.map((p) => p.sd ?? 0), visible: true, color: screen, thickness: 1.2, width: 3 },
        marker: { color: screen, size: 6 },
        line: { color: screen, width: 1.6 },
        hovertemplate: `${g.name}<br>%{x} ${a.unit}<br>mean %{y:.3f}<extra></extra>`,
        ...exportColorMeta(colour),
      },
    ];
    if (g.growth_control.mean != null && span.length) {
      traces.push({
        type: "scatter",
        mode: "lines",
        name: `${g.name} growth control`,
        legendgroup: g.id,
        showlegend: false,
        x: span,
        y: [g.growth_control.mean, g.growth_control.mean],
        line: { color: screen, width: 1.2, dash: "dash" },
        hovertemplate: `${g.name} growth control<br>%{y:.3f}<extra></extra>`,
        ...exportColorMeta(colour),
      });
    }
    if (showFit && g.fit) {
      traces.push({
        type: "scatter",
        mode: "lines",
        name: `${g.name} 4PL`,
        legendgroup: g.id,
        x: g.fit.curve_x,
        y: g.fit.curve_y,
        line: { color: screen, width: 1.2, dash: "dot" },
        hoverinfo: "skip",
        ...exportColorMeta(colour),
      });
    }
    return traces;
  });
}

export function growthTraces(a: PlateAnalysis, theme: Theme["theme"]): Data[] {
  return a.groups.map((g) => {
    const colour = colourOf(g);
    const screen = screenColour(colour, theme);
    const gc = g.growth_control.mean;
    const pts = g.points.filter((p) => p.percent_growth != null);
    return {
      type: "scatter",
      mode: "lines+markers",
      name: g.name,
      x: pts.map((p) => p.concentration),
      y: pts.map((p) => p.percent_growth as number),
      error_y: {
        type: "data",
        array: pts.map((p) => (p.sd != null && gc ? (100 * p.sd) / gc : 0)),
        visible: true,
        color: screen,
        thickness: 1.2,
        width: 3,
      },
      marker: { color: screen, size: 6 },
      line: { color: screen, width: 1.6 },
      hovertemplate: `${g.name}<br>%{x} ${a.unit}<br>%{y:.0f}% growth<extra></extra>`,
      ...exportColorMeta(colour),
    } as Data;
  });
}

// Plate order (the top concentration first), growth control last.
export function stickTraces(a: PlateAnalysis, theme: Theme["theme"]): Data[] {
  const order = concentrations(a).slice().reverse();
  const categories = [...order.map(formatConcentration), "GC"];
  return a.groups.map((g) => {
    const colour = colourOf(g);
    const screen = screenColour(colour, theme);
    const byConc = new Map(g.points.map((p) => [p.concentration, p]));
    const means = order.map((c) => byConc.get(c)?.mean ?? null);
    const sds = order.map((c) => byConc.get(c)?.sd ?? 0);
    return {
      type: "bar",
      name: g.name,
      x: categories,
      y: [...means, g.growth_control.mean],
      error_y: { type: "data", array: [...sds, g.growth_control.sd ?? 0], visible: true, color: pickErrorColour(theme), thickness: 1.2, width: 3 },
      marker: { color: screen, opacity: [...means.map(() => 1), 0.6] },
      hovertemplate: `${g.name}<br>%{x}<br>%{y:.3f}<extra></extra>`,
      ...exportColorMeta(colour),
    } as Data;
  });
}

function pickErrorColour(theme: Theme["theme"]): string {
  return theme === "night" ? "#d9e6ff" : "#18181b";
}

function PlatePlot({
  data,
  layout,
  plotRef,
  containerRef,
}: {
  data: Data[];
  layout: Partial<Layout>;
  plotRef: RefObject<PlotlyHTMLElement | null>;
  containerRef: RefObject<HTMLDivElement>;
}) {
  const size = useContainerSize(containerRef, PLATE_CHART_HEIGHT);
  const setRef = (gd: unknown) => {
    (plotRef as { current: PlotlyHTMLElement | null }).current = gd as PlotlyHTMLElement;
  };
  return (
    <div ref={containerRef} className="min-w-0" style={{ height: PLATE_CHART_HEIGHT }}>
      <Plot
        data={data}
        layout={{ ...layout, width: size.width, height: size.height }}
        revision={size.revision}
        useResizeHandler
        style={{ width: "100%", height: "100%" }}
        config={{ displaylogo: false, responsive: true, modeBarButtonsToRemove: ["toImage", "lasso2d", "select2d"] }}
        onInitialized={(_, gd) => setRef(gd)}
        onUpdate={(_, gd) => setRef(gd)}
      />
    </div>
  );
}

export function usePlateChartRefs() {
  const plotRef = useRef<PlotlyHTMLElement | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  return { plotRef, containerRef };
}

type ChartProps = {
  analysis: PlateAnalysis;
  design: ChartDesign;
  plotRef: RefObject<PlotlyHTMLElement | null>;
  containerRef: RefObject<HTMLDivElement>;
};

export function DoseResponseChart({ analysis, design, showFit, ...refs }: ChartProps & { showFit: boolean }) {
  const pt = usePlotlyTheme();
  const base = baseLayout(pt, design);
  const layout = { ...base, xaxis: { ...base.xaxis, ...log2Axis(analysis) } } as Partial<Layout>;
  return <PlatePlot data={doseTraces(analysis, pt.theme, showFit)} layout={layout} {...refs} />;
}

export function GrowthChart({ analysis, design, ...refs }: ChartProps) {
  const pt = usePlotlyTheme();
  const base = baseLayout(pt, design);
  const layout = {
    ...base,
    xaxis: { ...base.xaxis, ...log2Axis(analysis) },
    shapes: [
      {
        type: "line",
        xref: "paper",
        x0: 0,
        x1: 1,
        y0: 100,
        y1: 100,
        line: { color: pt.zerolineColor, width: 1.2, dash: "dash" },
      },
    ],
  } as Partial<Layout>;
  return <PlatePlot data={growthTraces(analysis, pt.theme)} layout={layout} {...refs} />;
}

export function StickChart({ analysis, design, ...refs }: ChartProps) {
  const pt = usePlotlyTheme();
  const base = baseLayout(pt, design);
  const layout = { ...base, barmode: "group", xaxis: { ...base.xaxis, type: "category" } } as Partial<Layout>;
  return <PlatePlot data={stickTraces(analysis, pt.theme)} layout={layout} {...refs} />;
}
