import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import clsx from "clsx";
import {
  api,
  ExperimentBundle,
  FigurePanelSpec,
  FigureRenderRequest,
  LinkedSessionItem,
} from "../api";
import { PageHeaderContent, usePageHeader } from "../layout/PageHeader";
import { AlertBanner } from "../components/AlertBanner";
import { Tooltip } from "../components/Tooltip";

type JournalKey =
  | "nature_double"
  | "nature_single"
  | "acs_double"
  | "acs_single"
  | "rsc_double"
  | "rsc_single"
  | "custom";

interface JournalPresetDef {
  name: string;
  journal: string;
  width_mm: number;
  height_mm: number;
  columns: number;
  description: string;
}

const PRESETS: Record<JournalKey, JournalPresetDef> = {
  nature_double: {
    name: "Nature (Double Column)",
    journal: "Nature Portfolio",
    width_mm: 180,
    height_mm: 110,
    columns: 2,
    description: "180 mm wide, standard 2-column layout for Nat. Chem. / Nat. Commun.",
  },
  nature_single: {
    name: "Nature (Single Column)",
    journal: "Nature Portfolio",
    width_mm: 89,
    height_mm: 70,
    columns: 1,
    description: "89 mm wide, single-column portrait layout.",
  },
  acs_double: {
    name: "ACS (Double Column)",
    journal: "American Chemical Society",
    width_mm: 177.8,
    height_mm: 100,
    columns: 2,
    description: "7.00 in (177.8 mm) double-column for JACS, Macromolecules.",
  },
  acs_single: {
    name: "ACS (Single Column)",
    journal: "American Chemical Society",
    width_mm: 82.5,
    height_mm: 60,
    columns: 1,
    description: "3.25 in (82.5 mm) single-column for ACS journals.",
  },
  rsc_double: {
    name: "RSC (Double Column)",
    journal: "Royal Society of Chemistry",
    width_mm: 171,
    height_mm: 100,
    columns: 2,
    description: "171 mm wide double-column for Chem. Sci., Soft Matter.",
  },
  rsc_single: {
    name: "RSC (Single Column)",
    journal: "Royal Society of Chemistry",
    width_mm: 83,
    height_mm: 60,
    columns: 1,
    description: "83 mm wide single-column for RSC publications.",
  },
  custom: {
    name: "Custom Dimensions",
    journal: "Custom",
    width_mm: 180,
    height_mm: 120,
    columns: 2,
    description: "User-defined dimensions and column count.",
  },
};

export function FigureBuilderView() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialExp = searchParams.get("experiment") || "";

  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [selectedTag, setSelectedTag] = useState<string>(initialExp);
  const [bundle, setBundle] = useState<ExperimentBundle | null>(null);

  const [presetKey, setPresetKey] = useState<JournalKey>("nature_double");
  const [customWidth, setCustomWidth] = useState<number>(180);
  const [customHeight, setCustomHeight] = useState<number>(120);
  const [customCols, setCustomCols] = useState<number>(2);

  const [panels, setPanels] = useState<FigurePanelSpec[]>([
    { panel_label: "a", title: "LC-MS Chromatogram (TIC/UV)", source_module: "lcms" },
    { panel_label: "b", title: "MS1 Isotopic Scan Envelope", source_module: "lcms" },
    { panel_label: "c", title: "FTIR Spectrum & 2nd Derivative", source_module: "ftir" },
    { panel_label: "d", title: "Plate Reader 4PL Sigmoidal Fit", source_module: "plate_reader" },
  ]);

  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [isDownloadingSI, setIsDownloadingSI] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load available experiment tags
  useEffect(() => {
    let cancelled = false;
    void api.experiments.listTags().then((tags) => {
      if (!cancelled) setAvailableTags(tags);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Load bundle if selectedTag is present
  useEffect(() => {
    if (!selectedTag) {
      setBundle(null);
      return;
    }
    let cancelled = false;
    void api.experiments.getBundle(selectedTag).then((b) => {
      if (!cancelled) {
        setBundle(b);
        // Automatically populate panel titles from linked sessions if available
        if (b.sessions.length > 0) {
          const newPanels: FigurePanelSpec[] = b.sessions.slice(0, 4).map((s, idx) => ({
            panel_label: String.fromCharCode(97 + idx),
            title: `${s.display_name} (${s.module.toUpperCase()})`,
            source_module: s.module,
          }));
          if (newPanels.length > 0) setPanels(newPanels);
        }
      }
    });
    return () => {
      cancelled = true;
    };
  }, [selectedTag]);

  const activePreset = PRESETS[presetKey];
  const widthMm = presetKey === "custom" ? customWidth : activePreset.width_mm;
  const heightMm = presetKey === "custom" ? customHeight : activePreset.height_mm;
  const columns = presetKey === "custom" ? customCols : activePreset.columns;

  const handleAddPanel = () => {
    if (panels.length >= 8) return;
    const nextLabel = String.fromCharCode(97 + panels.length);
    setPanels((prev) => [
      ...prev,
      {
        panel_label: nextLabel,
        title: `Panel ${nextLabel.toUpperCase()}`,
        source_module: "data_studio",
      },
    ]);
  };

  const handleRemovePanel = (idx: number) => {
    setPanels((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleUpdatePanel = (idx: number, patch: Partial<FigurePanelSpec>) => {
    setPanels((prev) =>
      prev.map((p, i) => (i === idx ? { ...p, ...patch } : p)),
    );
  };

  const handleExportPdf = async () => {
    setIsExportingPdf(true);
    setError(null);
    try {
      const req: FigureRenderRequest = {
        title: `${selectedTag || "Figure"} - ${activePreset.name}`,
        journal_preset: presetKey,
        width_mm: widthMm,
        height_mm: heightMm,
        layout_columns: columns,
        font_family: "Helvetica",
        panels,
      };
      const blob = await api.publication.renderFigurePdf(req);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(selectedTag || "Figure").replace(/\s+/g, "_")}_${presetKey}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setMessage("Vector PDF generated and downloaded successfully!");
    } catch (err: any) {
      setError(`Failed to generate PDF: ${err.message || String(err)}`);
    } finally {
      setIsExportingPdf(false);
    }
  };

  const handleDownloadSI = async () => {
    setIsDownloadingSI(true);
    setError(null);
    try {
      const blob = await api.publication.downloadSIPackage({
        experiment_tag: selectedTag || undefined,
        figures: panels,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(selectedTag || "Analytical").replace(/\s+/g, "_")}_SI_Package.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setMessage("Supplementary Information package (.zip) compiled successfully!");
    } catch (err: any) {
      setError(`Failed to build SI package: ${err.message || String(err)}`);
    } finally {
      setIsDownloadingSI(false);
    }
  };

  // Header configuration
  usePageHeader(
    <PageHeaderContent
      title="Figure Engine & SI Package Builder"
      subtitle={`${widthMm} × ${heightMm} mm (${columns} col) · ${panels.length} panels`}
      actions={
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn-ghost text-xs"
            onClick={handleAddPanel}
            disabled={panels.length >= 8}
          >
            + Add Panel
          </button>
          <button
            type="button"
            className="btn-ghost text-xs font-medium"
            onClick={() => void handleExportPdf()}
            disabled={isExportingPdf}
          >
            {isExportingPdf ? "Compiling PDF…" : "Export Vector PDF 📄"}
          </button>
          <button
            type="button"
            className="btn-primary text-xs font-semibold"
            onClick={() => void handleDownloadSI()}
            disabled={isDownloadingSI}
          >
            {isDownloadingSI ? "Generating SI…" : "Download SI Package (.zip) 📦"}
          </button>
        </div>
      }
    />,
  );

  return (
    <div className="flex h-full flex-col overflow-auto p-6 space-y-6">
      {error && (
        <AlertBanner kind="error" message={error} onDismiss={() => setError(null)} />
      )}
      {message && (
        <AlertBanner kind="info" message={message} onDismiss={() => setMessage(null)} />
      )}

      {/* Control Configuration Bar */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Card 1: Experiment Source */}
        <div className="card p-4 space-y-3">
          <div className="label font-bold text-xs uppercase tracking-wider text-ink-500">
            1. Experiment Dataset
          </div>
          <div>
            <label className="text-xs font-medium text-ink-700 dark:text-ink-300">
              Select Tagged Experiment
            </label>
            <div className="mt-1 flex gap-2">
              <select
                className="input flex-1 text-xs"
                value={selectedTag}
                onChange={(e) => {
                  const val = e.target.value;
                  setSelectedTag(val);
                  setSearchParams(val ? { experiment: val } : {});
                }}
              >
                <option value="">-- Choose Experiment or All Sessions --</option>
                {availableTags.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {bundle && (
            <div className="rounded bg-brand-50/50 p-2 text-xs dark:bg-brand-950/20 border border-brand-200/50 dark:border-brand-800/50">
              <div className="font-semibold text-brand-900 dark:text-brand-200">
                Linked Sessions: {bundle.sessions.length}
              </div>
              <div className="text-ink-600 dark:text-ink-400 mt-0.5 space-x-2">
                <span>LCMS: {bundle.counts.lcms}</span>
                <span>FTIR: {bundle.counts.ftir}</span>
                <span>Plate: {bundle.counts.plate_reader}</span>
                <span>Studio: {bundle.counts.data_studio}</span>
              </div>
            </div>
          )}
        </div>

        {/* Card 2: Journal Preset */}
        <div className="card p-4 space-y-3">
          <div className="label font-bold text-xs uppercase tracking-wider text-ink-500">
            2. Journal Format Preset
          </div>
          <div>
            <label className="text-xs font-medium text-ink-700 dark:text-ink-300">
              Target Publication Standard
            </label>
            <select
              className="input mt-1 w-full text-xs"
              value={presetKey}
              onChange={(e) => setPresetKey(e.target.value as JournalKey)}
            >
              {Object.entries(PRESETS).map(([key, def]) => (
                <option key={key} value={key}>
                  {def.name}
                </option>
              ))}
            </select>
          </div>
          <p className="text-[11px] text-ink-500 leading-tight">
            {activePreset.description}
          </p>

          {presetKey === "custom" && (
            <div className="grid grid-cols-3 gap-2 pt-1 border-t border-ink-100 dark:border-ink-800">
              <div>
                <span className="text-[10px] text-ink-400">Width (mm)</span>
                <input
                  type="number"
                  className="input text-xs"
                  value={customWidth}
                  onChange={(e) => setCustomWidth(Number(e.target.value))}
                />
              </div>
              <div>
                <span className="text-[10px] text-ink-400">Height (mm)</span>
                <input
                  type="number"
                  className="input text-xs"
                  value={customHeight}
                  onChange={(e) => setCustomHeight(Number(e.target.value))}
                />
              </div>
              <div>
                <span className="text-[10px] text-ink-400">Cols</span>
                <input
                  type="number"
                  min={1}
                  max={4}
                  className="input text-xs"
                  value={customCols}
                  onChange={(e) => setCustomCols(Number(e.target.value))}
                />
              </div>
            </div>
          )}
        </div>

        {/* Card 3: Export Actions */}
        <div className="card p-4 space-y-3 flex flex-col justify-between">
          <div>
            <div className="label font-bold text-xs uppercase tracking-wider text-ink-500">
              3. Publication Package Output
            </div>
            <p className="text-xs text-ink-600 dark:text-ink-400 mt-1">
              Produce peer-review figures satisfying strict publisher requirements (vector PDF with embedded fonts, 600 DPI, plus complete audit methodology).
            </p>
          </div>
          <div className="flex flex-col gap-2 pt-2">
            <button
              type="button"
              onClick={() => void handleExportPdf()}
              disabled={isExportingPdf}
              className="btn-primary flex items-center justify-center gap-2 text-xs py-2 font-semibold"
            >
              <span>{isExportingPdf ? "Compiling Vector PDF…" : "Export Vector PDF"}</span>
              <span className="text-[10px] opacity-80">(Helvetica / 1 pt spines)</span>
            </button>
            <button
              type="button"
              onClick={() => void handleDownloadSI()}
              disabled={isDownloadingSI}
              className="btn-ghost border border-ink-300 dark:border-ink-700 flex items-center justify-center gap-2 text-xs py-1.5 font-medium"
            >
              <span>{isDownloadingSI ? "Building Package…" : "Download SI Package (.zip)"}</span>
              <span className="text-[10px] text-ink-400">Tables + Methods</span>
            </button>
          </div>
        </div>
      </div>

      {/* Main Multi-Panel Interactive Layout Canvas */}
      <div className="card p-5 space-y-4">
        <div className="flex items-center justify-between border-b border-ink-100 pb-3 dark:border-ink-800">
          <div>
            <h2 className="text-sm font-bold text-ink-900 dark:text-ink-100">
              Multi-Panel Figure Canvas Preview
            </h2>
            <p className="text-xs text-ink-500">
              Exact dimensions: {widthMm} mm wide × {heightMm} mm tall ({columns} columns)
            </p>
          </div>
          <div className="text-xs text-ink-500">
            {panels.length} panel{panels.length === 1 ? "" : "s"} assembled
          </div>
        </div>

        {/* Canvas Visualizer */}
        <div className="flex justify-center bg-ink-100/60 p-6 rounded-xl dark:bg-ink-950/40 overflow-auto border border-ink-200 dark:border-ink-800">
          <div
            className="bg-white shadow-2xl rounded-sm p-4 relative transition-all dark:bg-ink-900 border border-ink-300 dark:border-ink-700"
            style={{
              width: `${Math.min(widthMm * 3.78, 880)}px`,
              minHeight: `${Math.min(heightMm * 3.78, 600)}px`,
            }}
          >
            {/* Title Header */}
            <div className="text-center pb-2 mb-3 border-b border-ink-100 dark:border-ink-800">
              <span className="text-xs font-semibold text-ink-800 dark:text-ink-200">
                Figure 1. {selectedTag || "Comprehensive Analytical Characterization"}
              </span>
            </div>

            {/* Grid of Panels */}
            <div
              className="grid gap-3"
              style={{
                gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
              }}
            >
              {panels.map((panel, idx) => (
                <div
                  key={idx}
                  className="relative group rounded border border-ink-300/80 bg-ink-50/50 p-3 min-h-[140px] flex flex-col justify-between dark:border-ink-700 dark:bg-ink-800/40"
                >
                  {/* Panel Label Tag e.g. "a", "b" */}
                  <div className="flex items-start justify-between">
                    <span className="inline-flex h-6 w-6 items-center justify-center rounded bg-ink-900 text-white font-bold text-xs shadow-sm dark:bg-ink-100 dark:text-ink-900">
                      {panel.panel_label}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleRemovePanel(idx)}
                      className="opacity-0 group-hover:opacity-100 text-ink-400 hover:text-red-500 text-xs transition-opacity"
                      title="Remove panel"
                    >
                      ✕
                    </button>
                  </div>

                  {/* Panel Graphic Content / Placeholder */}
                  <div className="my-2 flex flex-col items-center justify-center text-center py-4">
                    <span className="text-2xl mb-1">
                      {panel.source_module === "lcms"
                        ? "🔬"
                        : panel.source_module === "ftir"
                        ? "〰️"
                        : panel.source_module === "plate_reader"
                        ? "🧫"
                        : "📊"}
                    </span>
                    <span className="text-xs font-medium text-ink-800 dark:text-ink-200 max-w-[200px] truncate">
                      {panel.title}
                    </span>
                    <span className="text-[10px] text-ink-400 font-mono mt-0.5">
                      [{panel.source_module?.toUpperCase() || "DATA"}]
                    </span>
                  </div>

                  {/* Scientific Axis Spines Border Graphic */}
                  <div className="border-t border-l border-ink-400/60 pt-1 pl-1 text-[9px] text-ink-400 flex justify-between">
                    <span>min / cm⁻¹</span>
                    <span>Intensity / %</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Panel Configuration Editor Table */}
        <div className="space-y-2 pt-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-ink-500">
            Panel Labels & Captions
          </h3>
          <div className="space-y-2">
            {panels.map((panel, idx) => (
              <div
                key={idx}
                className="flex items-center gap-3 rounded-lg border border-ink-200 bg-surface p-2 text-xs dark:border-ink-800"
              >
                <div className="w-16">
                  <label className="text-[10px] text-ink-400 font-medium">Label</label>
                  <input
                    type="text"
                    className="input font-bold text-center uppercase"
                    value={panel.panel_label}
                    maxLength={2}
                    onChange={(e) => handleUpdatePanel(idx, { panel_label: e.target.value })}
                  />
                </div>
                <div className="flex-1">
                  <label className="text-[10px] text-ink-400 font-medium">Panel Title</label>
                  <input
                    type="text"
                    className="input w-full font-medium"
                    value={panel.title || ""}
                    onChange={(e) => handleUpdatePanel(idx, { title: e.target.value })}
                  />
                </div>
                <div className="w-36">
                  <label className="text-[10px] text-ink-400 font-medium">Instrument</label>
                  <select
                    className="input w-full text-xs"
                    value={panel.source_module || "data_studio"}
                    onChange={(e) => handleUpdatePanel(idx, { source_module: e.target.value })}
                  >
                    <option value="lcms">LC-MS</option>
                    <option value="ftir">FTIR</option>
                    <option value="plate_reader">Plate Reader</option>
                    <option value="data_studio">Data Studio</option>
                  </select>
                </div>
                <button
                  type="button"
                  onClick={() => handleRemovePanel(idx)}
                  className="mt-3 rounded p-1.5 text-ink-400 hover:bg-ink-100 hover:text-red-500"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
