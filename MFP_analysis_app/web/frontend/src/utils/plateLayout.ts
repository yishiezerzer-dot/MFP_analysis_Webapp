import type { PlateDilution, PlateGroup, PlateGroupKind, PlateLayout, PlateWell } from "../api";

export const ROWS = ["A", "B", "C", "D", "E", "F", "G", "H"] as const;
export const COLS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;
export const ALL_WELLS: PlateWell[] = ROWS.flatMap((r) => COLS.map((c) => `${r}${c}`));
export const GROUP_COLOURS = ["#405a9c", "#047857", "#b45309", "#7c3aed", "#be185d", "#0e7490"];
export const DEFAULT_DILUTION: PlateDilution = {
  top: 1024,
  unit: "µg/mL",
  factor: 2,
  direction: "columns",
  first: 1,
  last: 11,
};

export type PaintTarget = string | "growth_control" | "blank" | "none";

export interface CompoundForm {
  id: string;
  name: string;
  kind: PlateGroupKind;
  lines: string;
  colour: string;
}

// Well assignment as typed in the Layout panel. "Lines" are the rows a compound occupies when the
// dilution runs across columns (or the columns when it runs down rows).
export interface LayoutForm {
  dilution: PlateDilution;
  compounds: CompoundForm[];
  control: string;
  blank: string;
}

export type Axis = "row" | "col";

const rowOf = (well: PlateWell) => ROWS.indexOf(well[0] as (typeof ROWS)[number]);
const colOf = (well: PlateWell) => Number(well.slice(1)) - 1;

// Indices along the axis the compounds are laid out on, and along the dilution axis.
export const lineAxis = (d: PlateDilution): Axis => (d.direction === "columns" ? "row" : "col");
export const posAxis =(d: PlateDilution): Axis => (d.direction === "columns" ? "col" : "row");
const axisSize = (axis: Axis) => (axis === "row" ? ROWS.length : COLS.length);

function wellAt(line: number, pos: number, d: PlateDilution): PlateWell {
  return d.direction === "columns" ? `${ROWS[line]}${pos + 1}` : `${ROWS[pos]}${line + 1}`;
}

function lineOf(well: PlateWell, d: PlateDilution): number {
  return d.direction === "columns" ? rowOf(well) : colOf(well);
}

function positionOf(well: PlateWell, d: PlateDilution): number {
  return d.direction === "columns" ? colOf(well) : rowOf(well);
}

export function newGroupId(): string {
  return `g-${Math.random().toString(36).slice(2, 10)}`;
}

export function nextColour(used: Array<string | null | undefined>): string {
  return GROUP_COLOURS.find((c) => !used.includes(c)) ?? GROUP_COLOURS[used.length % GROUP_COLOURS.length];
}

function parseToken(token: string, axis: Axis): number | null {
  if (axis === "row") {
    const i = ROWS.indexOf(token.toUpperCase() as (typeof ROWS)[number]);
    return i >= 0 ? i : null;
  }
  const n = Number(token);
  return Number.isInteger(n) && n >= 1 && n <= 12 ? n - 1 : null;
}

// "A–C", "A-C, E", "rows G–H", "column 12", "1-3" → sorted zero-based indices; null when unreadable.
export function parseSpec(text: string, axis: Axis): number[] | null {
  const cleaned = text
    .replace(/\b(rows?|columns?|cols?)\b/gi, " ")
    .replace(/\s*[–-]\s*/g, "-")
    .trim();
  if (!cleaned) return [];
  const out = new Set<number>();
  for (const part of cleaned.split(/[,;\s]+/)) {
    if (!part) continue;
    const range = part.split("-");
    if (range.length === 1) {
      const i = parseToken(range[0], axis);
      if (i === null) return null;
      out.add(i);
    } else if (range.length === 2) {
      const a = parseToken(range[0], axis);
      const b = parseToken(range[1], axis);
      if (a === null || b === null) return null;
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) out.add(i);
    } else {
      return null;
    }
  }
  return [...out].sort((a, b) => a - b);
}

export function formatSpec(indices: number[], axis: Axis): string {
  const label = (i: number) => (axis === "row" ? ROWS[i] : String(i + 1));
  const sorted = [...new Set(indices)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let k = 0; k < sorted.length; ) {
    let end = k;
    while (end + 1 < sorted.length && sorted[end + 1] === sorted[end] + 1) end++;
    parts.push(end > k ? `${label(sorted[k])}–${label(sorted[end])}` : label(sorted[k]));
    k = end + 1;
  }
  return parts.join(", ");
}

// Concentration for dilution position `pos` (1-based column or row number).
export function concentrationOfPosition(pos: number, d: PlateDilution): number | null {
  if (pos < d.first || pos > d.last) return null;
  return d.top / Math.pow(d.factor, pos - d.first);
}

export function concentrationAt(well: PlateWell, d: PlateDilution): number | null {
  return concentrationOfPosition(positionOf(well, d) + 1, d);
}

export function formatConcentration(v: number): string {
  return String(Number(v.toPrecision(v >= 1 ? 4 : 3)));
}

export interface FormProblem {
  field: string;
  message: string;
}

export function validateForm(form: LayoutForm): FormProblem[] {
  const problems: FormProblem[] = [];
  const la = lineAxis(form.dilution);
  const pa = posAxis(form.dilution);
  const d = form.dilution;
  if (!(d.top > 0)) problems.push({ field: "top", message: "Top concentration must be above 0." });
  if (!(d.factor > 1)) problems.push({ field: "factor", message: "Dilution factor must be above 1." });
  if (!(d.first >= 1 && d.last <= axisSize(pa) && d.first <= d.last)) {
    problems.push({ field: "range", message: `Dilution range must be within 1–${axisSize(pa)}.` });
  }
  for (const c of form.compounds) {
    if (!c.name.trim()) problems.push({ field: `name:${c.id}`, message: "Every compound needs a name." });
    if (parseSpec(c.lines, la) === null) {
      problems.push({ field: `lines:${c.id}`, message: `${c.name || "Compound"}: can't read "${c.lines}".` });
    }
  }
  if (parseSpec(form.control, pa) === null) problems.push({ field: "control", message: `Growth control: can't read "${form.control}".` });
  if (parseSpec(form.blank, la) === null) problems.push({ field: "blank", message: `Blank: can't read "${form.blank}".` });
  return problems;
}

type Role = { kind: "group"; id: string } | { kind: "growth_control" } | { kind: "blank" };

function rolesOf(layout: PlateLayout): Map<PlateWell, Role> {
  const roles = new Map<PlateWell, Role>();
  for (const g of layout.groups) for (const w of g.wells) roles.set(w, { kind: "group", id: g.id });
  for (const w of layout.growth_control) roles.set(w, { kind: "growth_control" });
  for (const w of layout.blank) roles.set(w, { kind: "blank" });
  return roles;
}

function layoutFromRoles(
  base: Pick<PlateLayout, "dilution" | "excluded">,
  groups: Omit<PlateGroup, "wells">[],
  roles: Map<PlateWell, Role>,
): PlateLayout {
  const ordered = ALL_WELLS.filter((w) => roles.has(w));
  const wellsOf = (pred: (r: Role) => boolean) => ordered.filter((w) => pred(roles.get(w) as Role));
  return {
    dilution: base.dilution,
    groups: groups.map((g) => ({ ...g, wells: wellsOf((r) => r.kind === "group" && r.id === g.id) })),
    growth_control: wellsOf((r) => r.kind === "growth_control"),
    blank: wellsOf((r) => r.kind === "blank"),
    excluded: base.excluded.filter((w) => ALL_WELLS.includes(w)),
  };
}

// Form → wells. Later roles win where they overlap: compounds, then growth control, then blank.
export function buildLayout(form: LayoutForm, excluded: PlateWell[] = []): PlateLayout {
  const d = form.dilution;
  const la = lineAxis(d);
  const pa = posAxis(d);
  const roles = new Map<PlateWell, Role>();
  const compoundLines = new Set<number>();
  for (const c of form.compounds) {
    for (const line of parseSpec(c.lines, la) ?? []) {
      compoundLines.add(line);
      for (let pos = d.first - 1; pos < Math.min(d.last, axisSize(pa)); pos++) {
        roles.set(wellAt(line, pos, d), { kind: "group", id: c.id });
      }
    }
  }
  for (const pos of parseSpec(form.control, pa) ?? []) {
    for (const line of compoundLines) roles.set(wellAt(line, pos, d), { kind: "growth_control" });
  }
  for (const line of parseSpec(form.blank, la) ?? []) {
    for (let pos = 0; pos < axisSize(pa); pos++) roles.set(wellAt(line, pos, d), { kind: "blank" });
  }
  const groups = form.compounds.map((c) => ({ id: c.id, name: c.name.trim(), kind: c.kind, colour: c.colour }));
  return layoutFromRoles({ dilution: d, excluded }, groups, roles);
}

export function formFromLayout(layout: PlateLayout): LayoutForm {
  const d = layout.dilution;
  const la = lineAxis(d);
  const pa = posAxis(d);
  const compounds = withColours(layout).groups.map((g) => ({
    id: g.id,
    name: g.name,
    kind: g.kind,
    colour: g.colour as string,
    lines: formatSpec(g.wells.map((w) => lineOf(w, d)), la),
  }));
  return {
    dilution: { ...d },
    compounds,
    control: formatSpec(layout.growth_control.map((w) => positionOf(w, d)), pa),
    blank: formatSpec(layout.blank.map((w) => lineOf(w, d)), la),
  };
}

// Same form, ignoring how the rows/columns are typed ("A-C" = "A–C" = "A, B, C").
export function formsEqual(a: LayoutForm, b: LayoutForm): boolean {
  const key = (f: LayoutForm) => {
    const la = lineAxis(f.dilution);
    const pa = posAxis(f.dilution);
    const d = f.dilution;
    return JSON.stringify([
      [d.top, d.unit, d.factor, d.direction, d.first, d.last],
      f.compounds.map((c) => [c.id, c.name.trim(), c.kind, c.colour, parseSpec(c.lines, la) ?? c.lines]),
      parseSpec(f.control, pa) ?? f.control,
      parseSpec(f.blank, la) ?? f.blank,
    ]);
  };
  return key(a) === key(b);
}

export function paintWells(layout: PlateLayout, wells: PlateWell[], target: PaintTarget): PlateLayout {
  const roles = rolesOf(layout);
  for (const w of wells) {
    if (target === "none") roles.delete(w);
    else if (target === "growth_control" || target === "blank") roles.set(w, { kind: target });
    else if (layout.groups.some((g) => g.id === target)) roles.set(w, { kind: "group", id: target });
  }
  return layoutFromRoles(layout, layout.groups, roles);
}

export function toggleExcluded(layout: PlateLayout, well: PlateWell): PlateLayout {
  const excluded = layout.excluded.includes(well)
    ? layout.excluded.filter((w) => w !== well)
    : ALL_WELLS.filter((w) => w === well || layout.excluded.includes(w));
  return { ...layout, excluded };
}

// Wells in the rectangle spanned by two corner wells.
export function wellsBetween(a: PlateWell, b: PlateWell): PlateWell[] {
  const [r0, r1] = [rowOf(a), rowOf(b)].sort((x, y) => x - y);
  const [c0, c1] = [colOf(a), colOf(b)].sort((x, y) => x - y);
  return ALL_WELLS.filter((w) => rowOf(w) >= r0 && rowOf(w) <= r1 && colOf(w) >= c0 && colOf(w) <= c1);
}

export type WellRole =
  | { kind: "group"; group: PlateGroup }
  | { kind: "growth_control" }
  | { kind: "blank" }
  | { kind: "none" };

export function roleOfWell(layout: PlateLayout, well: PlateWell): WellRole {
  if (layout.blank.includes(well)) return { kind: "blank" };
  if (layout.growth_control.includes(well)) return { kind: "growth_control" };
  const group = layout.groups.find((g) => g.wells.includes(well));
  return group ? { kind: "group", group } : { kind: "none" };
}

// White → brand blue by OD relative to the plate maximum; dark text on light wells.
export function odFill(value: number | null, max: number): { background: string; color: string } {
  if (value === null || !(max > 0)) return { background: "transparent", color: "rgb(var(--ink-500))" };
  const t = Math.max(0, Math.min(1, value / max));
  const mix = (a: number, b: number) => Math.round(a + (b - a) * t);
  return {
    background: `rgb(${mix(248, 64)}, ${mix(249, 90)}, ${mix(251, 156)})`,
    color: t > 0.45 ? "#ffffff" : "#18181b",
  };
}

// Header label for a dilution position: its concentration, "GC" for a growth-control line.
export function positionLabel(pos: number, layout: PlateLayout): string {
  const conc = concentrationOfPosition(pos, layout.dilution);
  if (conc !== null) return formatConcentration(conc);
  const isControl = layout.growth_control.some((w) => positionOf(w, layout.dilution) + 1 === pos);
  return isControl ? "GC" : "";
}

function canonical(layout: PlateLayout) {
  const wells = (ws: PlateWell[]) => ALL_WELLS.filter((w) => ws.includes(w));
  const d = layout.dilution;
  return [
    [d.top, d.unit, d.factor, d.direction, d.first, d.last],
    layout.groups.map((g) => [g.id, g.name, g.kind, g.colour ?? null, wells(g.wells)]),
    wells(layout.growth_control),
    wells(layout.blank),
    wells(layout.excluded),
  ];
}

// Same plate map, ignoring key order and well order (the server and the form order them differently).
export function layoutsEqual(a: PlateLayout, b: PlateLayout): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

export function withColours(layout: PlateLayout): PlateLayout {
  const used = layout.groups.map((g) => g.colour).filter((c): c is string => Boolean(c));
  return {
    ...layout,
    groups: layout.groups.map((g) => {
      if (g.colour) return g;
      const colour = nextColour(used);
      used.push(colour);
      return { ...g, colour };
    }),
  };
}
