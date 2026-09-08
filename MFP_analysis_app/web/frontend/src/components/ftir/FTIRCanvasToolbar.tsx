import { useEffect } from "react";
import clsx from "clsx";
import { SegmentedControl } from "../common/SegmentedControl";

export type PeakEditMode = "none" | "add" | "remove";

export interface FTIRCanvasToolbarProps {
  mode: PeakEditMode;
  onModeChange: (mode: PeakEditMode) => void;
  manualPeakCount: number;
  onClearManual: () => void;
  className?: string;
}

export function FTIRCanvasToolbar({
  mode,
  onModeChange,
  manualPeakCount,
  onClearManual,
  className,
}: FTIRCanvasToolbarProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && mode !== "none") {
        onModeChange("none");
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mode, onModeChange]);

  return (
    <div
      className={clsx(
        "flex flex-wrap items-center justify-between gap-2 rounded-lg border border-ink-200 bg-surface/90 px-3 py-1.5 shadow-sm backdrop-blur-sm",
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">
          Peak Tool:
        </span>
        <SegmentedControl
          size="xs"
          value={mode}
          onChange={onModeChange}
          options={[
            { value: "none", label: "Inspect", icon: "👁️", title: "Standard view & zoom mode" },
            { value: "add", label: "Add Peak", icon: "➕", title: "Click spectrum to add a manual peak" },
            { value: "remove", label: "Delete Peak", icon: "❌", title: "Click a peak to remove it" },
          ]}
        />
      </div>

      <div className="flex items-center gap-2 text-xs">
        {mode !== "none" && (
          <span className="flex items-center gap-1.5 rounded-full bg-brand-50 px-2.5 py-0.5 text-[11px] font-medium text-brand-700 animate-in fade-in">
            <span className="h-1.5 w-1.5 rounded-full bg-brand-600 animate-ping" />
            {mode === "add" && "Click spectrum to place peak (Esc to cancel)"}
            {mode === "remove" && "Click peak marker to remove (Esc to cancel)"}
          </span>
        )}

        {manualPeakCount > 0 && (
          <button
            type="button"
            className="rounded border border-ink-200 bg-surface px-2 py-0.5 text-[11px] text-ink-600 transition-colors hover:bg-rose-50 hover:border-rose-200 hover:text-rose-700"
            onClick={onClearManual}
            title="Reset all manually added and deleted peaks"
          >
            Clear Manual ({manualPeakCount})
          </button>
        )}
      </div>
    </div>
  );
}
