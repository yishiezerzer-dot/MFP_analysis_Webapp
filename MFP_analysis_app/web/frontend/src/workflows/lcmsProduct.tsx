import { api, type LCMSSessionSummary } from "../api";
import { WorkflowChip as Chip, type Workflow } from "../components/workflow/WorkflowDialog";
import { SessionPick } from "../components/workflow/SessionPick";
import { requestView } from "../hooks/useViewRequest";
import {
  ACETATE_MASS,
  BUILT_IN_POLYMER_MONOMERS,
  CL_MASS,
  FORMATE_MASS,
  K_MASS,
  NA_MASS,
  PROTON_MASS,
  parseExpectedProductMonomers,
  type PolymerUiSettings,
} from "../lcms/analysis";

export type ProductAdduct = "na" | "k" | "cl" | "formate" | "acetate";
type IonMode = "positive" | "negative";

export interface ProductAnswers {
  source: "run" | "example";
  sid: string;
  runPolarities: string[];
  monomers: string[];
  otherMonomers: string;
  maxDp: number;
  mass: string;
  polarity: IonMode;
  adducts: ProductAdduct[];
  charges: string;
}

export const PRODUCT_DEFAULTS: ProductAnswers = {
  source: "run",
  sid: "",
  runPolarities: [],
  monomers: [],
  otherMonomers: "",
  maxDp: 6,
  mass: "",
  polarity: "positive",
  adducts: ["na"],
  charges: "1",
};

export interface ProductIon {
  label: string;
  mz: number;
}

// What the LCMS tab does with the answers (see LCMSView's useViewRequest).
export interface LcmsProductRequest {
  sid: string;
  polarity: IonMode;
  configure: (current: PolymerUiSettings) => PolymerUiSettings;
  targets: ProductIon[];
  toleranceDa: number;
  spectrumRt: number | null;
  openExpected: boolean;
}

const TOLERANCE_DA = 0.02;
const EXAMPLE_MONOMERS = ["hydroxy:glycolic-acid", "hydroxy:lactic-acid"];

const ADDUCTS: Record<ProductAdduct, { mode: IonMode; label: string; mass: number }> = {
  na: { mode: "positive", label: "[M+Na]⁺", mass: NA_MASS },
  k: { mode: "positive", label: "[M+K]⁺", mass: K_MASS },
  cl: { mode: "negative", label: "[M+Cl]⁻", mass: CL_MASS },
  formate: { mode: "negative", label: "[M+HCOO]⁻", mass: FORMATE_MASS },
  acetate: { mode: "negative", label: "[M+CH₃COO]⁻", mass: ACETATE_MASS },
};

const SUPERSCRIPT: Record<string, string> = { "2": "²", "3": "³", "4": "⁴" };

export function parseMass(text: string): number | null {
  const value = Number.parseFloat(text.replace(",", "."));
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function chargeStates(text: string): number[] {
  return text.split(",").map((c) => Number.parseInt(c, 10)).filter((c) => c > 0);
}

// Ions a neutral product of monoisotopic mass M gives: protonated/deprotonated at each charge, then each adduct.
export function productIons(mass: number, polarity: IonMode, adducts: ProductAdduct[], charges: string): ProductIon[] {
  const sign = polarity === "positive" ? 1 : -1;
  const ions = chargeStates(charges).map((z) => ({
    label: `[M${sign > 0 ? "+" : "−"}${z > 1 ? z : ""}H]${SUPERSCRIPT[String(z)] ?? ""}${sign > 0 ? "⁺" : "⁻"}`,
    mz: (mass + sign * z * PROTON_MASS) / z,
  }));
  for (const id of adducts) {
    const adduct = ADDUCTS[id];
    if (adduct.mode === polarity) ions.push({ label: adduct.label, mz: mass + adduct.mass });
  }
  return ions;
}

export function productSettings(a: ProductAnswers, current: PolymerUiSettings): PolymerUiSettings {
  const has = (id: ProductAdduct) => a.adducts.includes(id);
  return {
    ...current,
    shared: {
      ...current.shared,
      enabled: a.monomers.length > 0 || a.otherMonomers.trim() !== "",
      monomers_text: a.otherMonomers.trim(),
      max_dp: a.maxDp,
      charges: a.charges,
    },
    positive: { ...current.positive, adduct_na: has("na"), adduct_k: has("k") },
    negative: { ...current.negative, adduct_cl: has("cl"), adduct_formate: has("formate"), adduct_acetate: has("acetate") },
    monomers: current.monomers.map((m) => ({ ...m, selected: a.monomers.includes(m.id) })),
  };
}

const hasMonomers = (a: ProductAnswers) => a.monomers.length > 0 || parseExpectedProductMonomers(a.otherMonomers).length > 0;

function RunPick({ value, onPick }: { value: string; onPick: (run: LCMSSessionSummary) => void }) {
  return (
    <SessionPick
      value={value}
      onPick={onPick}
      list={api.lcms.list}
      upload={(file) => api.lcms.upload(file)}
      accept=".mzML,.mzml,.mzML.gz,.mzml.gz"
      noun="Run"
      openLabel="Open an mzML file…"
    />
  );
}

const field = "flex flex-col gap-1";
const toggle = <T,>(list: T[], item: T) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);

export function lcmsProductWorkflow(go: (path: string) => void): Workflow<ProductAnswers> {
  return {
    id: "lcms-product",
    title: "Find my product in an LC-MS run",
    defaults: PRODUCT_DEFAULTS,
    transient: ["sid", "runPolarities"],
    steps: [
      {
        id: "run",
        question: "Which run do you want to search?",
        explain:
          "An mzML file exported from the instrument software (e.g. with MSConvert). Runs you opened before are listed here. No run yet? Use the example: a positive-mode run of PLGA oligomers (glycolic and lactic acid chains).",
        render: (a, set) => (
          <div className="flex flex-col gap-3">
            <label className="flex items-center gap-2">
              <input type="radio" checked={a.source === "run"} onChange={() => set({ source: "run" })} />
              My run
            </label>
            {a.source === "run" && (
              <RunPick value={a.sid} onPick={(run) => set({ sid: run.session_id, runPolarities: run.polarities, ...(run.polarities.length === 1 && (run.polarities[0] === "positive" || run.polarities[0] === "negative") ? { polarity: run.polarities[0] } : {}) })} />
            )}
            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={a.source === "example"}
                onChange={() => set({ source: "example", runPolarities: ["positive"], polarity: "positive", monomers: a.monomers.length ? a.monomers : EXAMPLE_MONOMERS })}
              />
              The example run (PLGA oligomers, positive mode)
            </label>
          </div>
        ),
        check: (a) => (a.source === "run" && !a.sid ? "Choose or open a run first." : null),
      },
      {
        id: "monomers",
        question: "Which monomers is your product made of?",
        explain:
          "Pick the building blocks; the app then labels every chain it can make from them (e.g. GA₂LA₁) in each spectrum you click. Chains are joined by losing water, as in esters and amides. For a monomer that is not listed, type its name and monoisotopic mass. If you only know the product's mass, skip this and give the mass next.",
        render: (a, set) => (
          <div className="flex flex-col gap-3">
            {(["hydroxy", "amino"] as const).map((category) => (
              <div key={category} className="flex flex-col gap-1.5">
                <span className="label">{category === "hydroxy" ? "Hydroxy acids" : "Amino acids"}</span>
                <div className="flex flex-wrap gap-1.5">
                  {BUILT_IN_POLYMER_MONOMERS.filter((m) => m.category === category).map((m) => (
                    <Chip key={m.id} on={a.monomers.includes(m.id)} onClick={() => set({ monomers: toggle(a.monomers, m.id) })}>
                      {`${m.abbr} · ${m.name}`}
                    </Chip>
                  ))}
                </div>
              </div>
            ))}
            <label className={field}>
              <span className="label">Other monomers (one per line: name and mass)</span>
              <textarea className="input min-h-[52px]" placeholder="e.g. CL 114.068080" value={a.otherMonomers} onChange={(e) => set({ otherMonomers: e.target.value })} />
            </label>
            <label className={`${field} w-48`}>
              <span className="label">Longest chain to label</span>
              <input className="input" type="number" min={1} max={20} value={a.maxDp} onChange={(e) => set({ maxDp: e.target.valueAsNumber })} />
            </label>
          </div>
        ),
        check: (a) => (Number.isInteger(a.maxDp) && a.maxDp >= 1 && a.maxDp <= 20 ? null : "Longest chain should be 1–20 units."),
      },
      {
        id: "mass",
        question: "Do you know your product's mass?",
        explain:
          "The neutral monoisotopic mass in Da (not the m/z), e.g. from ChemDraw's \"Exact Mass\". The app works out the ions it gives and draws an extracted-ion chromatogram (EIC) for each, so you see when it elutes. Leave it empty if you only know the monomers.",
        render: (a, set) => (
          <label className={`${field} w-56`}>
            <span className="label">Monoisotopic mass (Da), optional</span>
            <input className="input" inputMode="decimal" placeholder="e.g. 206.0427" value={a.mass} onChange={(e) => set({ mass: e.target.value })} />
          </label>
        ),
        check: (a) => {
          if (a.mass.trim() && parseMass(a.mass) === null) return "The mass should be a number above 0, e.g. 206.0427.";
          return hasMonomers(a) || parseMass(a.mass) ? null : "Give the product's mass, or go back and pick its monomers.";
        },
      },
      {
        id: "ions",
        question: "How was it ionised?",
        explain:
          "Positive mode gives [M+H]⁺, often with sodium [M+Na]⁺ or potassium [M+K]⁺ from glassware and buffers. Negative mode gives [M−H]⁻, with chloride or formate/acetate from the mobile phase. Small molecules are mostly charge 1; peptides and large chains also show charge 2 and up.",
        render: (a, set) => (
          <div className="flex flex-col gap-3">
            <div className="flex gap-4">
              {(["positive", "negative"] as const).map((p) => (
                <label key={p} className="flex items-center gap-2">
                  <input type="radio" checked={a.polarity === p} onChange={() => set({ polarity: p })} />
                  {p === "positive" ? "Positive (ESI+)" : "Negative (ESI−)"}
                </label>
              ))}
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="label">Also look for</span>
              <div className="flex flex-wrap gap-1.5">
                {(Object.keys(ADDUCTS) as ProductAdduct[])
                  .filter((id) => ADDUCTS[id].mode === a.polarity)
                  .map((id) => (
                    <Chip key={id} on={a.adducts.includes(id)} onClick={() => set({ adducts: toggle(a.adducts, id) })}>
                      {ADDUCTS[id].label}
                    </Chip>
                  ))}
              </div>
            </div>
            <label className={`${field} w-56`}>
              <span className="label">Charge states</span>
              <select className="input" value={a.charges} onChange={(e) => set({ charges: e.target.value })}>
                <option value="1">1 only</option>
                <option value="1,2">1 and 2</option>
                <option value="1,2,3">1 to 3</option>
              </select>
            </label>
          </div>
        ),
        check: (a) =>
          a.runPolarities.length > 0 && !a.runPolarities.includes(a.polarity)
            ? `This run has no ${a.polarity} scans; it was recorded in ${a.runPolarities.join(" and ")} mode.`
            : null,
      },
    ],
    summary: (a) => {
      const lines = [a.source === "example" ? "Open the example PLGA run" : "Show the run you chose", `Switch to ${a.polarity} mode`];
      const names = [
        ...BUILT_IN_POLYMER_MONOMERS.filter((m) => a.monomers.includes(m.id)).map((m) => m.abbr),
        ...parseExpectedProductMonomers(a.otherMonomers).map((m) => m.name),
      ];
      if (names.length) lines.push(`Label chains of ${names.join(", ")} up to ${a.maxDp} units in every spectrum`);
      const mass = parseMass(a.mass);
      if (mass) {
        const ions = productIons(mass, a.polarity, a.adducts, a.charges);
        lines.push(`Draw an EIC for ${ions.map((i) => `${i.label} ${i.mz.toFixed(4)}`).join(", ")}`);
        lines.push("Show the spectrum where your product is strongest");
      } else {
        lines.push("Show the spectrum at the biggest TIC peak, with the expected products found in it");
      }
      return lines;
    },
    run: async (a) => {
      const sid = a.source === "example" ? (await api.examples.open("lcms-plga")).session_ids[0] : a.sid;
      const mass = parseMass(a.mass);
      const targets = mass ? productIons(mass, a.polarity, a.adducts, a.charges) : [];
      let spectrumRt: number | null = null;
      let message = "";
      if (targets.length) {
        const hits = await Promise.all(
          targets.map((t) => api.lcms.findMz(sid, { mz: t.mz, tolerance: TOLERANCE_DA, tolerance_unit: "da", polarity: a.polarity })),
        );
        let best = -1;
        hits.forEach((h, i) => {
          if (h.best.rt_min != null && h.best.intensity > 0 && (best < 0 || h.best.intensity > hits[best].best.intensity)) best = i;
        });
        if (best >= 0) {
          spectrumRt = hits[best].best.rt_min;
          message = `Found ${targets[best].label} at ${spectrumRt?.toFixed(2)} min`;
        } else {
          message = "None of the product's ions are in this run — showing the biggest TIC peak instead";
        }
      }
      if (spectrumRt === null) {
        const tic = await api.lcms.tic(sid, a.polarity);
        let top = -1;
        tic.tic.forEach((v, i) => {
          if (top < 0 || v > tic.tic[top]) top = i;
        });
        spectrumRt = top >= 0 ? tic.rt_min[top] : null;
        if (!message) message = "Polymer labels on — showing the biggest TIC peak";
      }
      requestView<LcmsProductRequest>("lcms", {
        sid,
        polarity: a.polarity,
        configure: (current) => productSettings(a, current),
        targets,
        toleranceDa: TOLERANCE_DA,
        spectrumRt,
        openExpected: !mass && hasMonomers(a),
      });
      go("/lcms");
      return message;
    },
  };
}
