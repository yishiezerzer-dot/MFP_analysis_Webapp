import { useState, type ReactNode } from "react";
import clsx from "clsx";
import { Plus, Trash2, X } from "lucide-react";
import type { PlateGroupKind, PlateLayoutSource, PlateTemplate } from "../../api";
import { ICON_PROPS } from "../common/ChartCardParts";
import { Hint } from "../Hint";
import {
  newGroupId,
  nextColour,
  type CompoundForm,
  type FormProblem,
  type LayoutForm,
} from "../../utils/plateLayout";

const UNITS = ["µg/mL", "mg/mL", "µM", "mM", "% v/v"];
const FACTORS = [2, 3, 4, 10];

function Field({ label, children, error, hint }: { label: string; children: ReactNode; error?: boolean; hint?: string }) {
  const field = (
    <label className="flex min-w-0 flex-1 flex-col gap-1">
      <span className={clsx("label", error && "text-danger-fg")}>{label}</span>
      {children}
    </label>
  );
  return hint ? (
    <Hint id={hint} className="min-w-0 w-full">
      {field}
    </Hint>
  ) : (
    field
  );
}

export type SaveState = "idle" | "saving" | "saved" | "error";

export function LayoutPanel({
  form,
  onFormChange,
  problems,
  dirty,
  onApply,
  notes,
  layoutSource,
  templates,
  onLoadTemplate,
  onSaveTemplate,
  onDeleteTemplate,
  saveState,
}: {
  form: LayoutForm;
  onFormChange: (form: LayoutForm) => void;
  problems: FormProblem[];
  dirty: boolean;
  onApply: () => void;
  notes: string[];
  layoutSource: PlateLayoutSource;
  templates: PlateTemplate[];
  onLoadTemplate: (t: PlateTemplate) => void;
  onSaveTemplate: (name: string) => void;
  onDeleteTemplate: (t: PlateTemplate) => void;
  saveState: SaveState;
}) {
  const [templateName, setTemplateName] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState("");
  const d = form.dilution;
  const byColumns = d.direction === "columns";
  const lineWord = byColumns ? "Rows" : "Columns";
  const has = (field: string) => problems.some((p) => p.field === field);

  const setDilution = (patch: Partial<LayoutForm["dilution"]>) =>
    onFormChange({ ...form, dilution: { ...d, ...patch } });
  const setCompound = (id: string, patch: Partial<CompoundForm>) =>
    onFormChange({ ...form, compounds: form.compounds.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
  const addCompound = (kind: PlateGroupKind) =>
    onFormChange({
      ...form,
      compounds: [
        ...form.compounds,
        {
          id: newGroupId(),
          name: kind === "reference" ? "Gentamicin" : `Compound ${form.compounds.length + 1}`,
          kind,
          lines: "",
          colour: nextColour(form.compounds.map((c) => c.colour)),
        },
      ],
    });

  const selectedTemplate = templates.find((t) => t.id === templateId) ?? null;

  return (
    <aside
      aria-label="Plate layout"
      className="flex w-[360px] min-w-0 shrink-0 flex-col overflow-y-auto overflow-x-hidden border-l border-ink-200 bg-surface"
    >
      <div className="flex flex-col gap-4 p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-card-title">Layout</h2>
          <span className="text-caption" aria-live="polite">
            {saveState === "saving" && "Saving…"}
            {saveState === "saved" && "Saved"}
            {saveState === "error" && <span className="text-danger-fg">Not saved</span>}
          </span>
        </div>

        <div className="flex items-end gap-2">
          <Field label="Template" hint="plate.template">
            <select
              className="input w-full"
              value={templateId}
              onChange={(e) => {
                setTemplateId(e.target.value);
                const t = templates.find((x) => x.id === e.target.value);
                if (t) onLoadTemplate(t);
              }}
            >
              <option value="">{templates.length ? "Choose a template…" : "No templates yet"}</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </Field>
          {selectedTemplate && (
            <Hint id="plate.deleteTemplate">
              <button
                type="button"
                className="btn-ghost px-1.5"
                aria-label={`Delete template ${selectedTemplate.name}`}
                onClick={() => {
                  onDeleteTemplate(selectedTemplate);
                  setTemplateId("");
                }}
              >
                <Trash2 {...ICON_PROPS} />
              </button>
            </Hint>
          )}
        </div>

        {notes.length > 0 && (
          <div className="rounded-md border border-dashed border-ink-300 bg-ink-50 px-3 py-2 text-[12px] text-ink-600">
            <div className="font-medium text-ink-700">
              {layoutSource === "notes" ? "Filled from your Gen5 notes" : "Gen5 notes"}
            </div>
            {notes.map((n, i) => (
              <div key={i} className="font-mono">
                {n}
              </div>
            ))}
          </div>
        )}

        <section className="flex flex-col gap-2">
          <h3 className="text-section">Dilution series</h3>
          <div className="grid grid-cols-2 gap-x-3 gap-y-2">
            <Field label="Top concentration" error={has("top")} hint="plate.top">
              <input
                className="input"
                type="number"
                min={0}
                step="any"
                value={Number.isFinite(d.top) ? d.top : ""}
                onChange={(e) => setDilution({ top: e.target.valueAsNumber })}
              />
            </Field>
            <Field label="Unit" hint="plate.unit">
              <select className="input" value={d.unit} onChange={(e) => setDilution({ unit: e.target.value })}>
                {(UNITS.includes(d.unit) ? UNITS : [d.unit, ...UNITS]).map((u) => (
                  <option key={u}>{u}</option>
                ))}
              </select>
            </Field>
            <Field label="Direction" hint="plate.direction">
              <select
                className="input"
                value={d.direction}
                onChange={(e) => {
                  const direction = e.target.value as LayoutForm["dilution"]["direction"];
                  const range = direction === "columns" ? { first: 1, last: 11 } : { first: 1, last: 7 };
                  onFormChange({
                    ...form,
                    dilution: { ...d, direction, ...range },
                    control: direction === "columns" ? "12" : "H",
                    blank: "",
                    compounds: form.compounds.map((c) => ({ ...c, lines: "" })),
                  });
                }}
              >
                <option value="columns">Across columns</option>
                <option value="rows">Down rows</option>
              </select>
            </Field>
            <Field label="Factor" error={has("factor")} hint="plate.factor">
              <select className="input" value={d.factor} onChange={(e) => setDilution({ factor: Number(e.target.value) })}>
                {(FACTORS.includes(d.factor) ? FACTORS : [d.factor, ...FACTORS]).map((f) => (
                  <option key={f} value={f}>
                    ÷{f}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={byColumns ? "From column (top)" : "From row (top)"} error={has("range")} hint="plate.range">
              <input
                className="input"
                type="number"
                min={1}
                max={byColumns ? 12 : 8}
                value={d.first}
                onChange={(e) => setDilution({ first: e.target.valueAsNumber })}
              />
            </Field>
            <Field label={byColumns ? "To column" : "To row"} error={has("range")} hint="plate.range">
              <input
                className="input"
                type="number"
                min={1}
                max={byColumns ? 12 : 8}
                value={d.last}
                onChange={(e) => setDilution({ last: e.target.valueAsNumber })}
              />
            </Field>
          </div>
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="text-section">Compounds</h3>
          {form.compounds.length === 0 && (
            <p className="text-caption">No compounds yet. Add one and type the {lineWord.toLowerCase()} it fills.</p>
          )}
          {form.compounds.map((c) => (
            <div key={c.id} className="grid grid-cols-2 gap-x-3 gap-y-2 rounded-lg border border-ink-200 p-3">
              <div className="col-span-2 flex items-center gap-2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: c.colour }} aria-hidden />
                <Hint id="plate.compoundName" className="min-w-0 flex-1">
                  <input
                    className={clsx("input min-w-0 flex-1 font-semibold", has(`name:${c.id}`) && "border-danger")}
                    aria-label="Compound name"
                    value={c.name}
                    onChange={(e) => setCompound(c.id, { name: e.target.value })}
                  />
                </Hint>
                <Hint id="plate.removeCompound">
                  <button
                    type="button"
                    className="btn-ghost px-1.5"
                    aria-label={`Remove ${c.name}`}
                    onClick={() => onFormChange({ ...form, compounds: form.compounds.filter((x) => x.id !== c.id) })}
                  >
                    <X {...ICON_PROPS} />
                  </button>
                </Hint>
              </div>
              <Field label={lineWord} error={has(`lines:${c.id}`)} hint="plate.compoundRows">
                <input
                  className="input"
                  placeholder={byColumns ? "A–C" : "1–3"}
                  value={c.lines}
                  onChange={(e) => setCompound(c.id, { lines: e.target.value })}
                />
              </Field>
              <Field label="Kind" hint="plate.compoundKind">
                <select
                  className="input"
                  value={c.kind}
                  onChange={(e) => setCompound(c.id, { kind: e.target.value as PlateGroupKind })}
                >
                  <option value="sample">Sample</option>
                  <option value="reference">Reference</option>
                </select>
              </Field>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <Hint id="plate.addCompound">
              <button type="button" className="btn-ghost border border-ink-200 text-xs" onClick={() => addCompound("sample")}>
                <Plus {...ICON_PROPS} />
                Add compound
              </button>
            </Hint>
            <Hint id="plate.addReference">
              <button type="button" className="btn-ghost border border-ink-200 text-xs" onClick={() => addCompound("reference")}>
                <Plus {...ICON_PROPS} />
                Reference (e.g. gentamicin)
              </button>
            </Hint>
          </div>
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="text-section">Controls</h3>
          <div className="grid grid-cols-2 gap-x-3 gap-y-2">
            <Field label={byColumns ? "Growth control column" : "Growth control row"} error={has("control")} hint="plate.growthControl">
              <input
                className="input"
                placeholder={byColumns ? "12" : "H"}
                value={form.control}
                onChange={(e) => onFormChange({ ...form, control: e.target.value })}
              />
            </Field>
            <Field label={`Blank ${lineWord.toLowerCase()} (optional)`} error={has("blank")} hint="plate.blank">
              <input
                className="input"
                placeholder={byColumns ? "G–H" : "11–12"}
                value={form.blank}
                onChange={(e) => onFormChange({ ...form, blank: e.target.value })}
              />
            </Field>
          </div>
          <p className="text-caption">
            Each compound is compared with the growth-control wells in its own {lineWord.toLowerCase()}.
          </p>
        </section>

        {problems.length > 0 && (
          <ul className="rounded-md border border-danger/30 bg-danger-surface px-3 py-2 text-[12px] text-danger-fg">
            {problems.map((p) => (
              <li key={p.field}>{p.message}</li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Hint id="plate.apply" extra={dirty ? undefined : "The plate already matches this form."}>
            <button type="button" className="btn-primary" disabled={!dirty || problems.length > 0} onClick={onApply}>
              Apply to plate
            </button>
          </Hint>
          {templateName === null ? (
            <Hint id="plate.saveTemplate" extra={dirty ? "Apply your changes first: the template saves the plate as shown." : undefined}>
              <button
                type="button"
                className="btn-ghost border border-ink-200"
                disabled={dirty}
                onClick={() => setTemplateName(selectedTemplate?.name ?? "")}
              >
                Save as template
              </button>
            </Hint>
          ) : (
            <form
              className="flex w-full items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!templateName.trim()) return;
                onSaveTemplate(templateName.trim());
                setTemplateName(null);
              }}
            >
              <input
                autoFocus
                className="input min-w-0 flex-1"
                aria-label="Template name"
                placeholder="e.g. MIC 2 compounds × 3 + blank"
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                onKeyDown={(e) => e.key === "Escape" && setTemplateName(null)}
              />
              <button type="submit" className="btn-primary" disabled={!templateName.trim()}>
                Save
              </button>
              <button type="button" className="btn-ghost" onClick={() => setTemplateName(null)}>
                Cancel
              </button>
            </form>
          )}
        </div>
        {dirty && problems.length === 0 && (
          <p className="text-caption">Unapplied changes: press Apply to update the plate.</p>
        )}
      </div>
    </aside>
  );
}
