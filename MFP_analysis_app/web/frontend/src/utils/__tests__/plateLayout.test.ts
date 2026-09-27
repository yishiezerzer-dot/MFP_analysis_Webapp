import { describe, expect, it } from "vitest";
import type { PlateLayout } from "../../api";
import {
  buildLayout,
  concentrationAt,
  DEFAULT_DILUTION,
  formFromLayout,
  formatSpec,
  formsEqual,
  paintWells,
  parseSpec,
  positionLabel,
  roleOfWell,
  toggleExcluded,
  validateForm,
  wellsBetween,
  type LayoutForm,
} from "../plateLayout";

const polymerForm: LayoutForm = {
  dilution: { ...DEFAULT_DILUTION },
  compounds: [
    { id: "a", name: "LacGlyDOH 5:1:1", kind: "sample", lines: "A–C", colour: "#405a9c" },
    { id: "b", name: "LacGlyDOH 1:1:1", kind: "sample", lines: "D-F", colour: "#047857" },
  ],
  control: "12",
  blank: "G–H",
};

describe("parseSpec / formatSpec", () => {
  it("reads rows, ranges and words", () => {
    expect(parseSpec("A–C", "row")).toEqual([0, 1, 2]);
    expect(parseSpec("A - C, E", "row")).toEqual([0, 1, 2, 4]);
    expect(parseSpec("rows G–H", "row")).toEqual([6, 7]);
    expect(parseSpec("c-a", "row")).toEqual([0, 1, 2]);
    expect(parseSpec("column 12", "col")).toEqual([11]);
    expect(parseSpec("1-3 12", "col")).toEqual([0, 1, 2, 11]);
    expect(parseSpec("", "row")).toEqual([]);
  });

  it("rejects what it cannot read", () => {
    expect(parseSpec("A–Z", "row")).toBeNull();
    expect(parseSpec("13", "col")).toBeNull();
    expect(parseSpec("A-B-C", "row")).toBeNull();
  });

  it("formats runs compactly", () => {
    expect(formatSpec([0, 1, 2, 4], "row")).toBe("A–C, E");
    expect(formatSpec([11, 11], "col")).toBe("12");
  });
});

describe("buildLayout", () => {
  const layout = buildLayout(polymerForm, ["F1"]);

  it("fills compound rows across the dilution columns", () => {
    expect(layout.groups[0].wells).toHaveLength(33);
    expect(layout.groups[0].wells).toContain("A1");
    expect(layout.groups[0].wells).toContain("C11");
    expect(layout.groups[0].wells).not.toContain("A12");
    expect(layout.groups[1].wells).toContain("F11");
  });

  it("puts growth control in the compound rows only, and blank across whole rows", () => {
    expect(layout.growth_control).toEqual(["A12", "B12", "C12", "D12", "E12", "F12"]);
    expect(layout.blank).toHaveLength(24);
    expect(layout.blank).toContain("G12");
  });

  it("keeps excluded wells", () => {
    expect(layout.excluded).toEqual(["F1"]);
  });

  it("round-trips through the form", () => {
    const form = formFromLayout(layout);
    expect(form.compounds.map((c) => c.lines)).toEqual(["A–C", "D–F"]);
    expect(form.control).toBe("12");
    expect(form.blank).toBe("G–H");
    expect(buildLayout(form, layout.excluded)).toEqual(layout);
  });

  it("supports dilutions down rows", () => {
    const rows = buildLayout({
      dilution: { ...DEFAULT_DILUTION, direction: "rows", first: 1, last: 7 },
      compounds: [{ id: "a", name: "X", kind: "sample", lines: "1-3", colour: "#405a9c" }],
      control: "H",
      blank: "",
    });
    expect(rows.groups[0].wells).toContain("G3");
    expect(rows.groups[0].wells).not.toContain("H1");
    expect(rows.growth_control).toEqual(["H1", "H2", "H3"]);
  });
});

describe("formsEqual", () => {
  it("ignores how rows are typed but not what they are", () => {
    const retyped = { ...polymerForm, blank: "G, H", compounds: [{ ...polymerForm.compounds[0], lines: "a-c" }, polymerForm.compounds[1]] };
    expect(formsEqual(polymerForm, retyped)).toBe(true);
    expect(formsEqual(polymerForm, { ...polymerForm, blank: "H" })).toBe(false);
  });

  it("does not flag a painted plate as changed", () => {
    const painted = paintWells(buildLayout(polymerForm), ["G1", "G2"], "b");
    expect(formsEqual(formFromLayout(painted), formFromLayout(painted))).toBe(true);
  });
});

describe("validateForm", () => {
  it("accepts the polymer form and flags unreadable fields", () => {
    expect(validateForm(polymerForm)).toEqual([]);
    const bad = { ...polymerForm, control: "13", compounds: [{ ...polymerForm.compounds[0], name: " " }] };
    expect(validateForm(bad).map((p) => p.field)).toEqual(["name:a", "control"]);
  });
});

describe("concentrations", () => {
  it("halves from the top concentration across columns", () => {
    expect(concentrationAt("A1", DEFAULT_DILUTION)).toBe(1024);
    expect(concentrationAt("B11", DEFAULT_DILUTION)).toBe(1);
    expect(concentrationAt("B12", DEFAULT_DILUTION)).toBeNull();
  });

  it("labels headers with concentrations and GC", () => {
    const layout = buildLayout(polymerForm);
    expect(positionLabel(1, layout)).toBe("1024");
    expect(positionLabel(11, layout)).toBe("1");
    expect(positionLabel(12, layout)).toBe("GC");
  });
});

describe("painting and exclusion", () => {
  const base: PlateLayout = buildLayout(polymerForm);

  it("moves wells to the target and keeps each well in one role", () => {
    const painted = paintWells(base, ["G1", "G2"], "b");
    expect(painted.groups[1].wells).toContain("G1");
    expect(painted.blank).not.toContain("G1");
    expect(roleOfWell(painted, "G2")).toMatchObject({ kind: "group" });
    const cleared = paintWells(painted, ["G1"], "none");
    expect(roleOfWell(cleared, "G1")).toEqual({ kind: "none" });
    expect(paintWells(base, ["A12"], "blank").growth_control).not.toContain("A12");
  });

  it("toggles exclusion in plate order", () => {
    const one = toggleExcluded(base, "B12");
    const two = toggleExcluded(one, "A3");
    expect(two.excluded).toEqual(["A3", "B12"]);
    expect(toggleExcluded(two, "B12").excluded).toEqual(["A3"]);
  });

  it("selects a rectangle between two wells", () => {
    expect(wellsBetween("B3", "A2")).toEqual(["A2", "A3", "B2", "B3"]);
  });
});
