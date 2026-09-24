import { useEffect } from "react";
import clsx from "clsx";
import { MousePointer2, Plus, Trash2 } from "lucide-react";
import { SegmentedControl } from "../common/SegmentedControl";
import { ICON_PROPS } from "../common/ChartCardParts";

export type PeakEditMode = "none" | "add" | "remove";

export interface FTIRCanvasToolbarProps {
  mode: PeakEditMode;
  onModeChange: (mode: PeakEditMode) => void;
  manualPeakCount: number;
  onClearManual: () => void;
  className?: string;
}

// Peak tool shown inside the spectrum card's toolbar.
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
    <div className={clsx("flex flex-wrap items-center gap-2", className)}>
      <SegmentedControl
        size="xs"
        ariaLabel="Peak tool"
        value={mode}
        onChange={onModeChange}
        options={[
          { value: "none", label: "Inspect", icon: <MousePointer2 {...ICON_PROPS} />, title: "Standard view & zoom mode" },
          { value: "add", label: "Add peak", icon: <Plus {...ICON_PROPS} />, title: "Click spectrum to add a manual peak" },
          { value: "remove", label: "Delete peak", icon: <Trash2 {...ICON_PROPS} />, title: "Click a peak to remove it" },
        ]}
      />
      {mode !== "none" && (
        <span className="text-caption flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-brand-600" aria-hidden />
          {mode === "add" ? "Click spectrum to place peak (Esc to cancel)" : "Click peak marker to remove (Esc to cancel)"}
        </span>
      )}
      {manualPeakCount > 0 && (
        <button
          type="button"
          className="btn-danger px-2 py-0.5"
          onClick={onClearManual}
          title="Reset all manually added and deleted peaks"
        >
          Clear manual ({manualPeakCount})
        </button>
      )}
    </div>
  );
}
