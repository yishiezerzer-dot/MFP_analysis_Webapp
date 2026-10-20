import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Plus, X } from "lucide-react";
import {
  api,
  type PipelineAdduct,
  type PipelineEndGroup,
  type PipelineJobStatus,
  type PipelineMonomer,
  type PipelineResult,
  type PipelineSettingsInput,
} from "../../api";
import { BUILT_IN_POLYMER_MONOMERS } from "../../lcms/analysis";
import { useStoredState } from "../../hooks/useStoredState";
import { ICON_PROPS } from "../common/ChartCardParts";
import { Hint } from "../Hint";
import { Modal } from "./DialogControls";

const ADDUCTS: { id: PipelineAdduct; label: string; mode: "positive" | "negative" | "both" }[] = [
  { id: "H", label: "H (protonated / deprotonated)", mode: "both" },
  { id: "Na", label: "Na", mode: "positive" },
  { id: "K", label: "K", mode: "positive" },
  { id: "NH4", label: "NH₄", mode: "positive" },
  { id: "Cl", label: "Cl", mode: "negative" },
  { id: "HCOO", label: "Formate", mode: "negative" },
  { id: "Ac", label: "Acetate", mode: "negative" },
];

// Polarity, tolerance, adducts and rules carry over between runs; monomers are entered per sample.
export interface StoredSettings {
  polarity: "positive" | "negative";
  tolerance_da: number;
  adducts: PipelineAdduct[];
  elution: "decreasing" | "increasing" | "off";
  linear: boolean;
  cyclic: boolean;
  endGroups: PipelineEndGroup[];
  charges: "1" | "1,2";
  background: boolean;
  dimers: boolean;
  usualDelay: number; // the instrument's UV→MS delay (min), used when alignment is weak; NaN = none
}

export const STORED_DEFAULTS: StoredSettings = {
  polarity: "positive",
  tolerance_da: 0.5,
  adducts: ["H", "Na", "Cl"],
  elution: "increasing",
  linear: true,
  cyclic: false,
  endGroups: [],
  charges: "1",
  background: true,
  dimers: false,
  usualDelay: 0.115, // median of the 40 batch-2 runs
};

const validEndGroups = (groups: PipelineEndGroup[]) =>
  groups.filter((g) => g.name.trim() && Number.isFinite(g.mass)).map((g) => ({ name: g.name.trim(), mass: g.mass }));

export function buildPipelineSettings(stored: StoredSettings, monomers: PipelineMonomer[]): PipelineSettingsInput {
  return {
    monomers: validMonomers(monomers),
    polarity: stored.polarity,
    tolerance_da: stored.tolerance_da,
    adducts: stored.adducts,
    charges: stored.charges === "1,2" ? [1, 2] : [1],
    forms: { linear: stored.linear, cyclic: stored.cyclic, end_groups: validEndGroups(stored.endGroups) },
    background: { enabled: stored.background },
    dimers: stored.dimers,
    align: { fallback_offset_min: Number.isFinite(stored.usualDelay) ? stored.usualDelay : null },
    rules: { elution_direction: stored.elution },
  };
}

export interface OpenRun {
  sessionId: string;
  name: string;
  hasUv: boolean;
}

function FilePick(props: { label: string; accept: string; file: File | null; onPick: (f: File | null) => void; hint: string }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <Hint id={props.hint} className="w-full">
      <div className="flex flex-1 items-center gap-2">
        <input ref={ref} type="file" accept={props.accept} className="hidden" onChange={(e) => props.onPick(e.target.files?.[0] ?? null)} />
        <button type="button" className="btn-ghost border border-ink-200" onClick={() => ref.current?.click()}>
          {props.label}
        </button>
        <span className={clsx("truncate text-[13px]", props.file ? "text-ink-800" : "text-ink-500")}>{props.file?.name ?? "none chosen"}</span>
      </div>
    </Hint>
  );
}

export function validMonomers(monomers: PipelineMonomer[]): PipelineMonomer[] {
  return monomers.filter((m) => /^[A-Za-z]/.test(m.name.trim()) && Number.isFinite(m.mass) && m.mass > 0).map((m) => ({ name: m.name.trim(), mass: m.mass }));
}

export function PipelineDialog(props: {
  openRun: OpenRun | null;
  onDone: (jobId: string, result: PipelineResult) => void;
  onClose: () => void;
}) {
  const [stored, setStored] = useStoredState<StoredSettings>("mfp.lcms.pipeline.settings", STORED_DEFAULTS, (v) => ({ ...STORED_DEFAULTS, ...v }));
  const [source, setSource] = useState<"open" | "files">(props.openRun?.hasUv ? "open" : "files");
  const [mzml, setMzml] = useState<File | null>(null);
  const [uv, setUv] = useState<File | null>(null);
  const [monomers, setMonomers] = useState<PipelineMonomer[]>([{ name: "", mass: Number.NaN }]);
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<PipelineJobStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const usable = validMonomers(monomers);
  const anyForm = stored.linear || stored.cyclic || validEndGroups(stored.endGroups).length > 0;
  const problem =
    usable.length === 0
      ? "Add this sample's monomers (name and monoisotopic mass)."
      : !anyForm
        ? "Choose at least one chain form."
        : source === "files" && (!mzml || !uv)
        ? "Choose the mzML file and the UV CSV exported with it."
        : null;

  useEffect(() => {
    if (!jobId) return;
    let stop = false;
    const tick = async () => {
      try {
        const s = await api.lcmsPipeline.status(jobId);
        if (stop) return;
        setStatus(s);
        if (s.status === "done") {
          const result = await api.lcmsPipeline.result(jobId);
          if (!stop) props.onDone(jobId, result);
          return;
        }
        if (s.status === "failed" || s.status === "cancelled") return;
      } catch (err) {
        if (!stop) setError(String(err).replace(/^Error: (HTTP \d+: )?/, ""));
        return;
      }
      if (!stop) window.setTimeout(tick, 700);
    };
    void tick();
    return () => {
      stop = true;
    };
    // Poll once per job.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  const run = async () => {
    if (problem) return;
    const settings = buildPipelineSettings(stored, monomers);
    setStarting(true);
    setError(null);
    setStatus(null);
    try {
      const src = source === "open" && props.openRun ? { sessionId: props.openRun.sessionId } : { mzml: mzml as File, uv: uv as File };
      const { job_id } = await api.lcmsPipeline.start(settings, src);
      setJobId(job_id);
    } catch (err) {
      setError(String(err).replace(/^Error: (HTTP \d+: )?/, ""));
    } finally {
      setStarting(false);
    }
  };

  const running = status !== null && (status.status === "queued" || status.status === "running");
  const toggleAdduct = (id: PipelineAdduct) =>
    setStored({ ...stored, adducts: stored.adducts.includes(id) ? stored.adducts.filter((a) => a !== id) : [...stored.adducts, id] });

  return (
    <Modal
      title="Run the full LCMS pipeline"
      width="max-w-2xl"
      onClose={running ? () => undefined : props.onClose}
      footer={
        <>
          {running ? (
            <button type="button" className="btn-ghost border border-ink-200" onClick={() => jobId && void api.lcmsPipeline.cancel(jobId)}>
              Cancel run
            </button>
          ) : (
            <button type="button" className="btn-ghost" onClick={props.onClose}>
              Close
            </button>
          )}
          <Hint id="lcms.pipeline.run">
            <button type="button" className="btn-primary" disabled={Boolean(problem) || running || starting} onClick={() => void run()}>
              {running || starting ? "Running…" : "Run pipeline"}
            </button>
          </Hint>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <p className="text-[13px] text-ink-600">
          Aligns the UV trace to the MS, finds the UV peaks, sums each peak's spectrum and labels it from this
          sample's monomers. Every label is checked (S/N, mass error, EIC, adducts, series, elution order) and
          flagged rather than hidden, for you to review.
        </p>

        <section className="flex flex-col gap-2">
          <h3 className="label">Data</h3>
          {props.openRun && (
            <label className="flex items-center gap-2">
              <input type="radio" checked={source === "open"} disabled={!props.openRun.hasUv} onChange={() => setSource("open")} />
              The open run: {props.openRun.name}
              {!props.openRun.hasUv && <span className="text-caption">(attach its UV CSV first)</span>}
            </label>
          )}
          <label className="flex items-center gap-2">
            <input type="radio" checked={source === "files"} onChange={() => setSource("files")} />
            New files
          </label>
          {source === "files" && (
            <div className="ml-6 flex flex-col gap-2">
              <FilePick hint="lcms.pipeline.mzml" label="mzML file…" accept=".mzML,.mzml,.mzML.gz,.mzml.gz" file={mzml} onPick={setMzml} />
              <FilePick hint="lcms.pipeline.uv" label="UV CSV…" accept=".csv,.tsv,.txt" file={uv} onPick={setUv} />
            </div>
          )}
        </section>

        <Hint id="lcms.pipeline.monomers" className="w-full">
          <section className="flex flex-1 flex-col gap-2">
            <h3 className="label">This sample's monomers</h3>
            {monomers.map((m, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  className="input w-40"
                  aria-label={`Monomer ${i + 1} name`}
                  placeholder="e.g. Ser"
                  value={m.name}
                  onChange={(e) => setMonomers(monomers.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                />
                <input
                  className="input w-40"
                  type="number"
                  step="any"
                  aria-label={`Monomer ${i + 1} mass`}
                  placeholder="mass (Da)"
                  value={Number.isFinite(m.mass) ? m.mass : ""}
                  onChange={(e) => setMonomers(monomers.map((x, j) => (j === i ? { ...x, mass: e.target.valueAsNumber } : x)))}
                />
                {monomers.length > 1 && (
                  <button type="button" className="btn-ghost px-1.5" aria-label={`Remove monomer ${i + 1}`} onClick={() => setMonomers(monomers.filter((_, j) => j !== i))}>
                    <X {...ICON_PROPS} />
                  </button>
                )}
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-1.5">
              <button type="button" className="btn-ghost border border-ink-200 px-2 py-1 text-xs" onClick={() => setMonomers([...monomers, { name: "", mass: Number.NaN }])}>
                <Plus {...ICON_PROPS} />
                Add
              </button>
              <span className="text-caption">Quick add:</span>
              {BUILT_IN_POLYMER_MONOMERS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  title={`${p.name} ${p.mass}`}
                  className="rounded-full border border-ink-200 px-2 py-0.5 text-[12px] text-ink-700 hover:border-ink-300"
                  onClick={() => setMonomers([...monomers.filter((x) => x.name.trim() || Number.isFinite(x.mass)), { name: p.abbr, mass: p.mass }])}
                >
                  {p.abbr}
                </button>
              ))}
            </div>
          </section>
        </Hint>

        <section className="grid grid-cols-2 gap-4">
          <Hint id="lcms.pipeline.polarity" className="w-full">
            <div className="flex flex-1 flex-col gap-1">
              <span className="label">Polarity</span>
              <div className="flex gap-4">
                {(["positive", "negative"] as const).map((p) => (
                  <label key={p} className="flex items-center gap-2">
                    <input type="radio" checked={stored.polarity === p} onChange={() => setStored({ ...stored, polarity: p })} />
                    {p === "positive" ? "ESI+" : "ESI−"}
                  </label>
                ))}
              </div>
            </div>
          </Hint>
          <Hint id="lcms.pipeline.tolerance" className="w-full">
            <label className="flex flex-1 flex-col gap-1">
              <span className="label">m/z tolerance (Da)</span>
              <input
                className="input w-32"
                type="number"
                min={0.01}
                max={5}
                step={0.05}
                value={stored.tolerance_da}
                onChange={(e) => Number.isFinite(e.target.valueAsNumber) && setStored({ ...stored, tolerance_da: e.target.valueAsNumber })}
              />
            </label>
          </Hint>
        </section>

        <Hint id="lcms.pipeline.adducts" className="w-full">
          <section className="flex flex-1 flex-col gap-1.5">
            <span className="label">Ions to look for</span>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {ADDUCTS.map((a) => {
                const applies = a.mode === "both" || a.mode === stored.polarity;
                return (
                  <label key={a.id} className={clsx("flex items-center gap-1.5", !applies && "text-ink-400")}>
                    <input
                      type="checkbox"
                      checked={a.id === "H" || stored.adducts.includes(a.id)}
                      disabled={a.id === "H"}
                      onChange={() => toggleAdduct(a.id)}
                    />
                    {a.label}
                    {!applies && <span className="text-[11px]">({a.mode === "positive" ? "ESI+" : "ESI−"} only)</span>}
                  </label>
                );
              })}
            </div>
          </section>
        </Hint>

        <Hint id="lcms.pipeline.forms" className="w-full">
          <section className="flex flex-1 flex-col gap-1.5">
            <span className="label">Chain forms</span>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={stored.linear} onChange={(e) => setStored({ ...stored, linear: e.target.checked })} />
                Linear
              </label>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={stored.cyclic} onChange={(e) => setStored({ ...stored, cyclic: e.target.checked })} />
                Cyclic (one more H₂O lost)
              </label>
              <button
                type="button"
                className="btn-ghost border border-ink-200 px-2 py-0.5 text-xs"
                disabled={stored.endGroups.length >= 4}
                onClick={() => setStored({ ...stored, endGroups: [...stored.endGroups, { name: "", mass: Number.NaN }] })}
              >
                <Plus {...ICON_PROPS} />
                End group
              </button>
            </div>
            {stored.endGroups.map((g, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  className="input w-40"
                  aria-label={`End group ${i + 1} name`}
                  placeholder="e.g. Me ester"
                  value={g.name}
                  onChange={(e) => setStored({ ...stored, endGroups: stored.endGroups.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })}
                />
                <input
                  className="input w-44"
                  type="number"
                  step="any"
                  aria-label={`End group ${i + 1} mass`}
                  placeholder="Δ mass (Da), e.g. 14.0157"
                  value={Number.isFinite(g.mass) ? g.mass : ""}
                  onChange={(e) => setStored({ ...stored, endGroups: stored.endGroups.map((x, j) => (j === i ? { ...x, mass: e.target.valueAsNumber } : x)) })}
                />
                <button
                  type="button"
                  className="btn-ghost px-1.5"
                  aria-label={`Remove end group ${i + 1}`}
                  onClick={() => setStored({ ...stored, endGroups: stored.endGroups.filter((_, j) => j !== i) })}
                >
                  <X {...ICON_PROPS} />
                </button>
              </div>
            ))}
          </section>
        </Hint>

        <section className="grid grid-cols-2 gap-4">
          <Hint id="lcms.pipeline.charges" className="w-full">
            <label className="flex flex-1 flex-col gap-1">
              <span className="label">Charge states</span>
              <select className="input w-40" value={stored.charges} onChange={(e) => setStored({ ...stored, charges: e.target.value as StoredSettings["charges"] })}>
                <option value="1">1 only</option>
                <option value="1,2">1 and 2</option>
              </select>
            </label>
          </Hint>
          <Hint id="lcms.pipeline.background" className="w-full">
            <label className="flex flex-1 items-center gap-2 self-end">
              <input type="checkbox" checked={stored.background} onChange={(e) => setStored({ ...stored, background: e.target.checked })} />
              Subtract background (MS just before and after each peak)
            </label>
          </Hint>
          <Hint id="lcms.pipeline.dimers" className="w-full">
            <label className="flex flex-1 items-center gap-2">
              <input type="checkbox" checked={stored.dimers} onChange={(e) => setStored({ ...stored, dimers: e.target.checked })} />
              Noncovalent dimers ([2M+H]⁺ and mixed [A+B+H]⁺)
            </label>
          </Hint>
        </section>

        <Hint id="lcms.pipeline.elution" className="w-full">
          <label className="flex flex-1 items-center gap-2">
            <span className="label">As DP rises, a series elutes</span>
            <select className="input w-56" value={stored.elution} onChange={(e) => setStored({ ...stored, elution: e.target.value as StoredSettings["elution"] })}>
              <option value="decreasing">earlier (lower RT)</option>
              <option value="increasing">later (higher RT)</option>
              <option value="off">don't check</option>
            </select>
          </label>
        </Hint>

        <Hint id="lcms.pipeline.usualDelay" className="w-full">
          <label className="flex flex-1 items-center gap-2">
            <span className="label">Usual UV→MS delay (min)</span>
            <input
              className="input w-28"
              type="number"
              step="0.001"
              aria-label="Usual UV to MS delay"
              placeholder="none"
              value={Number.isFinite(stored.usualDelay) ? stored.usualDelay : ""}
              onChange={(e) => setStored({ ...stored, usualDelay: e.target.valueAsNumber })}
            />
            <span className="text-[12px] text-ink-500">used when the automatic alignment is unsure</span>
          </label>
        </Hint>

        {problem && !jobId && <p className="text-[12px] text-ink-500">{problem}</p>}
        {error && <p className="text-[12px] text-danger-fg">{error}</p>}
        {status && (
          <section className="flex flex-col gap-1.5" aria-live="polite">
            <div className="flex justify-between text-[12px] text-ink-600">
              <span>{status.step}</span>
              <span>{Math.round(status.progress * 100)}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-ink-100" role="progressbar" aria-valuenow={Math.round(status.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full rounded-full bg-brand-500 transition-[width]" style={{ width: `${Math.round(status.progress * 100)}%` }} />
            </div>
            {status.status === "failed" && <p className="text-[12px] text-danger-fg">{status.error}</p>}
            {status.status === "cancelled" && <p className="text-[12px] text-ink-600">Cancelled.</p>}
            {status.messages.length > 0 && (
              <ul className="max-h-24 overflow-auto text-[12px] text-ink-500">
                {status.messages.slice(-6).map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </Modal>
  );
}
