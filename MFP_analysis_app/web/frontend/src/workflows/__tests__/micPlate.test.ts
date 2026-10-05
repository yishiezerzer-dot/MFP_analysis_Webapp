import { describe, expect, it } from "vitest";
import { MIC_DEFAULTS, micForm, referencePlateForm, type MicAnswers } from "../micPlate";
import { buildLayout } from "../../utils/plateLayout";

const polymers: MicAnswers = {
  ...MIC_DEFAULTS,
  plateId: "p1",
  compounds: [
    { name: "LacGlyDOH 5:1:1", rows: "A–C" },
    { name: "LacGlyDOH 1:1:1", rows: "D-F" },
  ],
  blank: "G–H",
};

describe("MIC plate answers → plate layout", () => {
  it("lays out the polymer plate like its Gen5 notes", () => {
    const layout = buildLayout(micForm(polymers));
    expect(layout.groups.map((g) => [g.name, g.kind, g.wells.length])).toEqual([
      ["LacGlyDOH 5:1:1", "sample", 33],
      ["LacGlyDOH 1:1:1", "sample", 33],
    ]);
    expect(layout.growth_control).toEqual(["A12", "B12", "C12", "D12", "E12", "F12"]);
    expect(layout.blank).toHaveLength(24);
    expect(layout.dilution).toMatchObject({ top: 1024, factor: 2, first: 1, last: 11 });
  });

  it("adds a reference on the same plate, with its own growth control", () => {
    const layout = buildLayout(micForm({ ...polymers, compounds: [polymers.compounds[0]], reference: "same", referenceRows: "D–F", blank: "" }));
    expect(layout.groups.map((g) => [g.name, g.kind])).toEqual([
      ["LacGlyDOH 5:1:1", "sample"],
      ["Gentamicin", "reference"],
    ]);
    expect(layout.growth_control).toEqual(["A12", "B12", "C12", "D12", "E12", "F12"]);
  });

  it("ignores unnamed compound rows and builds the reference plate on its own", () => {
    const form = micForm({ ...polymers, compounds: [...polymers.compounds, { name: "  ", rows: "G" }] });
    expect(form.compounds).toHaveLength(2);
    const ref = buildLayout(referencePlateForm({ ...polymers, reference: "other", referenceRows: "A–C", blank: "D–H", top: 64 }));
    expect(ref.groups).toHaveLength(1);
    expect(ref.groups[0]).toMatchObject({ name: "Gentamicin", kind: "reference" });
    expect(ref.blank).toHaveLength(60);
    expect(ref.dilution.top).toBe(64);
  });
});
