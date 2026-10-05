import { Plus, X } from "lucide-react";
import { api, type PlateSummary } from "../api";
import type { Workflow } from "../components/workflow/WorkflowDialog";
import { SessionPick } from "../components/workflow/SessionPick";
import { ICON_PROPS } from "../components/common/ChartCardParts";
import { notifySessionsChanged } from "../hooks/useSessionsChanged";
import {
  DEFAULT_DILUTION,
  GROUP_COLOURS,
  buildLayout,
  formFromLayout,
  newGroupId,
  parseSpec,
  type CompoundForm,
  type LayoutForm,
} from "../utils/plateLayout";

export interface MicCompound {
  name: string;
  rows: string;
}

export interface MicAnswers {
  source: "plate" | "example";
  plateId: string;
  compounds: MicCompound[];
  top: number;
  unit: string;
  factor: number;
  control: string;
  blank: string;
  reference: "same" | "other" | "none";
  referenceName: string;
  referenceRows: string;
  referencePlateId: string;
  tag: string;
}

export const MIC_DEFAULTS: MicAnswers = {
  source: "plate",
  plateId: "",
  compounds: [{ name: "", rows: "A–C" }],
  top: DEFAULT_DILUTION.top,
  unit: DEFAULT_DILUTION.unit,
  factor: DEFAULT_DILUTION.factor,
  control: "12",
  blank: "",
  reference: "none",
  referenceName: "Gentamicin",
  referenceRows: "A–C",
  referencePlateId: "",
  tag: "",
};

const rowsOk = (text: string) => {
  const parsed = parseSpec(text, "row");
  return parsed !== null && parsed.length > 0;
};

// Plate answers → the layout form used by the Plate map (compounds, then the reference).
export function micForm(a: MicAnswers): LayoutForm {
  const compounds: CompoundForm[] = a.compounds
    .filter((c) => c.name.trim())
    .map((c, i) => ({ id: newGroupId(), name: c.name.trim(), kind: "sample", lines: c.rows, colour: GROUP_COLOURS[i % GROUP_COLOURS.length] }));
  if (a.reference === "same") {
    compounds.push({ id: newGroupId(), name: a.referenceName.trim() || "Gentamicin", kind: "reference", lines: a.referenceRows, colour: GROUP_COLOURS[compounds.length % GROUP_COLOURS.length] });
  }
  return {
    dilution: { ...DEFAULT_DILUTION, top: a.top, unit: a.unit, factor: a.factor },
    compounds,
    control: a.control,
    blank: a.blank,
  };
}

export function referencePlateForm(a: MicAnswers): LayoutForm {
  return {
    dilution: { ...DEFAULT_DILUTION, top: a.top, unit: a.unit, factor: a.factor },
    compounds: [{ id: newGroupId(), name: a.referenceName.trim() || "Gentamicin", kind: "reference", lines: a.referenceRows, colour: GROUP_COLOURS[2] }],
    control: a.control,
    blank: a.blank,
  };
}

function PlatePick({ value, onPick, exclude }: { value: string; onPick: (p: PlateSummary) => void; exclude?: string }) {
  return (
    <SessionPick
      value={value}
      onPick={onPick}
      exclude={exclude}
      list={api.plateReader.list}
      upload={api.plateReader.upload}
      accept=".xlsx,.xlsm,.xls,.csv,.txt,.tsv"
      noun="Plate"
      openLabel="Open a plate file…"
    />
  );
}

function compoundsFrom(plate: PlateSummary): MicCompound[] | null {
  const samples = plate.layout.groups.filter((g) => g.kind === "sample");
  if (samples.length === 0) return null;
  const form = formFromLayout(plate.layout);
  return samples.map((g) => ({ name: g.name, rows: form.compounds.find((c) => c.id === g.id)?.lines ?? "" }));
}

const field = "flex flex-col gap-1";

export function micPlateWorkflow(go: (path: string) => void): Workflow<MicAnswers> {
  return {
    id: "mic-plate",
    title: "Analyse a MIC plate",
    defaults: MIC_DEFAULTS,
    transient: ["plateId", "referencePlateId", "compounds"],
    steps: [
      {
        id: "plate",
        question: "Which plate do you want to analyse?",
        explain:
          "A BioTek Gen5 Excel export works best (notes typed under the plate fill in the compounds), but any sheet or CSV with an 8×12 block labelled A–H and 1–12 is fine. No plate yet? Use the example plates.",
        render: (a, set) => (
          <div className="flex flex-col gap-3">
            <label className="flex items-center gap-2">
              <input type="radio" checked={a.source === "plate"} onChange={() => set({ source: "plate" })} />
              My plate
            </label>
            {a.source === "plate" && (
              <PlatePick
                value={a.plateId}
                onPick={(p) => set({ plateId: p.session_id, ...(compoundsFrom(p) ? { compounds: compoundsFrom(p) as MicCompound[] } : {}) })}
              />
            )}
            <label className="flex items-center gap-2">
              <input type="radio" checked={a.source === "example"} onChange={() => set({ source: "example" })} />
              The example plates (two polymers and gentamicin, real data)
            </label>
          </div>
        ),
        check: (a) => (a.source === "plate" && !a.plateId ? "Choose or open a plate first." : null),
      },
      {
        id: "compounds",
        question: "Which compounds are on the plate, and in which rows?",
        explain:
          "Each compound usually fills three replicate rows, e.g. A–C. Type a range (A–C) or a list (A, C, E). Leave out the reference antibiotic here; it comes in a later step.",
        skip: (a) => a.source === "example",
        render: (a, set) => (
          <div className="flex flex-col gap-2">
            {a.compounds.map((c, i) => (
              <div key={i} className="flex items-end gap-2">
                <label className={`${field} flex-1`}>
                  <span className="label">Compound</span>
                  <input
                    className="input"
                    value={c.name}
                    placeholder="e.g. LacGlyDOH 5:1:1"
                    onChange={(e) => set({ compounds: a.compounds.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })}
                  />
                </label>
                <label className={`${field} w-24`}>
                  <span className="label">Rows</span>
                  <input
                    className="input"
                    value={c.rows}
                    onChange={(e) => set({ compounds: a.compounds.map((x, j) => (j === i ? { ...x, rows: e.target.value } : x)) })}
                  />
                </label>
                {a.compounds.length > 1 && (
                  <button
                    type="button"
                    className="btn-ghost mb-0.5 px-1.5"
                    aria-label={`Remove ${c.name || "compound"}`}
                    onClick={() => set({ compounds: a.compounds.filter((_, j) => j !== i) })}
                  >
                    <X {...ICON_PROPS} />
                  </button>
                )}
              </div>
            ))}
            <button type="button" className="btn-ghost self-start border border-ink-200 text-xs" onClick={() => set({ compounds: [...a.compounds, { name: "", rows: "" }] })}>
              <Plus {...ICON_PROPS} />
              Add compound
            </button>
          </div>
        ),
        check: (a) => {
          const named = a.compounds.filter((c) => c.name.trim());
          if (named.length === 0) return "Name at least one compound.";
          const bad = named.find((c) => !rowsOk(c.rows));
          return bad ? `${bad.name}: rows should look like A–C or A, B, C.` : null;
        },
      },
      {
        id: "dilution",
        question: "What is the dilution series?",
        explain:
          "Column 1 holds the highest concentration and each column to the right is diluted by the factor, up to column 11. For a two-fold series from 1024 µg/mL, column 11 is 1 µg/mL.",
        skip: (a) => a.source === "example",
        render: (a, set) => (
          <div className="grid grid-cols-3 gap-3">
            <label className={field}>
              <span className="label">Top concentration (column 1)</span>
              <input className="input" type="number" min={0} step="any" value={a.top} onChange={(e) => set({ top: e.target.valueAsNumber })} />
            </label>
            <label className={field}>
              <span className="label">Unit</span>
              <select className="input" value={a.unit} onChange={(e) => set({ unit: e.target.value })}>
                {["µg/mL", "mg/mL", "µM", "mM", "% v/v"].map((u) => (
                  <option key={u}>{u}</option>
                ))}
              </select>
            </label>
            <label className={field}>
              <span className="label">Dilution</span>
              <select className="input" value={a.factor} onChange={(e) => set({ factor: Number(e.target.value) })}>
                {[2, 3, 4, 10].map((f) => (
                  <option key={f} value={f}>
                    ÷{f}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ),
        check: (a) => (a.top > 0 ? null : "Top concentration must be above 0."),
      },
      {
        id: "controls",
        question: "Where are the growth control and the blank?",
        explain:
          "The growth control is bacteria without compound (100% growth), usually column 12. The blank is medium only; its OD is subtracted from every well. If your plate has no blank wells, leave Blank rows empty.",
        skip: (a) => a.source === "example",
        render: (a, set) => (
          <div className="grid grid-cols-2 gap-3">
            <label className={field}>
              <span className="label">Growth control column</span>
              <input className="input" value={a.control} onChange={(e) => set({ control: e.target.value })} />
            </label>
            <label className={field}>
              <span className="label">Blank rows (optional)</span>
              <input className="input" placeholder="e.g. G–H" value={a.blank} onChange={(e) => set({ blank: e.target.value })} />
            </label>
          </div>
        ),
        check: (a) => {
          const col = parseSpec(a.control, "col");
          if (!col || col.length === 0) return "Growth control column should be a column number, e.g. 12.";
          return parseSpec(a.blank, "row") === null ? "Blank rows should look like G–H, or stay empty." : null;
        },
      },
      {
        id: "reference",
        question: "Is there a reference antibiotic (e.g. gentamicin)?",
        explain:
          "A reference with a known MIC shows the assay worked. It can sit on the same plate or on its own plate; with its own plate, both plates get the same experiment tag so the Experiment view shows them together.",
        skip: (a) => a.source === "example",
        render: (a, set) => (
          <div className="flex flex-col gap-3">
            {(["same", "other", "none"] as const).map((r) => (
              <label key={r} className="flex items-center gap-2">
                <input type="radio" checked={a.reference === r} onChange={() => set({ reference: r })} />
                {r === "same" ? "Yes, on this plate" : r === "other" ? "Yes, on another plate" : "No reference"}
              </label>
            ))}
            {a.reference !== "none" && (
              <div className="grid grid-cols-2 gap-3 rounded-md border border-ink-200 p-3">
                <label className={field}>
                  <span className="label">Name</span>
                  <input className="input" value={a.referenceName} onChange={(e) => set({ referenceName: e.target.value })} />
                </label>
                <label className={field}>
                  <span className="label">Rows</span>
                  <input className="input" value={a.referenceRows} onChange={(e) => set({ referenceRows: e.target.value })} />
                </label>
                {a.reference === "other" && (
                  <>
                    <div className="col-span-2">
                      <span className="label">Reference plate</span>
                      <PlatePick value={a.referencePlateId} exclude={a.plateId} onPick={(p) => set({ referencePlateId: p.session_id })} />
                    </div>
                    <label className={`${field} col-span-2`}>
                      <span className="label">Experiment tag for both plates</span>
                      <input className="input" placeholder="e.g. MIC run 12" value={a.tag} onChange={(e) => set({ tag: e.target.value })} />
                    </label>
                  </>
                )}
              </div>
            )}
          </div>
        ),
        check: (a) => {
          if (a.reference === "none") return null;
          if (!rowsOk(a.referenceRows)) return "Reference rows should look like A–C.";
          if (a.reference === "other" && !a.referencePlateId) return "Choose or open the reference plate.";
          if (a.reference === "other" && !a.tag.trim()) return "Give the experiment a tag so both plates are combined.";
          return null;
        },
      },
    ],
    summary: (a) => {
      if (a.source === "example") return ["Open the two example plates, already laid out", "Show the gentamicin plate's results"];
      const lines = [
        ...a.compounds.filter((c) => c.name.trim()).map((c) => `Lay out ${c.name.trim()} in rows ${c.rows}`),
        `Dilute from ${a.top} ${a.unit} in column 1, ÷${a.factor} per column to column 11`,
        `Use column ${a.control} as growth control${a.blank.trim() ? ` and rows ${a.blank} as blank` : ", with no blank"}`,
      ];
      if (a.reference === "same") lines.push(`Lay out ${a.referenceName} as the reference in rows ${a.referenceRows}`);
      if (a.reference === "other") lines.push(`Lay out ${a.referenceName} on the reference plate (rows ${a.referenceRows}) and tag both plates "${a.tag.trim()}"`);
      lines.push("Open the Results tab");
      return lines;
    },
    run: async (a) => {
      if (a.source === "example") {
        const opened = await api.examples.open("plate-mic");
        notifySessionsChanged("plate_reader");
        go(`/plate-reader?open=${opened.session_ids[0]}&view=results`);
        return "Example plates opened";
      }
      const plate = await api.plateReader.get(a.plateId);
      await api.plateReader.saveLayout(a.plateId, buildLayout(micForm(a), plate.layout.excluded));
      if (a.reference === "other") {
        const ref = await api.plateReader.get(a.referencePlateId);
        await api.plateReader.saveLayout(a.referencePlateId, buildLayout(referencePlateForm(a), ref.layout.excluded));
        await Promise.all([a.plateId, a.referencePlateId].map((sid) => api.experiments.updateSessionTag(sid, a.tag.trim())));
      }
      notifySessionsChanged("plate_reader");
      go(`/plate-reader?open=${a.plateId}&view=results`);
      return "Plate laid out — showing the results";
    },
  };
}
