import { useEffect, useState } from "react";
import { api, type FTIRPreprocessOptions } from "../api";
import { SessionPick } from "../components/workflow/SessionPick";
import { WorkflowChip, type Workflow } from "../components/workflow/WorkflowDialog";
import { requestView } from "../hooks/useViewRequest";
import { FTIR_PRESETS } from "../utils/ftirPresets";

export type FtirSample = "ATR sample" | "KBr disc" | "Polymer thin film" | "Raw film";
export type PeakAmount = "main" | "most" | "all";

export interface FtirAnswers {
  source: "spectrum" | "example";
  sid: string;
  sample: FtirSample;
  exclude: string[];
  amount: PeakAmount;
}

export const FTIR_DEFAULTS: FtirAnswers = {
  source: "spectrum",
  sid: "",
  sample: "ATR sample",
  exclude: [],
  amount: "most",
};

export interface FtirPeakOptions {
  top_n: number;
  min_prominence: number;
}

// What the FTIR tab does with the answers (see FTIRView's useViewRequest).
export interface FtirPeaksRequest {
  sid: string;
  preprocess: Partial<FTIRPreprocessOptions>;
  peaks: FtirPeakOptions;
  exclude: string[];
}

const SAMPLES: { id: FtirSample; label: string }[] = [
  { id: "ATR sample", label: "ATR — pressed onto the crystal (most common)" },
  { id: "KBr disc", label: "KBr disc — ground into a pellet" },
  { id: "Polymer thin film", label: "Thin film — cast or pressed, measured in transmission" },
  { id: "Raw film", label: "Leave it as measured (no clean-up)" },
];

export const PEAK_AMOUNTS: Record<PeakAmount, { label: string } & FtirPeakOptions> = {
  main: { label: "The main peaks (up to 10)", top_n: 10, min_prominence: 0.02 },
  most: { label: "Most peaks (up to 15)", top_n: 15, min_prominence: 0.01 },
  all: { label: "Everything above the noise (up to 40)", top_n: 40, min_prominence: 0.003 },
};

export function ftirRequest(a: FtirAnswers, sid: string): FtirPeaksRequest {
  const { top_n, min_prominence } = PEAK_AMOUNTS[a.amount];
  return { sid, preprocess: FTIR_PRESETS[a.sample], peaks: { top_n, min_prominence }, exclude: a.exclude };
}

function CategoryChips({ value, onChange }: { value: string[]; onChange: (next: string[]) => void }) {
  const [categories, setCategories] = useState<string[] | null>(null);
  useEffect(() => {
    api.ftir
      .libraryCategories()
      .then((c) => setCategories(c.categories))
      .catch(() => setCategories([]));
  }, []);
  if (categories === null) return <p className="text-caption">Loading the bond library…</p>;
  if (categories.length === 0) return <p className="text-caption">The bond library is not available; every group will be considered.</p>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {categories.map((c) => (
        <WorkflowChip key={c} on={value.includes(c)} onClick={() => onChange(value.includes(c) ? value.filter((x) => x !== c) : [...value, c])}>
          {c}
        </WorkflowChip>
      ))}
    </div>
  );
}

export function ftirPeaksWorkflow(go: (path: string) => void): Workflow<FtirAnswers> {
  return {
    id: "ftir-peaks",
    title: "Identify FTIR peaks",
    defaults: FTIR_DEFAULTS,
    transient: ["sid"],
    steps: [
      {
        id: "spectrum",
        question: "Which spectrum do you want to identify?",
        explain:
          "A two-column file (wavenumber, then absorbance or transmittance) as CSV, TXT or JCAMP-DX, as exported by the instrument software. Whether it is absorbance or transmittance is detected from the file. No spectrum yet? Use the example PLGA film.",
        render: (a, set) => (
          <div className="flex flex-col gap-3">
            <label className="flex items-center gap-2">
              <input type="radio" checked={a.source === "spectrum"} onChange={() => set({ source: "spectrum" })} />
              My spectrum
            </label>
            {a.source === "spectrum" && (
              <SessionPick
                value={a.sid}
                onPick={(s) => set({ sid: s.session_id })}
                list={api.ftir.list}
                upload={(file) => api.ftir.upload(file)}
                accept=".csv,.txt,.tsv,.dx,.jdx,.spc"
                noun="Spectrum"
                openLabel="Open a spectrum file…"
              />
            )}
            <label className="flex items-center gap-2">
              <input type="radio" checked={a.source === "example"} onChange={() => set({ source: "example", sample: "Polymer thin film" })} />
              The example spectrum (PLGA film)
            </label>
          </div>
        ),
        check: (a) => (a.source === "spectrum" && !a.sid ? "Choose or open a spectrum first." : null),
      },
      {
        id: "sample",
        question: "How was the sample measured?",
        explain:
          "This picks the clean-up: smoothing, baseline removal and scaling. ATR spectra also get the ATR correction, which evens out the peaks at low wavenumbers that ATR makes look too strong. If unsure, choose ATR — it is how most of our samples are measured.",
        render: (a, set) => (
          <div className="flex flex-col gap-2">
            {SAMPLES.map((s) => (
              <label key={s.id} className="flex items-center gap-2">
                <input type="radio" checked={a.sample === s.id} onChange={() => set({ sample: s.id })} />
                {s.label}
              </label>
            ))}
          </div>
        ),
      },
      {
        id: "exclude",
        question: "Which groups can your sample not contain?",
        explain:
          "Each peak gets the best-matching bonds from the library. Ruling out families that cannot be there (e.g. amide, amine and nitrile in a pure polyester) stops them from being suggested. If unsure, rule out nothing; you can do it later in the Peaks panel.",
        render: (a, set) => (
          <div className="flex flex-col gap-2">
            <span className="label">Tap to rule out (optional)</span>
            <CategoryChips value={a.exclude} onChange={(exclude) => set({ exclude })} />
          </div>
        ),
      },
      {
        id: "amount",
        question: "How many peaks do you want labelled?",
        explain:
          "Fewer peaks keep the chart readable for a figure; more peaks help when you are looking for a weak band. You can add or remove single peaks by clicking afterwards.",
        render: (a, set) => (
          <div className="flex flex-col gap-2">
            {(Object.keys(PEAK_AMOUNTS) as PeakAmount[]).map((id) => (
              <label key={id} className="flex items-center gap-2">
                <input type="radio" checked={a.amount === id} onChange={() => set({ amount: id })} />
                {PEAK_AMOUNTS[id].label}
              </label>
            ))}
          </div>
        ),
      },
    ],
    summary: (a) => [
      a.source === "example" ? "Open the example PLGA film spectrum" : "Show the spectrum you chose",
      a.sample === "Raw film" ? "Leave the spectrum as measured" : `Clean it up with the ${a.sample} preset`,
      `Pick ${PEAK_AMOUNTS[a.amount].label.toLowerCase()}`,
      a.exclude.length ? `Suggest bonds for each peak, never ${a.exclude.join(", ")}` : "Suggest bonds for each peak from the library",
    ],
    run: async (a) => {
      const sid = a.source === "example" ? (await api.examples.open("ftir-plga")).session_ids[0] : a.sid;
      requestView<FtirPeaksRequest>("ftir", ftirRequest(a, sid));
      go("/ftir");
      return "Settings applied — picking and assigning peaks";
    },
  };
}
