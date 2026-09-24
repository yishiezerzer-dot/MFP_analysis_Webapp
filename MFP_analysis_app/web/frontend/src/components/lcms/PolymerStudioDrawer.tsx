import { useState } from "react";
import { ChartScatter, Save, Table2 } from "lucide-react";
import clsx from "clsx";
import { loadPolymerUiSettings, type Polarity, type PolymerUiSettings } from "../../lcms/analysis";
import { GroupBox, Modal } from "./DialogControls";
import {
  PolymerAdductSettings,
  PolymerEnableToggle,
  PolymerMassSettings,
  PolymerMatchingSettings,
  PolymerMonomerSettings,
  PolymerPresetButton,
  PolymerTargetFileBanner,
  PolymerVariantSettings,
  type PolymerSessionProps,
} from "./PolymerDialog";

export interface PolymerStudioDrawerProps extends PolymerSessionProps {
  open: boolean;
  onClose: () => void;
  polarity: Polarity;
  settings: PolymerUiSettings;
  onChange: (settings: PolymerUiSettings) => void;
  onExpectedProducts: () => void;
  onKendrick: () => void;
  canOpenExpectedProducts: boolean;
  canOpenKendrick: boolean;
  onSaveDefaults: () => void;
  spectrumAvailable?: boolean;
}

const SUB_TABS = [
  { id: "monomers", label: "Monomers" },
  { id: "adducts", label: "Adducts" },
  { id: "masses", label: "Masses & Variants" },
] as const;

export function PolymerStudioModal({
  open,
  onClose,
  polarity,
  settings,
  onChange,
  onExpectedProducts,
  onKendrick,
  canOpenExpectedProducts,
  canOpenKendrick,
  onSaveDefaults,
  ...sessionProps
}: PolymerStudioDrawerProps) {
  const [activeSubTab, setActiveSubTab] = useState<(typeof SUB_TABS)[number]["id"]>("monomers");
  if (!open) return null;

  const disabled = polarity === "all";
  const live = settings.shared.enabled && !disabled;
  const section = { polarity, settings, onChange };

  const modalFooter = (
    <div className="flex w-full flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-md border border-ink-200 bg-surface px-3 py-1.5 text-xs text-ink-700 hover:bg-ink-100"
          onClick={onSaveDefaults}
          title="Save current configuration as default"
        >
          <Save size={15} strokeWidth={1.8} aria-hidden />
          Save as defaults
        </button>
        <button
          type="button"
          className="rounded-md border border-ink-200 bg-surface px-3 py-1.5 text-xs text-ink-600 hover:bg-ink-100"
          onClick={() => onChange(loadPolymerUiSettings())}
          title="Reset to your saved defaults (factory defaults if none are saved)"
        >
          Reset
        </button>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-lg border border-brand-200 bg-brand-50 px-3 py-1.5 text-xs font-semibold text-brand-700 shadow-sm transition-colors hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-40"
          onClick={onExpectedProducts}
          disabled={!canOpenExpectedProducts}
          title={
            canOpenExpectedProducts
              ? "View table of all expected monomer/dimer/oligomer products for current MS1"
              : "Select monomers and load an MS1 spectrum first"
          }
        >
          <Table2 size={15} strokeWidth={1.8} aria-hidden />
          <span>Expected series</span>
        </button>
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-lg border border-brand-200 bg-brand-50 px-3 py-1.5 text-xs font-semibold text-brand-700 shadow-sm transition-colors hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-40"
          onClick={onKendrick}
          disabled={!canOpenKendrick}
          title={canOpenKendrick ? "Open Kendrick Mass Defect (KMD) plot for current spectrum" : "Load an MS1 spectrum first"}
        >
          <ChartScatter size={15} strokeWidth={1.8} aria-hidden />
          <span>Kendrick plot</span>
        </button>
        <button type="button" className="btn-primary text-xs" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );

  return (
    <Modal title={`Polymer Studio (${polarity})`} onClose={onClose} width="max-w-3xl" footer={modalFooter}>
      <div className="flex flex-col gap-4">
        <PolymerTargetFileBanner {...sessionProps} />

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-ink-200 bg-ink-50/60 p-3">
          <div className="flex items-center gap-2.5">
            <PolymerEnableToggle {...section} />
            <span
              className={clsx(
                "rounded-full px-2 py-0.5 text-[12px] font-semibold",
                live ? "bg-success-surface text-success-fg" : "bg-ink-200 text-ink-600",
              )}
            >
              {live ? "● Live On Spectrum" : "○ Off"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-ink-500">Active Polarity:</span>
            <span
              className={clsx(
                "rounded-full px-2.5 py-0.5 text-[12px] font-semibold uppercase tracking-wider",
                polarity === "all" ? "bg-warning-surface text-warning-fg" : "bg-ink-100 text-ink-700",
              )}
            >
              {polarity}
            </span>
          </div>
        </div>

        {disabled && (
          <div className="rounded-md border border-warning/40 bg-warning-surface p-3 text-xs text-warning-fg">
            Set polarity to Positive or Negative in LCMS settings to enable polymer matching.
          </div>
        )}

        <GroupBox title="Matching">
          <PolymerMatchingSettings {...section} />
          <PolymerPresetButton {...section} />
        </GroupBox>

        <div>
          <div className="mb-4 flex border-b border-ink-200">
            {SUB_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                aria-pressed={activeSubTab === tab.id}
                onClick={() => setActiveSubTab(tab.id)}
                className={clsx(
                  "-mb-px border-b-2 px-4 py-2 text-xs font-semibold transition-colors",
                  activeSubTab === tab.id
                    ? "border-brand-600 bg-surface text-brand-700"
                    : "border-transparent text-ink-500 hover:text-ink-800",
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {activeSubTab === "monomers" && <PolymerMonomerSettings {...section} />}
          {activeSubTab === "adducts" && <PolymerAdductSettings {...section} />}
          {activeSubTab === "masses" && (
            <div className="flex flex-col gap-4">
              <GroupBox title="Masses & charges">
                <PolymerMassSettings {...section} />
              </GroupBox>
              <GroupBox title="Variants">
                <PolymerVariantSettings {...section} />
              </GroupBox>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

// Export both names for backwards compatibility
export { PolymerStudioModal as PolymerStudioDrawer };
