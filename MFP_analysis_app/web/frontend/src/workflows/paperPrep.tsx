import { useEffect, useState } from "react";
import { api, type ExperimentBundle } from "../api";
import type { Workflow } from "../components/workflow/WorkflowDialog";
import { exportShownFigures, shownFigureCount } from "../components/PaperFigureExportToolbar";
import { downloadBlob } from "../lcms/viewShared";
import {
  DEFAULT_PUBLICATION_LEGEND_FONT_SIZE,
  PUBLICATION_WIDTH_PRESETS,
  sanitizeFilenamePart,
  type PublicationExportSettings,
} from "../utils/publicationPlotExport";

export interface PaperAnswers {
  figures: boolean;
  si: boolean;
  raw: boolean;
  tag: string;
  sizeId: string;
  dpi: number;
}

export const PAPER_DEFAULTS: PaperAnswers = {
  figures: true,
  si: true,
  raw: false,
  tag: "",
  sizeId: "acs-single",
  dpi: 600,
};

export function paperSettings(a: PaperAnswers): PublicationExportSettings {
  const preset = PUBLICATION_WIDTH_PRESETS.find((p) => p.id === a.sizeId) ?? PUBLICATION_WIDTH_PRESETS[0];
  return {
    widthMm: preset.widthMm,
    heightMm: preset.heightMm,
    dpi: a.dpi,
    legendFontSize: preset.defaultLegendFontSize ?? DEFAULT_PUBLICATION_LEGEND_FONT_SIZE,
  };
}

const MODULE_NAMES: Record<keyof ExperimentBundle["counts"], [string, string]> = {
  lcms: ["LC-MS run", "LC-MS runs"],
  ftir: ["FTIR spectrum", "FTIR spectra"],
  plate_reader: ["plate", "plates"],
};

export function bundleText(bundle: ExperimentBundle): string {
  const parts = (Object.keys(MODULE_NAMES) as (keyof ExperimentBundle["counts"])[])
    .filter((m) => bundle.counts[m] > 0)
    .map((m) => `${bundle.counts[m]} ${MODULE_NAMES[m][bundle.counts[m] === 1 ? 0 : 1]}`);
  return parts.length ? parts.join(", ") : "no files";
}

function TagPick({ value, onPick }: { value: string; onPick: (tag: string) => void }) {
  const [tags, setTags] = useState<string[] | null>(null);
  const [bundle, setBundle] = useState<ExperimentBundle | null>(null);
  useEffect(() => {
    api.experiments.listTags().then(setTags).catch(() => setTags([]));
  }, []);
  useEffect(() => {
    setBundle(null);
    if (!value) return;
    api.experiments.getBundle(value).then(setBundle).catch(() => setBundle(null));
  }, [value]);
  if (tags === null) return <p className="text-caption">Loading experiments…</p>;
  if (tags.length === 0) {
    return (
      <p className="rounded-md bg-ink-50 px-3 py-2 text-[13px] text-ink-700">
        No experiment is tagged yet. Close this guide, open each file of the study and type the same name in its{" "}
        <strong>Experiment tag</strong> box (next to the file name), then start again.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <select className="input" aria-label="Experiment" value={value} onChange={(e) => onPick(e.target.value)}>
        <option value="">Choose an experiment…</option>
        {tags.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
      {bundle && <p className="text-caption">Contains {bundleText(bundle)}.</p>}
    </div>
  );
}

const field = "flex flex-col gap-1";

export function paperPrepWorkflow(): Workflow<PaperAnswers> {
  return {
    id: "paper-prep",
    title: "Prepare figures and SI for a paper",
    defaults: PAPER_DEFAULTS,
    transient: ["tag"],
    steps: [
      {
        id: "what",
        question: "What do you need?",
        explain:
          "Figures are the charts on this page, each saved as SVG (for editing in Illustrator or Inkscape) and PNG at the journal's size. The SI package is a ZIP with Excel tables of the results recorded for an experiment and methods text written from the settings used; raw data files can be added.",
        render: (a, set) => {
          const shown = shownFigureCount();
          return (
            <div className="flex flex-col gap-3">
              <label className="flex items-start gap-2">
                <input type="checkbox" className="mt-1" checked={a.figures && shown > 0} disabled={shown === 0} onChange={(e) => set({ figures: e.target.checked })} />
                <span>
                  Figures: the {shown} chart{shown === 1 ? "" : "s"} on this page
                  {shown === 0 && (
                    <span className="text-caption block">Open the tab with the charts you want, set them up, then start this guide there.</span>
                  )}
                </span>
              </label>
              <label className="flex items-start gap-2">
                <input type="checkbox" className="mt-1" checked={a.si} onChange={(e) => set({ si: e.target.checked })} />
                The SI package for an experiment (tables and methods text)
              </label>
              {a.si && (
                <label className="ml-6 flex items-center gap-2">
                  <input type="checkbox" checked={a.raw} onChange={(e) => set({ raw: e.target.checked })} />
                  Include the raw data files
                </label>
              )}
            </div>
          );
        },
        check: (a) => ((a.figures && shownFigureCount() > 0) || a.si ? null : "Choose figures, the SI package or both."),
      },
      {
        id: "experiment",
        question: "Which experiment is the paper about?",
        explain:
          "An experiment tag groups the files of one study across tabs (LC-MS runs, FTIR spectra, plates). The SI package holds the results recorded for every file with that tag.",
        skip: (a) => !a.si,
        render: (a, set) => <TagPick value={a.tag} onPick={(tag) => set({ tag })} />,
        check: (a) => (a.tag ? null : "Choose the experiment."),
      },
      {
        id: "size",
        question: "Which journal format?",
        explain:
          "Single-column figures are about 8.5 cm wide, double-column about 18 cm. Check the journal's author guidelines; ACS, RSC and Nature sizes are listed. 600 dpi suits most journals for PNG; SVG is vector and has no dpi.",
        skip: (a) => !a.figures || shownFigureCount() === 0,
        render: (a, set) => (
          <div className="grid grid-cols-[1fr_auto] gap-3">
            <label className={field}>
              <span className="label">Figure size</span>
              <select className="input" value={a.sizeId} onChange={(e) => set({ sizeId: e.target.value })}>
                {PUBLICATION_WIDTH_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <label className={field}>
              <span className="label">PNG resolution</span>
              <select className="input" value={a.dpi} onChange={(e) => set({ dpi: Number(e.target.value) })}>
                {[300, 600, 1200].map((d) => (
                  <option key={d} value={d}>
                    {d} dpi
                  </option>
                ))}
              </select>
            </label>
          </div>
        ),
      },
    ],
    summary: (a) => {
      const lines: string[] = [];
      const shown = shownFigureCount();
      if (a.figures && shown > 0) {
        const s = paperSettings(a);
        lines.push(`Save the ${shown} chart${shown === 1 ? "" : "s"} on this page as SVG and PNG, ${s.widthMm} × ${s.heightMm} mm at ${a.dpi} dpi`);
        lines.push("Keep that size in those charts' Export menus");
      }
      if (a.si) lines.push(`Download the SI package for "${a.tag}"${a.raw ? " with the raw data files" : ""}`);
      lines.push("Your browser may ask once whether this page may download several files");
      return lines;
    },
    run: async (a) => {
      const done: string[] = [];
      const shown = shownFigureCount();
      if (a.figures && shown > 0) {
        exportShownFigures(paperSettings(a), ["svg", "png"]);
        done.push(`${shown} chart${shown === 1 ? "" : "s"}`);
      }
      if (a.si) {
        const blob = await api.publication.downloadSIPackage({ experiment_tag: a.tag, include_raw_files: a.raw });
        downloadBlob(blob, `${sanitizeFilenamePart(a.tag, "SI")}_SI_Package.zip`);
        done.push("the SI package");
      }
      return `Saved ${done.join(" and ")}`;
    },
  };
}
