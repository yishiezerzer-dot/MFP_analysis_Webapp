import { type ReactNode } from "react";
import clsx from "clsx";
import { FlaskConical, Layers, MapPin, Microscope, Redo2, Undo2, type LucideIcon } from "lucide-react";
import { ICON_PROPS } from "../common/ChartCardParts";

export type FTIRInspectorTab = "preprocess" | "peaks" | "quant" | "overlay";

export interface FTIRInspectorPanelProps {
  activeTab: FTIRInspectorTab;
  onTabChange: (tab: FTIRInspectorTab) => void;
  childrenPreprocess: ReactNode;
  childrenPeaks: ReactNode;
  childrenQuant: ReactNode;
  childrenOverlay: ReactNode;
  undoPre?: () => void;
  redoPre?: () => void;
  canUndoPre?: boolean;
  canRedoPre?: boolean;
  undoPk?: () => void;
  redoPk?: () => void;
  canUndoPk?: boolean;
  canRedoPk?: boolean;
}

const TABS: Array<{ id: FTIRInspectorTab; label: string; icon: LucideIcon; heading: string }> = [
  { id: "preprocess", label: "Preprocess", icon: FlaskConical, heading: "Baseline & spectra adjustments" },
  { id: "peaks", label: "Peaks & library", icon: MapPin, heading: "Peak identification & library matching" },
  { id: "quant", label: "Deconvolution", icon: Microscope, heading: "Amide I deconvolution & subtraction" },
  { id: "overlay", label: "Multi-overlay", icon: Layers, heading: "Multi-sample comparison" },
];

function UndoRedo(props: { undo: () => void; redo: () => void; canUndo?: boolean; canRedo?: boolean; what: string }) {
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        className="btn-ghost px-1.5 py-1 disabled:opacity-30"
        disabled={!props.canUndo}
        onClick={props.undo}
        aria-label={`Undo ${props.what} change`}
        title={`Undo ${props.what} change (Ctrl+Z)`}
      >
        <Undo2 {...ICON_PROPS} />
      </button>
      <button
        type="button"
        className="btn-ghost px-1.5 py-1 disabled:opacity-30"
        disabled={!props.canRedo}
        onClick={props.redo}
        aria-label={`Redo ${props.what} change`}
        title={`Redo ${props.what} change (Ctrl+Y)`}
      >
        <Redo2 {...ICON_PROPS} />
      </button>
    </div>
  );
}

export function FTIRInspectorPanel({
  activeTab,
  onTabChange,
  childrenPreprocess,
  childrenPeaks,
  childrenQuant,
  childrenOverlay,
  undoPre,
  redoPre,
  canUndoPre,
  canRedoPre,
  undoPk,
  redoPk,
  canUndoPk,
  canRedoPk,
}: FTIRInspectorPanelProps) {
  const current = TABS.find((tab) => tab.id === activeTab) ?? TABS[0];

  return (
    <aside
      aria-label="FTIR Analysis Inspector"
      className="flex w-[360px] min-w-0 shrink-0 flex-col overflow-x-hidden border-l border-ink-200 bg-surface"
    >
      {/* 2 x 2 switcher: all four sections fit without horizontal scrolling */}
      <div role="tablist" aria-label="Inspector sections" className="grid grid-cols-2 gap-1 border-b border-ink-200 p-2">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => onTabChange(tab.id)}
              className={clsx(
                "flex min-h-8 min-w-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[13px] font-medium transition-colors",
                isActive ? "bg-brand-50 text-brand-800" : "text-ink-600 hover:bg-ink-100 hover:text-ink-900",
              )}
            >
              <Icon {...ICON_PROPS} className="shrink-0" />
              <span className="truncate">{tab.label}</span>
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-2 border-b border-ink-100 px-3 py-1.5">
        <span className="text-section truncate">{current.heading}</span>
        {activeTab === "preprocess" && undoPre && redoPre && (
          <UndoRedo undo={undoPre} redo={redoPre} canUndo={canUndoPre} canRedo={canRedoPre} what="preprocessing" />
        )}
        {activeTab === "peaks" && undoPk && redoPk && (
          <UndoRedo undo={undoPk} redo={redoPk} canUndo={canUndoPk} canRedo={canRedoPk} what="peak pick" />
        )}
      </div>

      <div role="tabpanel" className="min-w-0 flex-1 space-y-4 overflow-y-auto overflow-x-hidden p-3">
        {activeTab === "preprocess" && childrenPreprocess}
        {activeTab === "peaks" && childrenPeaks}
        {activeTab === "quant" && childrenQuant}
        {activeTab === "overlay" && childrenOverlay}
      </div>
    </aside>
  );
}
