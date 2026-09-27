import type { PlateAnalysis, PlateCheck, PlateExperiment } from "../api";
import { GROUP_COLOURS, formatConcentration } from "./plateLayout";
import type { PlateExplanation } from "./plateExplanations";

type ExperimentPlate = PlateExperiment["plates"][number];

export function plateLabel(p: ExperimentPlate, index: number): string {
  const n = p.metadata.plate_number;
  return typeof n === "string" && n ? n : `Plate ${index + 1}`;
}

// All compounds of the experiment as one analysis, for the combined % growth chart: names get
// "(reference)", colours are re-assigned so compounds from different plates don't share one.
export function combinedAnalysis(exp: PlateExperiment): PlateAnalysis {
  const groups = exp.plates.flatMap((p) => p.analysis.groups.map((g) => ({ g, p })));
  const names = groups.map(({ g }) => g.name);
  return {
    blank: { used: false, mean: null, sd: null, n: 0, wells: [] },
    unit: exp.plates[0]?.analysis.unit ?? "",
    excluded: [],
    checks: [],
    groups: groups.map(({ g, p }, i) => {
      const duplicate = names.filter((n) => n === g.name).length > 1;
      const plate = plateLabel(p, exp.plates.indexOf(p));
      return {
        ...g,
        id: `${p.session_id}:${g.id}`,
        name: `${g.name}${duplicate ? ` (${plate})` : ""}${g.kind === "reference" ? " (reference)" : ""}`,
        colour: GROUP_COLOURS[i % GROUP_COLOURS.length],
      };
    }),
  };
}

export interface GridCell {
  percent: number | null;
  excluded: boolean;
}

export interface GridRow {
  compound: string;
  plate: string;
  label: string;
  mean: boolean;
  cells: GridCell[];
}

export function micGrid(exp: PlateExperiment): { concentrations: number[]; unit: string; rows: GridRow[] } {
  const concentrations = [
    ...new Set(exp.plates.flatMap((p) => p.analysis.groups.flatMap((g) => g.points.map((x) => x.concentration)))),
  ].sort((a, b) => b - a);
  const rows: GridRow[] = [];
  exp.plates.forEach((p, i) => {
    const plate = plateLabel(p, i);
    for (const g of p.analysis.groups) {
      const byConc = new Map(g.points.map((x) => [x.concentration, x]));
      rows.push({
        compound: g.name,
        plate,
        label: "mean",
        mean: true,
        cells: concentrations.map((c) => ({ percent: byConc.get(c)?.percent_growth ?? null, excluded: false })),
      });
      // Replicates are rows when each concentration's wells sit in different rows (dilution across
      // columns), otherwise columns.
      const byRow = g.points.every((pt) => new Set(pt.wells.map((w) => w.well[0])).size === pt.wells.length);
      const reps = new Map<string, Map<number, GridCell>>();
      for (const point of g.points) {
        for (const w of point.wells) {
          const key = byRow ? `row ${w.well[0]}` : `column ${w.well.slice(1)}`;
          if (!reps.has(key)) reps.set(key, new Map());
          reps.get(key)?.set(point.concentration, { percent: w.percent_growth, excluded: w.excluded });
        }
      }
      for (const [label, cells] of reps) {
        rows.push({
          compound: g.name,
          plate,
          label,
          mean: false,
          cells: concentrations.map((c) => cells.get(c) ?? { percent: null, excluded: false }),
        });
      }
    }
  });
  return { concentrations, unit: exp.plates[0]?.analysis.unit ?? "", rows };
}

// White at ≤ 0% growth → brand blue at ≥ 100%.
export function growthFill(percent: number | null): { background: string; color: string } {
  if (percent === null) return { background: "transparent", color: "rgb(var(--ink-500))" };
  const t = Math.max(0, Math.min(1, percent / 100));
  const mix = (a: number, b: number) => Math.round(a + (b - a) * t);
  return { background: `rgb(${mix(255, 64)}, ${mix(255, 90)}, ${mix(255, 156)})`, color: t > 0.5 ? "#ffffff" : "#18181b" };
}

export function gridCsv(exp: PlateExperiment): string[][] {
  const { concentrations, unit, rows } = micGrid(exp);
  return [
    ["Compound", "Plate", "Replicate", ...concentrations.map((c) => `${formatConcentration(c)} ${unit}`)],
    ...rows.map((r) => [
      r.compound,
      r.plate,
      r.label,
      ...r.cells.map((c) => (c.excluded || c.percent === null ? "" : c.percent.toFixed(1))),
    ]),
  ];
}

export function experimentChecks(exp: PlateExperiment): PlateCheck[] {
  return exp.plates.flatMap((p, i) =>
    p.analysis.checks.map((c) => ({ ...c, message: `${plateLabel(p, i)} (${p.display_name}): ${c.message}` })),
  );
}

export function explainExperiment(kind: "growth" | "grid", exp: PlateExperiment): PlateExplanation {
  const perPlate = exp.plates.flatMap((p, i) => {
    const b = p.analysis.blank;
    const blank = b.used ? `blank ${b.mean?.toFixed(3)} (${b.n} wells)` : "no blank subtracted";
    const gcs = p.analysis.groups.map((g) => `${g.name} growth control ${g.growth_control.mean?.toFixed(3) ?? "–"}`);
    return [`${plateLabel(p, i)} (${p.display_name}): ${[blank, ...gcs].join(" · ")}`];
  });
  const common = [
    "Each plate is calculated on its own, exactly as in its Results tab: blank from its own blank wells, growth control from its own growth-control wells",
    ...perPlate,
    "% growth = 100 × mean OD ÷ that compound's growth control on the same plate, so compounds from different plates are comparable",
  ];
  const checks = experimentChecks(exp);
  if (kind === "growth") {
    return {
      title: "% growth, all compounds",
      what: "Every compound of the experiment on one chart, each relative to the growth control on its own plate. 100% = grew like the untreated control, 0% = no growth.",
      steps: [...common, "Error bars: SD of the replicate wells ÷ growth control × 100"],
      notes: [],
      checks,
      reproduce:
        "Download Export all (Excel): each plate has its own Raw plate, Controls and Calculation sheets with live formulas; plot the % growth column of each Calculation sheet against concentration.",
    };
  }
  return {
    title: "MIC reading grid",
    what: "% growth for every replicate and the mean, per concentration. Read the MIC as the lowest concentration where the replicates stay white (no growth).",
    steps: [
      ...common,
      "Replicate rows: each well's own OD − blank, ÷ the growth control × 100",
      "Mean row: the mean of the replicate wells ÷ the growth control × 100 (excluded wells left out)",
      "Colour: white at 0% or below → blue at 100% or above",
    ],
    notes: [],
    checks,
    reproduce: "The MIC grid sheet in Export all (Excel) has these values; each plate's Calculation sheet shows how they were computed.",
  };
}
