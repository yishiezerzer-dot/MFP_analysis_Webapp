import type { PlateAnalysis, PlateCheck, PlateGroupResult, PlateLayout, PlateWell } from "../api";
import { ALL_WELLS, concentrationOfPosition, formatConcentration, formatPercent as pct, formatSpec, lineAxis, posAxis, wellsBetween } from "./plateLayout";

export type PlateChartKind = "heatmap" | "dose" | "growth" | "stick" | "table";

export interface PlateExplanation {
  title: string;
  what: string;
  steps: string[];
  notes: string[];
  checks: PlateCheck[];
  reproduce: string;
}

export interface ExplainOptions {
  subtractBlank: boolean;
  fit4pl: boolean;
}

const od = (v: number | null | undefined) => (v == null ? "–" : v.toFixed(3));

// "G1–H12" for a full rectangle, else the wells listed (shortened past eight).
export function wellRange(wells: PlateWell[]): string {
  const sorted = ALL_WELLS.filter((w) => wells.includes(w));
  if (sorted.length === 0) return "none";
  if (sorted.length > 1) {
    const rect = wellsBetween(sorted[0], sorted[sorted.length - 1]);
    if (rect.length === sorted.length) return `${sorted[0]}–${sorted[sorted.length - 1]}`;
  }
  return sorted.length > 8 ? `${sorted.slice(0, 8).join(", ")} +${sorted.length - 8} more` : sorted.join(", ");
}

export function checkSummary(checks: PlateCheck[]): string {
  const n = (level: PlateCheck["level"]) => checks.filter((c) => c.level === level).length;
  const parts = [
    n("ok") > 0 && `✓ ${n("ok")} check${n("ok") === 1 ? "" : "s"} passed`,
    n("warn") > 0 && `⚠ ${n("warn")} warning${n("warn") === 1 ? "" : "s"}`,
    n("info") > 0 && `${n("info")} note${n("info") === 1 ? "" : "s"}`,
  ];
  return parts.filter(Boolean).join(" · ");
}

function groupLines(g: PlateGroupResult, layout: PlateLayout): string {
  const wells = layout.groups.find((x) => x.id === g.id)?.wells ?? g.points.flatMap((p) => p.wells.map((w) => w.well));
  const d = layout.dilution;
  const idx = wells.map((w) => (d.direction === "columns" ? "ABCDEFGH".indexOf(w[0]) : Number(w.slice(1)) - 1));
  const word = d.direction === "columns" ? "rows" : "columns";
  return `${word} ${formatSpec(idx, lineAxis(d))}`;
}

function blankStep(a: PlateAnalysis, opts: ExplainOptions, layout: PlateLayout): string {
  if (a.blank.used) {
    return `Blank = mean of ${a.blank.n} wells ${wellRange(a.blank.wells)} = ${od(a.blank.mean)} ± ${od(a.blank.sd)} (SD)`;
  }
  if (layout.blank.length > 0 && !opts.subtractBlank) return "Blank subtraction is off: values are OD as read";
  return "No blank wells on this plate: values are OD as read";
}

function concentrationStep(layout: PlateLayout): string {
  const d = layout.dilution;
  const axis = posAxis(d) === "col" ? "column" : "row";
  const label = (pos: number) => (axis === "column" ? String(pos) : "ABCDEFGH"[pos - 1]);
  const low = concentrationOfPosition(d.last, d);
  return (
    `Concentration of ${axis} n = ${formatConcentration(d.top)} ÷ ${d.factor}^(n − ${d.first}) ${d.unit} ` +
    `(${axis} ${label(d.first)} = ${formatConcentration(d.top)} … ${axis} ${label(d.last)} = ${low === null ? "–" : formatConcentration(low)})`
  );
}

function controlSteps(a: PlateAnalysis): string[] {
  return a.groups.map((g) => {
    const gc = g.growth_control;
    const dropped = gc.all_wells.filter((w) => !gc.wells.includes(w));
    const source = gc.source === "plate" ? " (none in its own rows, so all growth-control wells on the plate)" : "";
    const excluded = dropped.length ? `; ${dropped.join(", ")} excluded` : "";
    return `${g.name}: growth control = mean of ${wellRange(gc.wells)}${source} = ${od(gc.mean)}${excluded}`;
  });
}

function exclusionNotes(a: PlateAnalysis): string[] {
  const notes: string[] = [];
  for (const g of a.groups) {
    for (const p of g.points) {
      const out = p.wells.filter((w) => w.excluded).map((w) => w.well);
      if (out.length) {
        notes.push(`Excluded ${out.join(", ")} → n = ${p.n} at ${formatConcentration(p.concentration)} ${a.unit} for ${g.name}`);
      }
    }
  }
  return notes;
}

function example(a: PlateAnalysis): string | null {
  for (const g of a.groups) {
    const p = g.points.find((x) => x.mean != null && x.percent_growth != null);
    if (p && g.growth_control.mean != null) {
      return (
        `e.g. ${g.name} at ${formatConcentration(p.concentration)} ${a.unit}: ` +
        `100 × ${od(p.mean)} ÷ ${od(g.growth_control.mean)} = ${pct(p.percent_growth)}`
      );
    }
  }
  return null;
}

function fitSteps(a: PlateAnalysis): string[] {
  const fitted = a.groups.filter((g) => g.fit);
  if (fitted.length === 0) return ["4PL fit: needs at least 4 concentrations with a mean; no group could be fitted"];
  return [
    "4PL fit: y = Bottom + (Top − Bottom) ÷ (1 + (x ÷ IC₅₀)^Hill), least-squares fit to the means (SciPy curve_fit); ± is the standard error from the fit",
    ...fitted.map((g) => {
      const f = g.fit as NonNullable<PlateGroupResult["fit"]>;
      const se = f.ic50_se != null ? ` ± ${formatConcentration(f.ic50_se)}` : "";
      const range = f.ic50_in_range === false ? " (outside the tested range: extrapolated, do not report)" : "";
      return `${g.name}: IC₅₀ = ${formatConcentration(f.ic50)}${se} ${a.unit}${range}, Hill ${f.hill_slope.toFixed(2)}, R² ${f.r_squared.toFixed(3)}`;
    }),
  ];
}

export function explainPlateChart(
  kind: PlateChartKind,
  analysis: PlateAnalysis,
  layout: PlateLayout,
  opts: ExplainOptions,
): PlateExplanation {
  const blank = blankStep(analysis, opts, layout);
  const subtract = analysis.blank.used ? "Each well: OD − blank" : "Each well: OD as read (nothing subtracted)";
  const groups = `Replicates: ${analysis.groups.map((g) => `${g.name} = ${groupLines(g, layout)}`).join(" · ")}`;
  const meanStep = "Per compound and concentration: mean and SD (sample SD, n − 1) of its replicate wells that are not excluded";
  const blankWells = analysis.blank.used ? wellRange(analysis.blank.wells) : null;
  const gcWells = analysis.groups.map((g) => `${g.name}: ${wellRange(g.growth_control.wells)}`).join("; ");
  const averageThenSubtract = blankWells ? `average the blank wells (${blankWells}) → subtract it from every well → ` : "";
  const notes = exclusionNotes(analysis);

  switch (kind) {
    case "heatmap":
      return {
        title: "Plate heatmap",
        what: "The plate as read: each well's OD, so you can spot edge effects, contamination or a mis-pipetted row before trusting the averages.",
        steps: [
          "Each well is coloured by its OD as read (white = 0, dark blue = the highest OD on the plate); nothing is averaged or subtracted",
          "The ring colour shows the well's role: its compound, growth control (dark) or blank (grey)",
          "Hatched, struck-through wells are excluded from every calculation",
        ],
        notes,
        checks: analysis.checks.filter((c) => ["blank", "reader_range", "growth_control_inhibited", "excluded"].includes(c.id)),
        reproduce: "Open the Gen5 export and colour the 8×12 block with a two-colour scale (Excel: Conditional formatting → Color scales, white → blue).",
      };
    case "dose":
      return {
        title: "Dose–response",
        what: "How much the bacteria grew (OD) at each concentration, averaged over the replicate wells, so you can see where growth stops. The dashed line is each compound's growth control.",
        steps: [
          blank,
          subtract,
          groups,
          meanStep,
          concentrationStep(layout),
          ...controlSteps(analysis).map((s) => `Dashed line — ${s}`),
          ...(opts.fit4pl ? fitSteps(analysis) : []),
        ],
        notes,
        checks: analysis.checks,
        reproduce:
          `In the Gen5 export: ${averageThenSubtract}for each concentration AVERAGE each compound's replicate wells and take STDEV.S → ` +
          `plot against the concentration on a log₂ axis. The calculation workbook has every step as a formula.`,
      };
    case "growth":
      return {
        title: "% growth",
        what: "Each compound's growth relative to its own growth-control wells: 100% = grew as well as the untreated control, 0% = no growth. Read the MIC as the lowest concentration with no visible growth.",
        steps: [
          blank,
          subtract,
          groups,
          meanStep,
          ...controlSteps(analysis),
          "% growth = 100 × mean ÷ growth control (the same compound's control, so plates and rows are comparable)",
          example(analysis) ?? "",
        ].filter(Boolean),
        notes,
        checks: analysis.checks,
        reproduce:
          `In the Gen5 export: ${averageThenSubtract}AVERAGE each compound's replicate wells per concentration → ` +
          `divide by the mean of its growth-control wells (${gcWells}) → ×100.`,
      };
    case "stick":
      return {
        title: "Stick plot",
        what: "The classic MIC bar chart: one bar per concentration in plate order, with the growth control last, for figures and slides.",
        steps: [
          blank,
          subtract,
          groups,
          meanStep,
          "Bars are the means, error bars ± 1 SD; the last bar (GC) is the growth-control mean ± SD",
          concentrationStep(layout),
        ],
        notes,
        checks: analysis.checks,
        reproduce:
          `In the Gen5 export: ${averageThenSubtract}AVERAGE and STDEV.S each compound's replicate wells per concentration and ` +
          `its growth-control wells → clustered column chart with custom error bars.`,
      };
    case "table":
      return {
        title: "Results table",
        what: "Every number behind the charts: each replicate well, then n, mean, SD and % growth per compound and concentration.",
        steps: [
          blank,
          subtract,
          "Replicates: each well's value after blank subtraction; excluded wells are struck through and not used",
          meanStep,
          ...controlSteps(analysis),
          "% growth = 100 × mean ÷ growth control",
        ],
        notes,
        checks: analysis.checks,
        reproduce:
          "Download the calculation workbook: its Calculation sheet rebuilds this table with AVERAGE, STDEV.S and COUNT formulas pointing at the raw plate, so it recomputes if you change a value.",
      };
  }
}
