import { useStoredState } from "../hooks/useStoredState";
import {
  clampPublicationDpi,
  clampPublicationFontSize,
  clampPublicationMm,
  DEFAULT_PUBLICATION_DPI,
  DEFAULT_PUBLICATION_LEGEND_FONT_SIZE,
  DEFAULT_PUBLICATION_SIZE,
  describePublicationExport,
  PUBLICATION_DPI_PRESETS,
  PUBLICATION_EXPORT_STORAGE_KEY,
  PUBLICATION_WIDTH_PRESETS,
  PublicationExportFormat,
  PublicationExportSettings,
} from "../utils/publicationPlotExport";
import { Tooltip } from "./Tooltip";

interface PaperFigureExportToolbarProps {
  disabled?: boolean;
  onExport: (format: PublicationExportFormat, settings: PublicationExportSettings) => void;
  className?: string;
  storageKey?: string;
  defaultSize?: PublicationExportSettings;
}

function reconcileSettings(value: unknown, fallback: PublicationExportSettings): PublicationExportSettings {
  if (!value || typeof value !== "object") return fallback;
  const raw = value as Partial<PublicationExportSettings>;
  return {
    widthMm: clampPublicationMm(Number(raw.widthMm), fallback.widthMm),
    heightMm: clampPublicationMm(Number(raw.heightMm), fallback.heightMm),
    dpi: clampPublicationDpi(Number(raw.dpi ?? fallback.dpi)),
    legendFontSize: clampPublicationFontSize(Number(raw.legendFontSize), fallback.legendFontSize),
  };
}

function sizeValue(settings: PublicationExportSettings): string {
  const preset = PUBLICATION_WIDTH_PRESETS.find(
    (item) => item.widthMm === settings.widthMm && item.heightMm === settings.heightMm,
  );
  return preset ? `${preset.widthMm}x${preset.heightMm}` : "custom";
}

function parseSize(value: string, fallback: PublicationExportSettings): Pick<PublicationExportSettings, "widthMm" | "heightMm"> {
  if (value === "custom") return { widthMm: fallback.widthMm, heightMm: fallback.heightMm };
  const [w, h] = value.split("x").map((part) => Number(part));
  const preset = PUBLICATION_WIDTH_PRESETS.find((item) => item.widthMm === w && item.heightMm === h) ?? DEFAULT_PUBLICATION_SIZE;
  return { widthMm: preset.widthMm, heightMm: preset.heightMm };
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
    legendFontSize: DEFAULT_PUBLICATION_LEGEND_FONT_SIZE,
  };
}

export function PaperFigureExportToolbar(props: PaperFigureExportToolbarProps) {
  const fallback = defaultSettings(props);
  const [settings, setSettings] = useStoredState<PublicationExportSettings>(
    props.storageKey ?? PUBLICATION_EXPORT_STORAGE_KEY,
    fallback,
    (value) => reconcileSettings(value, fallback),
  );

  return (
    <div
      className={
        props.className ??
        "flex flex-wrap items-center gap-1.5 rounded-md border border-ink-200 bg-ink-50/40 px-2 py-1"
      }
    >
      <span className="text-xs font-medium text-ink-600">Publication</span>
      <label className="flex items-center gap-1 text-xs text-ink-600">
        <span className="text-ink-500">Preset</span>
        <select
          className="input w-[7.5rem] py-0.5 text-xs"
          value={sizeValue(settings)}
          disabled={props.disabled}
          onChange={(e) => setSettings((prev) => ({ ...prev, ...parseSize(e.target.value, prev) }))}
        >
          {PUBLICATION_WIDTH_PRESETS.map((preset) => (
            <option key={`${preset.widthMm}x${preset.heightMm}`} value={`${preset.widthMm}x${preset.heightMm}`}>
              {preset.label}
            </option>
          ))}
          <option value="custom">Custom</option>
        </select>
      </label>
      <label className="flex items-center gap-1 text-xs text-ink-600">
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
      <label className="flex items-center gap-1 text-xs text-ink-600">
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
      <label className="flex items-center gap-1 text-xs text-ink-600">
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
      <label className="flex items-center gap-1 text-xs text-ink-600">
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
