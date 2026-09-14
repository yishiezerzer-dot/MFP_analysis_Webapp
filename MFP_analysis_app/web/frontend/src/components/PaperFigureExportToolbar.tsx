import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
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
              ⭐ Current View (1:1 Card)
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
            "flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors shadow-xs whitespace-nowrap",
            props.disabled
              ? "border-ink-200 bg-surface text-ink-400 cursor-not-allowed opacity-50"
              : isOpen
                ? "border-brand-500 bg-brand-50 text-brand-700 ring-1 ring-brand-500"
                : "border-ink-200 bg-surface text-ink-700 hover:bg-ink-100",
          )}
          disabled={props.disabled}
          onClick={() => setIsOpen((prev) => !prev)}
        >
          <span>📷</span>
          <span>Export</span>
          <span className="text-[9px] text-ink-400">▾</span>
        </button>
      </Tooltip>

      {isOpen && (
        <div className="absolute right-0 top-full mt-1.5 z-50 w-84 rounded-xl border border-ink-200 bg-surface p-3.5 shadow-xl text-xs text-ink-800 animate-in fade-in zoom-in-95 duration-100">
          <div className="flex items-center justify-between pb-2 mb-2.5 border-b border-ink-200">
            <div className="flex items-center gap-1.5 font-semibold text-ink-900">
              <span>📷</span>
              <span>Publication & Figure Export</span>
            </div>
            <button
              type="button"
              className="text-ink-400 hover:text-ink-700 text-sm p-0.5 rounded transition-colors"
              onClick={() => setIsOpen(false)}
              title="Close export panel"
            >
              ✕
            </button>
          </div>

          {/* Quick 1:1 Snapshot Card */}
          <div className="rounded-lg border border-brand-200 bg-brand-50/70 p-2.5 mb-3 shadow-2xs">
            <div className="flex items-center justify-between mb-1">
              <span className="font-semibold text-brand-900 text-xs flex items-center gap-1.5">
                <span>🖥️</span>
                <span>Current View (1:1 Card)</span>
              </span>
              <span className="text-[10px] font-mono font-medium text-brand-700 bg-white/90 border border-brand-200 px-1.5 py-0.5 rounded">
                {cardWidthPx} × {cardHeightPx} px
              </span>
            </div>
            <p className="text-[11px] text-brand-800 leading-snug mb-2">
              Exact 1-to-1 card replica: matches aspect ratio, active zoom, centroid sticks & peak labels.
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="flex-1 rounded-md bg-brand-600 py-1.5 px-2 text-xs font-semibold text-white hover:bg-brand-700 transition-colors shadow-xs"
                onClick={() => handleExport1to1("png")}
                title={`Export 1:1 PNG at ${settings.dpi} DPI (${Math.round(cardWidthPx * (settings.dpi / 96))} × ${Math.round(cardHeightPx * (settings.dpi / 96))} px)`}
              >
                1:1 PNG ({settings.dpi} DPI)
              </button>
              <button
                type="button"
                className="flex-1 rounded-md border border-brand-300 bg-white py-1.5 px-2 text-xs font-semibold text-brand-700 hover:bg-brand-50 transition-colors shadow-xs"
                onClick={() => handleExport1to1("svg")}
                title="Export 1:1 Vector SVG (infinite resolution, vector peak sticks)"
              >
                1:1 Vector SVG
              </button>
            </div>
          </div>

          <div className="space-y-2.5">
            <div>
              <label className="block text-[11px] font-medium text-ink-600 mb-1">
                Journal Paper Presets (Print)
              </label>
              <select
                className="input w-full py-1 text-xs font-mono"
                value={sizeValue(settings)}
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
                  ⭐ Current View (1:1 Card - {cardWidthPx} × {cardHeightPx} px)
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
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] font-medium text-ink-600 mb-1">Width (mm)</label>
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
                      widthMm: clampPublicationMm(Number(e.target.value), prev.widthMm),
                    }))
                  }
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-ink-600 mb-1">Height (mm)</label>
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
                      heightMm: clampPublicationMm(Number(e.target.value), prev.heightMm),
                    }))
                  }
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] font-medium text-ink-600 mb-1">Resolution (DPI)</label>
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
                <label className="block text-[11px] font-medium text-ink-600 mb-1">Legend font (pt)</label>
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

            <div className="text-[11px] text-ink-500 pt-0.5">
              {describePublicationExport(settings)}
            </div>

            <div className="pt-2 border-t border-ink-200 flex items-center justify-end gap-2">
              <button
                type="button"
                className="flex-1 rounded-md border border-brand-300 bg-brand-50 py-1.5 px-2 text-xs font-semibold text-brand-700 hover:bg-brand-100 transition-colors shadow-xs"
                onClick={() => {
                  props.onExport("svg", settings);
                  setIsOpen(false);
                }}
              >
                Vector SVG
              </button>
              <button
                type="button"
                className="flex-1 rounded-md bg-brand-600 py-1.5 px-2 text-xs font-semibold text-white hover:bg-brand-700 transition-colors shadow-xs"
                onClick={() => {
                  props.onExport("png", settings);
                  setIsOpen(false);
                }}
              >
                Publication PNG
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
