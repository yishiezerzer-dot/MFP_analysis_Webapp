import { type ReactNode } from "react";
import clsx from "clsx";

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
  const tabs = [
    { id: "preprocess" as const, label: "Preprocess", icon: "🧪" },
    { id: "peaks" as const, label: "Peaks & Library", icon: "📍" },
    { id: "quant" as const, label: "Deconvolution & Quant", icon: "🔬" },
    { id: "overlay" as const, label: "Multi-Overlay", icon: "📑" },
  ];

  return (
    <aside
      aria-label="FTIR Analysis Inspector"
      className="flex w-96 shrink-0 flex-col border-l border-ink-200 bg-surface shadow-md"
    >
      {/* Inspector Tab Bar */}
      <div className="flex border-b border-ink-200 bg-ink-50/70 px-2 pt-2">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onTabChange(tab.id)}
              className={clsx(
                "-mb-px flex flex-1 items-center justify-center gap-1.5 border-b-2 py-2 text-xs font-medium transition-colors select-none",
                isActive
                  ? "border-brand-500 text-brand-700 font-semibold bg-surface rounded-t-md shadow-xs"
                  : "border-transparent text-ink-500 hover:text-ink-800 hover:bg-surface/50",
              )}
            >
              <span className="text-sm">{tab.icon}</span>
              <span className="truncate">{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Sub-header with Undo/Redo or Status */}
      <div className="flex items-center justify-between border-b border-ink-100 px-3 py-1.5 bg-ink-50/40 text-xs">
        <span className="font-medium text-ink-600">
          {activeTab === "preprocess" && "Baseline & Spectra Adjustments"}
          {activeTab === "peaks" && "Peak Identification & Library Matching"}
          {activeTab === "quant" && "Amide I Deconvolution & Subtraction"}
          {activeTab === "overlay" && "Multi-Sample Comparison"}
        </span>

        {activeTab === "preprocess" && undoPre && redoPre && (
          <div className="flex items-center gap-1">
            <span className="text-[11px] text-ink-400 mr-1">Undo:</span>
            <button
              type="button"
              className="rounded border border-ink-200 bg-surface px-1.5 py-0.5 text-xs text-ink-600 hover:bg-ink-100 disabled:opacity-30"
              disabled={!canUndoPre}
              onClick={undoPre}
              title="Undo preprocessing change (Ctrl+Z)"
            >
              ↩
            </button>
            <button
              type="button"
              className="rounded border border-ink-200 bg-surface px-1.5 py-0.5 text-xs text-ink-600 hover:bg-ink-100 disabled:opacity-30"
              disabled={!canRedoPre}
              onClick={redoPre}
              title="Redo preprocessing change (Ctrl+Y)"
            >
              ↪
            </button>
          </div>
        )}

        {activeTab === "peaks" && undoPk && redoPk && (
          <div className="flex items-center gap-1">
            <span className="text-[11px] text-ink-400 mr-1">Undo:</span>
            <button
              type="button"
              className="rounded border border-ink-200 bg-surface px-1.5 py-0.5 text-xs text-ink-600 hover:bg-ink-100 disabled:opacity-30"
              disabled={!canUndoPk}
              onClick={undoPk}
              title="Undo peak pick change (Ctrl+Z)"
            >
              ↩
            </button>
            <button
              type="button"
              className="rounded border border-ink-200 bg-surface px-1.5 py-0.5 text-xs text-ink-600 hover:bg-ink-100 disabled:opacity-30"
              disabled={!canRedoPk}
              onClick={redoPk}
              title="Redo peak pick change (Ctrl+Y)"
            >
              ↪
            </button>
          </div>
        )}
      </div>

      {/* Inspector Tab Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {activeTab === "preprocess" && childrenPreprocess}
        {activeTab === "peaks" && childrenPeaks}
        {activeTab === "quant" && childrenQuant}
        {activeTab === "overlay" && childrenOverlay}
      </div>
    </aside>
  );
}
