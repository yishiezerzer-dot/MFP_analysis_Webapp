import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import clsx from "clsx";
import type { PlotlyHTMLElement } from "plotly.js";
import { Check, Info, Palette, TriangleAlert } from "lucide-react";
import { ChartCardTitle, ICON_PROPS, ToolbarButton } from "../common/ChartCardParts";
import { PaperFigureExportToolbar } from "../PaperFigureExportToolbar";
import { Hint } from "../Hint";
import {
  exportPlotlyPublicationImage,
  publicationFilenameSuffix,
  sanitizeFilenamePart,
  type PublicationExportFormat,
  type PublicationExportSettings,
} from "../../utils/publicationPlotExport";
import { checkSummary, type PlateExplanation } from "../../utils/plateExplanations";

export interface ChartDesign {
  title: string;
  xLabel: string;
  yLabel: string;
}

function ExplanationPanel({ explanation: e }: { explanation: PlateExplanation }) {
  return (
    <div className="mt-2 flex flex-col gap-3 rounded-md border border-ink-200 bg-ink-50 p-3 text-[12px] leading-5 text-ink-700">
      <div className="text-card-title">{e.title}: how it's calculated</div>
      <section>
        <h4 className="text-section mb-1">What it shows</h4>
        <p>{e.what}</p>
      </section>
      <section>
        <h4 className="text-section mb-1">Calculation (this plate)</h4>
        <ol className="list-decimal pl-5">
          {e.steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
        {e.notes.map((n, i) => (
          <p key={i} className="mt-1 text-ink-600">
            {n}
          </p>
        ))}
      </section>
      {e.checks.length > 0 && (
        <section>
          <h4 className="text-section mb-1">Checks on this plate</h4>
          <ul className="flex flex-col gap-1">
            {e.checks.map((c, i) => (
              <li key={i} className="flex gap-2">
                {c.level === "ok" && <Check {...ICON_PROPS} className="mt-0.5 shrink-0 text-success-fg" />}
                {c.level === "warn" && <TriangleAlert {...ICON_PROPS} className="mt-0.5 shrink-0 text-warning-fg" />}
                {c.level === "info" && <Info {...ICON_PROPS} className="mt-0.5 shrink-0 text-ink-500" />}
                <span className={clsx(c.level === "warn" && "text-warning-fg")}>{c.message}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section>
        <h4 className="text-section mb-1">Reproduce it yourself</h4>
        <p>{e.reproduce}</p>
      </section>
    </div>
  );
}

function DesignPopover({
  design,
  onChange,
  onClose,
}: {
  design: ChartDesign;
  onChange: (d: ChartDesign) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [onClose]);
  const field = (key: keyof ChartDesign, label: string) => (
    <label className="flex flex-col gap-1">
      <span className="label">{label}</span>
      <input className="input" value={design[key]} onChange={(e) => onChange({ ...design, [key]: e.target.value })} />
    </label>
  );
  return (
    <div ref={ref} className="card-raised absolute right-0 top-full z-40 mt-1 flex w-72 flex-col gap-2 p-3">
      {field("title", "Title (optional)")}
      {field("xLabel", "X axis")}
      {field("yLabel", "Y axis")}
    </div>
  );
}

export function ResultCard({
  title,
  status,
  explanation,
  design,
  onDesignChange,
  plotRef,
  exportName,
  plotSize,
  actions,
  className,
  children,
}: {
  title: string;
  status: Array<string | false | null | undefined>;
  explanation: PlateExplanation;
  design?: ChartDesign;
  onDesignChange?: (d: ChartDesign) => void;
  plotRef?: RefObject<PlotlyHTMLElement | null>;
  exportName?: string;
  plotSize?: { width: number; height: number };
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const [explainOpen, setExplainOpen] = useState(false);
  const [designOpen, setDesignOpen] = useState(false);

  const onExport = (format: PublicationExportFormat, settings: PublicationExportSettings) => {
    if (!plotRef?.current) return;
    const base = sanitizeFilenamePart(exportName ?? title, "plate");
    void exportPlotlyPublicationImage(
      plotRef.current,
      { format, filename: `${base}_${publicationFilenameSuffix(settings, format)}`, ...settings },
      settings.isCurrentView
        ? undefined
        : { layoutOverrides: { font: { family: "Arial, Helvetica, sans-serif", size: 9, color: "#111827" } } },
    );
  };

  return (
    <div className={clsx("card flex min-w-0 flex-col p-3", className)}>
      <div className="flex flex-wrap items-center gap-x-1 gap-y-1 px-1 pb-1.5">
        <div className="min-w-0 flex-1">
          <ChartCardTitle title={title} status={status} />
        </div>
        <Hint id="plate.explain">
          <ToolbarButton
            icon={Info}
            label="How is this calculated?"
            active={explainOpen}
            onClick={() => setExplainOpen((v) => !v)}
          />
        </Hint>
        {design && onDesignChange && (
          <div className="relative">
            <Hint id="plate.design">
              <ToolbarButton icon={Palette} label="Design" active={designOpen} onClick={() => setDesignOpen((v) => !v)} />
            </Hint>
            {designOpen && (
              <DesignPopover design={design} onChange={onDesignChange} onClose={() => setDesignOpen(false)} />
            )}
          </div>
        )}
        {actions}
        {plotRef && (
          <PaperFigureExportToolbar
            storageKey={`mfp-publication-plot-export-plate-${sanitizeFilenamePart(title, "chart")}`}
            currentSizePx={plotSize}
            onExport={onExport}
          />
        )}
      </div>
      {children}
      <div className={clsx("text-caption px-1 pt-1.5", explanation.checks.some((c) => c.level === "warn") && "text-warning-fg")}>
        {checkSummary(explanation.checks)}
      </div>
      {explainOpen && <ExplanationPanel explanation={explanation} />}
    </div>
  );
}
