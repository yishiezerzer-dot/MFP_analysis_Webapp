import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { ChevronDown, Download, FileText, Image as ImageIcon, Monitor, PenTool } from "lucide-react";
import { useStoredState } from "../hooks/useStoredState";
import {
  clampPublicationDpi,
  clampPublicationFontSize,
  clampPublicationMm,
  CURRENT_VIEW_PRESET_ID,
  DEFAULT_PUBLICATION_DPI,
  DEFAULT_PUBLICATION_LEGEND_FONT_SIZE,
  DEFAULT_PUBLICATION_SIZE,
  describePublicationExport,
  PUBLICATION_DPI_PRESETS,
  PUBLICATION_EXPORT_STORAGE_KEY,
  PUBLICATION_WIDTH_PRESETS,
  PublicationExportFormat,
  PublicationExportSettings,
  pxToLogicalMm,
} from "../utils/publicationPlotExport";
import { Tooltip } from "./Tooltip";

export interface PaperFigureExportToolbarProps {
  disabled?: boolean;
  onExport: (format: PublicationExportFormat, settings: PublicationExportSettings) => void;
  className?: string;
  storageKey?: string;
  defaultSize?: PublicationExportSettings;
  mode?: "popover" | "inline";
  currentSizePx?: { width?: number; height?: number };
}

function reconcileSettings(value: unknown, fallback: PublicationExportSettings): PublicationExportSettings {
  if (!value || typeof value !== "object") return fallback;
  const raw = value as Partial<PublicationExportSettings>;
  return {
    widthMm: clampPublicationMm(Number(raw.widthMm), fallback.widthMm),
    heightMm: clampPublicationMm(Number(raw.heightMm), fallback.heightMm),
    dpi: clampPublicationDpi(Number(raw.dpi ?? fallback.dpi)),
    legendFontSize: clampPublicationFontSize(Number(raw.legendFontSize), fallback.legendFontSize),
    isCurrentView: Boolean(raw.isCurrentView),
    sourceDimensionsPx: raw.sourceDimensionsPx,
  };
}

function sizeValue(settings: PublicationExportSettings): string {
  if (settings.isCurrentView) return CURRENT_VIEW_PRESET_ID;
  const preset = PUBLICATION_WIDTH_PRESETS.find(
    (item) =>
      Math.abs(item.widthMm - settings.widthMm) < 0.1 &&
      Math.abs(item.heightMm - settings.heightMm) < 0.1,
  );
  return preset ? preset.id : "custom";
}

function defaultSettings(props: PaperFigureExportToolbarProps): PublicationExportSettings {
  if (props.defaultSize) {
    return {
      widthMm: props.defaultSize.widthMm,
      heightMm: props.defaultSize.heightMm,
      dpi: clampPublicationDpi(props.defaultSize.dpi),
      legendFontSize: clampPublicationFontSize(props.defaultSize.legendFontSize),
    };
  }
  return {
    widthMm: DEFAULT_PUBLICATION_SIZE.widthMm,
    heightMm: DEFAULT_PUBLICATION_SIZE.heightMm,
    dpi: DEFAULT_PUBLICATION_DPI,
    legendFontSize: DEFAULT_PUBLICATION_SIZE.defaultLegendFontSize ?? DEFAULT_PUBLICATION_LEGEND_FONT_SIZE,
  };
}

export function PaperFigureExportToolbar(props: PaperFigureExportToolbarProps) {
  const fallback = defaultSettings(props);
  const [settings, setSettings] = useStoredState<PublicationExportSettings>(
    props.storageKey ?? PUBLICATION_EXPORT_STORAGE_KEY,
    fallback,
    (value) => reconcileSettings(value, fallback),
  );

  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"current" | "journal">("current");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const cardWidthPx = Math.max(
    100,
    Math.round(
      props.currentSizePx?.width ??
      containerRef.current?.closest(".card")?.clientWidth ??
      containerRef.current?.parentElement?.clientWidth ??
      1200,
    ),
  );
  const cardHeightPx = Math.max(80, Math.round(props.currentSizePx?.height ?? 400));
  const cardWidthMm = pxToLogicalMm(cardWidthPx);
  const cardHeightMm = pxToLogicalMm(cardHeightPx);

  const handleExport1to1 = (format: PublicationExportFormat) => {
    props.onExport(format, {
      ...settings,
      isCurrentView: true,
      sourceDimensionsPx: { width: cardWidthPx, height: cardHeightPx },
      widthMm: cardWidthMm,
      heightMm: cardHeightMm,
    });
    setIsOpen(false);
  };

  const mode = props.mode ?? "popover";

  if (mode === "inline") {
    return (
      <div
        className={
          props.className ??
          "flex flex-wrap items-center gap-1.5 rounded-md border border-ink-200 bg-ink-50/40 px-2 py-1 text-xs"
        }
      >
        <span className="font-medium text-ink-600">Publication</span>
        <label className="flex items-center gap-1 text-ink-600">
          <span className="text-ink-500">Preset</span>
          <select
            className="input w-[11.5rem] py-0.5 text-xs font-mono"
            value={sizeValue(settings)}
            disabled={props.disabled}
            onChange={(e) => {
              const val = e.target.value;
              if (val === "custom") return;
              if (val === CURRENT_VIEW_PRESET_ID) {
                setSettings((prev) => ({
                  ...prev,
                  isCurrentView: true,
                  sourceDimensionsPx: { width: cardWidthPx, height: cardHeightPx },
                  widthMm: cardWidthMm,
                  heightMm: cardHeightMm,
                }));
                return;
              }
              const found = PUBLICATION_WIDTH_PRESETS.find((p) => p.id === val);
              if (found) {
                setSettings((prev) => ({
                  ...prev,
                  isCurrentView: false,
                  sourceDimensionsPx: undefined,
                  widthMm: found.widthMm,
                  heightMm: found.heightMm,
                  legendFontSize: found.defaultLegendFontSize ?? prev.legendFontSize,
                }));
              }
            }}
          >
            <option value={CURRENT_VIEW_PRESET_ID}>
              Current view (1:1 card)
            </option>
            <optgroup label="ACS (JACS, Macromolecules)">
              {PUBLICATION_WIDTH_PRESETS.filter((p) => p.category === "ACS").map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
            </optgroup>
            <optgroup label="Nature Portfolio">
              {PUBLICATION_WIDTH_PRESETS.filter((p) => p.category === "Nature").map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
            </optgroup>
            <optgroup label="RSC (Chem. Sci.)">
              {PUBLICATION_WIDTH_PRESETS.filter((p) => p.category === "RSC").map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
            </optgroup>
            <optgroup label="Standard Sizes">
              {PUBLICATION_WIDTH_PRESETS.filter((p) => p.category === "Standard").map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
            </optgroup>
            <option value="custom">Custom Dimensions</option>
          </select>
        </label>
        <label className="flex items-center gap-1 text-ink-600">
          <span className="text-ink-500">W</span>
          <input
            type="number"
            className="input w-[4.25rem] py-0.5 text-xs"
            min={30}
            max={260}
            step={1}
            value={settings.widthMm}
            disabled={props.disabled}
            onChange={(e) =>
              setSettings((prev) => ({
                ...prev,
                widthMm: clampPublicationMm(Number(e.target.value), prev.widthMm),
              }))
            }
          />
        </label>
        <label className="flex items-center gap-1 text-ink-600">
          <span className="text-ink-500">H</span>
          <input
            type="number"
            className="input w-[4.25rem] py-0.5 text-xs"
            min={30}
            max={260}
            step={1}
            value={settings.heightMm}
            disabled={props.disabled}
            onChange={(e) =>
              setSettings((prev) => ({
                ...prev,
                heightMm: clampPublicationMm(Number(e.target.value), prev.heightMm),
              }))
            }
          />
        </label>
        <label className="flex items-center gap-1 text-ink-600">
          <span className="text-ink-500">DPI</span>
          <select
            className="input w-[4.75rem] py-0.5 text-xs"
            value={settings.dpi}
            disabled={props.disabled}
            onChange={(e) => setSettings((prev) => ({ ...prev, dpi: clampPublicationDpi(Number(e.target.value)) }))}
          >
            {PUBLICATION_DPI_PRESETS.map((dpi) => (
              <option key={dpi} value={dpi}>
                {dpi}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1 text-ink-600">
          <span className="text-ink-500">Legend</span>
          <input
            type="number"
            className="input w-[3.75rem] py-0.5 text-xs"
            min={4}
            max={36}
            step={1}
            value={settings.legendFontSize}
            disabled={props.disabled}
            onChange={(e) =>
              setSettings((prev) => ({
                ...prev,
                legendFontSize: clampPublicationFontSize(Number(e.target.value), prev.legendFontSize),
              }))
            }
          />
        </label>
        <Tooltip content={`Export editable vector SVG with a ${settings.widthMm} x ${settings.heightMm} mm plot area. Legends stack vertically on the right with extra space. DPI is only used for PNG.`}>
          <span>
            <button
              type="button"
              className="rounded border border-ink-200 bg-surface px-2 py-0.5 text-xs text-ink-700 transition-colors hover:bg-ink-100 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={props.disabled}
              onClick={() => props.onExport("svg", settings)}
            >
              SVG
            </button>
          </span>
        </Tooltip>
        <Tooltip content={describePublicationExport(settings)}>
          <span>
            <button
              type="button"
              className="rounded border border-ink-200 bg-surface px-2 py-0.5 text-xs text-ink-700 transition-colors hover:bg-ink-100 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={props.disabled}
              onClick={() => props.onExport("png", settings)}
            >
              PNG
            </button>
          </span>
        </Tooltip>
      </div>
    );
  }

  return (
    <div ref={containerRef} className={clsx("relative inline-block", props.className)}>
      <Tooltip content="Export figure at publication-ready journal dimensions and DPI (ACS, Nature, RSC)">
        <button
          type="button"
          className={clsx(
            "btn-ghost whitespace-nowrap px-2 py-1",
            props.disabled && "cursor-not-allowed opacity-40",
            isOpen && "bg-brand-50 text-brand-800",
          )}
          disabled={props.disabled}
          aria-expanded={isOpen}
          onClick={() => setIsOpen((prev) => !prev)}
        >
          <Download size={15} strokeWidth={1.8} aria-hidden />
          <span>Export</span>
          <ChevronDown size={13} strokeWidth={1.8} aria-hidden />
        </button>
      </Tooltip>

      {isOpen && (
        <div className="absolute right-0 top-full mt-1.5 z-50 w-[390px] max-w-[calc(100vw-1.5rem)] rounded-xl border border-ink-200 bg-surface p-3.5 shadow-xl text-xs text-ink-800 animate-in fade-in zoom-in-95 duration-100">
          <div className="flex items-center justify-between pb-2 mb-2.5 border-b border-ink-200">
            <div className="flex items-center gap-1.5 font-semibold text-ink-900 text-[13px]">
              <Download size={15} strokeWidth={1.8} aria-hidden />
              <span>Figure & publication export</span>
            </div>
            <button
              type="button"
              className="text-ink-500 hover:text-ink-700 text-sm p-1 rounded transition-colors"
              onClick={() => setIsOpen(false)}
              title="Close export panel"
            >
              ✕
            </button>
          </div>

          {/* Segmented Tab Switcher */}
          <div className="flex items-center rounded-lg bg-ink-100/80 p-1 mb-3 text-xs">
            <button
              type="button"
              className={clsx(
                "flex-1 py-1.5 px-2 rounded-md font-medium transition-all flex items-center justify-center gap-1.5 text-xs whitespace-nowrap",
                activeTab === "current"
                  ? "bg-surface text-ink-900 shadow-xs font-semibold"
                  : "text-ink-600 hover:text-ink-900",
              )}
              onClick={() => {
                setActiveTab("current");
                setSettings((prev) => ({
                  ...prev,
                  isCurrentView: true,
                  sourceDimensionsPx: { width: cardWidthPx, height: cardHeightPx },
                  widthMm: cardWidthMm,
                  heightMm: cardHeightMm,
                }));
              }}
            >
              <Monitor size={15} strokeWidth={1.8} aria-hidden />
              <span>Current view (1:1)</span>
            </button>
            <button
              type="button"
              className={clsx(
                "flex-1 py-1.5 px-2 rounded-md font-medium transition-all flex items-center justify-center gap-1.5 text-xs whitespace-nowrap",
                activeTab === "journal"
                  ? "bg-surface text-ink-900 shadow-xs font-semibold"
                  : "text-ink-600 hover:text-ink-900",
              )}
              onClick={() => {
                setActiveTab("journal");
                setSettings((prev) => ({
                  ...prev,
                  isCurrentView: false,
                  sourceDimensionsPx: undefined,
                }));
              }}
            >
              <FileText size={15} strokeWidth={1.8} aria-hidden />
              <span>Journal presets</span>
            </button>
          </div>

          {/* Tab 1: Current View (1:1) */}
          {activeTab === "current" && (
            <div className="space-y-3">
              <div className="rounded-lg border border-brand-200/90 bg-brand-50/60 p-3 text-xs">
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <span className="font-semibold text-brand-900 text-xs flex items-center gap-1.5 whitespace-nowrap">
                    <span>Active Display</span>
                  </span>
                  <span className="font-mono text-[12px] font-semibold text-brand-700 bg-white border border-brand-200 px-2 py-0.5 rounded shadow-2xs whitespace-nowrap">
                    {cardWidthPx} × {cardHeightPx} px
                  </span>
                </div>
                <p className="text-[12px] text-brand-700 leading-relaxed">
                  Exact 1-to-1 card replica: matches card aspect ratio, active zoom, centroid sticks, and peak labels.
                </p>
              </div>

              <div>
                <label className="block text-[12px] font-medium text-ink-600 mb-1">
                  Raster Resolution (PNG only)
                </label>
                <select
                  className="input w-full py-1 text-xs"
                  value={settings.dpi}
                  onChange={(e) =>
                    setSettings((prev) => ({ ...prev, dpi: clampPublicationDpi(Number(e.target.value)) }))
                  }
                >
                  <option value={150}>150 DPI — Fast Draft ({Math.round(cardWidthPx * (150 / 96))} × {Math.round(cardHeightPx * (150 / 96))} px)</option>
                  <option value={300}>300 DPI — Presentation / Web ({Math.round(cardWidthPx * (300 / 96))} × {Math.round(cardHeightPx * (300 / 96))} px)</option>
                  <option value={600}>600 DPI — Publication Hi-Res ({Math.round(cardWidthPx * (600 / 96))} × {Math.round(cardHeightPx * (600 / 96))} px)</option>
                  <option value={1200}>1200 DPI — Ultra Print ({Math.round(cardWidthPx * (1200 / 96))} × {Math.round(cardHeightPx * (1200 / 96))} px)</option>
                </select>
              </div>

              <div className="pt-2 border-t border-ink-200 flex items-center gap-2">
                <button
                  type="button"
                  className="flex-1 rounded-md bg-brand-600 py-2 px-3 text-xs font-semibold text-white hover:bg-brand-700 transition-colors shadow-xs flex items-center justify-center gap-1.5 whitespace-nowrap"
                  onClick={() => handleExport1to1("png")}
                  title={`Export 1:1 PNG at ${settings.dpi} DPI (${Math.round(cardWidthPx * (settings.dpi / 96))} × ${Math.round(cardHeightPx * (settings.dpi / 96))} px)`}
                >
                  <ImageIcon size={15} strokeWidth={1.8} aria-hidden />
                  <span>Export 1:1 PNG</span>
                </button>
                <button
                  type="button"
                  className="flex-1 rounded-md border border-ink-300 bg-surface py-2 px-3 text-xs font-semibold text-ink-800 hover:bg-ink-50 transition-colors shadow-xs flex items-center justify-center gap-1.5 whitespace-nowrap"
                  onClick={() => handleExport1to1("svg")}
                  title="Export 1:1 Vector SVG (infinite resolution, vector peak sticks)"
                >
                  <PenTool size={15} strokeWidth={1.8} aria-hidden />
                  <span>Export 1:1 SVG</span>
                </button>
              </div>
            </div>
          )}

          {/* Tab 2: Journal Presets */}
          {activeTab === "journal" && (
            <div className="space-y-2.5">
              <div>
                <label className="block text-[12px] font-medium text-ink-600 mb-1">
                  Journal Preset
                </label>
                <select
                  className="input w-full py-1 text-xs font-mono"
                  value={sizeValue(settings)}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === "custom") return;
                    const found = PUBLICATION_WIDTH_PRESETS.find((p) => p.id === val);
                    if (found) {
                      setSettings((prev) => ({
                        ...prev,
                        isCurrentView: false,
                        sourceDimensionsPx: undefined,
                        widthMm: found.widthMm,
                        heightMm: found.heightMm,
                        legendFontSize: found.defaultLegendFontSize ?? prev.legendFontSize,
                      }));
                    }
                  }}
                >
                  <optgroup label="ACS (JACS, Macromolecules)">
                    {PUBLICATION_WIDTH_PRESETS.filter((p) => p.category === "ACS").map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.label}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Nature Portfolio">
                    {PUBLICATION_WIDTH_PRESETS.filter((p) => p.category === "Nature").map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.label}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="RSC (Chem. Sci.)">
                    {PUBLICATION_WIDTH_PRESETS.filter((p) => p.category === "RSC").map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.label}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Standard Sizes">
                    {PUBLICATION_WIDTH_PRESETS.filter((p) => p.category === "Standard").map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.label}
                      </option>
                    ))}
                  </optgroup>
                  <option value="custom">Custom Dimensions</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[12px] font-medium text-ink-600 mb-1">Width (mm)</label>
                  <input
                    type="number"
                    className="input w-full py-1 text-xs"
                    min={30}
                    max={260}
                    step={1}
                    value={settings.widthMm}
                    onChange={(e) =>
                      setSettings((prev) => ({
                        ...prev,
                        isCurrentView: false,
                        widthMm: clampPublicationMm(Number(e.target.value), prev.widthMm),
                      }))
                    }
                  />
                </div>
                <div>
                  <label className="block text-[12px] font-medium text-ink-600 mb-1">Height (mm)</label>
                  <input
                    type="number"
                    className="input w-full py-1 text-xs"
                    min={30}
                    max={260}
                    step={1}
                    value={settings.heightMm}
                    onChange={(e) =>
                      setSettings((prev) => ({
                        ...prev,
                        isCurrentView: false,
                        heightMm: clampPublicationMm(Number(e.target.value), prev.heightMm),
                      }))
                    }
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[12px] font-medium text-ink-600 mb-1">Resolution (DPI)</label>
                  <select
                    className="input w-full py-1 text-xs"
                    value={settings.dpi}
                    onChange={(e) => setSettings((prev) => ({ ...prev, dpi: clampPublicationDpi(Number(e.target.value)) }))}
                  >
                    {PUBLICATION_DPI_PRESETS.map((dpi) => (
                      <option key={dpi} value={dpi}>
                        {dpi} DPI
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[12px] font-medium text-ink-600 mb-1">Legend font (pt)</label>
                  <input
                    type="number"
                    className="input w-full py-1 text-xs"
                    min={4}
                    max={36}
                    step={1}
                    value={settings.legendFontSize}
                    onChange={(e) =>
                      setSettings((prev) => ({
                        ...prev,
                        legendFontSize: clampPublicationFontSize(Number(e.target.value), prev.legendFontSize),
                      }))
                    }
                  />
                </div>
              </div>

              <div className="text-[12px] text-ink-500 pt-0.5 leading-snug">
                {describePublicationExport(settings)}
              </div>

              <div className="pt-2 border-t border-ink-200 flex items-center justify-end gap-2">
                <button
                  type="button"
                  className="flex-1 rounded-md border border-ink-300 bg-surface py-2 px-3 text-xs font-semibold text-ink-800 hover:bg-ink-50 transition-colors shadow-xs whitespace-nowrap"
                  onClick={() => {
                    props.onExport("svg", { ...settings, isCurrentView: false });
                    setIsOpen(false);
                  }}
                >
                  Vector SVG
                </button>
                <button
                  type="button"
                  className="flex-1 rounded-md bg-brand-600 py-2 px-3 text-xs font-semibold text-white hover:bg-brand-700 transition-colors shadow-xs whitespace-nowrap"
                  onClick={() => {
                    props.onExport("png", { ...settings, isCurrentView: false });
                    setIsOpen(false);
                  }}
                >
                  Publication PNG
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
