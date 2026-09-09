import { useState } from "react";
import clsx from "clsx";
import {
  loadPolymerUiSettings,
  polymerMonomerText,
  type Polarity,
  type PolymerModeSettings,
  type PolymerMonomerPreset,
  type PolymerSharedSettings,
  type PolymerUiSettings,
} from "../../lcms/analysis";
import {
  Check,
  GroupBox,
  Modal,
  NumberSetting,
  SelectSetting,
  TextSetting,
} from "./DialogControls";
import { MonomerPresetBox } from "./PolymerDialog";

export interface PolymerStudioDrawerProps {
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
}: PolymerStudioDrawerProps) {
  const [activeSubTab, setActiveSubTab] = useState<"monomers" | "parameters" | "advanced">("monomers");
  const activeMode = polarity === "negative" ? "negative" : "positive";
  const disabled = polarity === "all";
  const shared = settings.shared;
  const profile = settings[activeMode];

  if (!open) return null;

  const patchShared = (next: Partial<PolymerSharedSettings>) =>
    onChange({ ...settings, shared: { ...settings.shared, ...next } });

  const patchProfile = (next: Partial<PolymerModeSettings>) =>
    onChange({ ...settings, [activeMode]: { ...profile, ...next } });

  const patchMonomers = (monomers: PolymerMonomerPreset[]) =>
    onChange({ ...settings, monomers });

  const selectedSummary = polymerMonomerText(settings)
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(0, 5)
    .join(", ");

  const modalFooter = (
    <div className="flex w-full flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="rounded-md border border-ink-200 bg-surface px-3 py-1.5 text-xs text-ink-700 hover:bg-ink-100"
          onClick={onSaveDefaults}
          title="Save current configuration as default"
        >
          💾 Save as Defaults
        </button>
        <button
          type="button"
          className="rounded-md border border-ink-200 bg-surface px-3 py-1.5 text-xs text-ink-600 hover:bg-ink-100"
          onClick={() => onChange(loadPolymerUiSettings())}
          title="Reset all settings to original factory defaults"
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
          <span>📋</span>
          <span>Expected Series</span>
        </button>
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-lg border border-brand-200 bg-brand-50 px-3 py-1.5 text-xs font-semibold text-brand-700 shadow-sm transition-colors hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-40"
          onClick={onKendrick}
          disabled={!canOpenKendrick}
          title={
            canOpenKendrick
              ? "Open Kendrick Mass Defect (KMD) plot for current spectrum"
              : "Load an MS1 spectrum first"
          }
        >
          <span>📈</span>
          <span>Kendrick Plot</span>
        </button>
        <button type="button" className="btn-primary text-xs" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );

  return (
    <Modal
      title={`🧬 Polymer Studio (${polarity})`}
      onClose={onClose}
      width="max-w-3xl"
      footer={modalFooter}
    >
      {/* Polarity & Live Status Header Banner */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-ink-200 bg-ink-50/60 p-3">
        <div className="flex items-center gap-2.5">
          <label
            className={clsx(
              "flex items-center gap-2 text-xs font-semibold text-ink-900 cursor-pointer select-none",
              disabled && "opacity-50 cursor-not-allowed",
            )}
          >
            <input
              type="checkbox"
              className="rounded border-ink-300 text-brand-600 focus:ring-brand-500"
              checked={shared.enabled && !disabled}
              disabled={disabled}
              onChange={(e) => patchShared({ enabled: e.target.checked })}
            />
            <span>Enable Spectrum Matching</span>
          </label>
          <span
            className={clsx(
              "rounded-full px-2 py-0.5 text-[11px] font-semibold",
              shared.enabled
                ? "bg-emerald-100 text-emerald-800"
                : "bg-ink-200 text-ink-600",
            )}
          >
            {shared.enabled ? "● Live On Spectrum" : "○ Off"}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-ink-500">Active Polarity:</span>
          <span
            className={clsx(
              "rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider",
              polarity === "positive"
                ? "bg-sky-100 text-sky-800"
                : polarity === "negative"
                  ? "bg-rose-100 text-rose-800"
                  : "bg-amber-100 text-amber-800",
            )}
          >
            {polarity}
          </span>
        </div>
      </div>

      {disabled && (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          Set polarity to Positive or Negative in LCMS settings to enable polymer matching.
        </div>
      )}

      {/* Navigation Sub-Tabs */}
      <div className="mb-4 flex border-b border-ink-200">
        {(
          [
            { id: "monomers", label: "Monomers" },
            { id: "parameters", label: "Adducts & Tol" },
            { id: "advanced", label: "Advanced" },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveSubTab(tab.id)}
            className={clsx(
              "-mb-px border-b-2 px-4 py-2 text-xs font-semibold transition-colors",
              activeSubTab === tab.id
                ? "border-brand-600 text-brand-700 bg-surface"
                : "border-transparent text-ink-500 hover:text-ink-800",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Sub-Tab Content */}
      <div className="space-y-4">
        {activeSubTab === "monomers" && (
          <div className="space-y-4">
            {selectedSummary ? (
              <div className="rounded-md border border-brand-100 bg-brand-50/40 p-2.5 text-xs text-brand-900">
                <span className="font-semibold">Selected:</span> {selectedSummary}
              </div>
            ) : (
              <div className="rounded-md border border-ink-200 bg-ink-50/50 p-2.5 text-xs text-ink-500">
                No monomers selected yet. Check boxes below to match against spectrum.
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <MonomerPresetBox
                title="Known Hydroxy Acids"
                category="hydroxy"
                monomers={settings.monomers}
                onChange={patchMonomers}
              />
              <MonomerPresetBox
                title="Known Amino Acids"
                category="amino"
                monomers={settings.monomers}
                onChange={patchMonomers}
              />
            </div>

            <label className="block rounded-md border border-ink-200 bg-surface p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-ink-500">
                Custom / Freeform Monomers
              </div>
              <textarea
                className="input mt-1.5 h-20 w-full font-mono text-xs"
                value={shared.monomers_text}
                placeholder={"PEG 44.0262\nCustom,123.4567"}
                onChange={(e) => patchShared({ monomers_text: e.target.value })}
              />
              <p className="mt-1 text-[11px] text-ink-500">
                Custom monomers: enter one per line as &quot;Name Mass&quot;, &quot;Name,Mass&quot;, or &quot;Mass&quot;.
              </p>
            </label>
          </div>
        )}

        {activeSubTab === "parameters" && (
          <div className="space-y-4">
            <GroupBox title="Tolerance">
              <div className="grid grid-cols-2 gap-3">
                <SelectSetting
                  label="Tolerance unit"
                  value={shared.tol_unit}
                  options={[
                    { value: "ppm", label: "ppm" },
                    { value: "Da", label: "Da" },
                  ]}
                  onChange={(val) => patchShared({ tol_unit: val as "ppm" | "Da" })}
                />
                <NumberSetting
                  label="Tolerance value"
                  value={shared.tol_value}
                  step={shared.tol_unit === "ppm" ? 1 : 0.001}
                  onChange={(val) => patchShared({ tol_value: val ?? shared.tol_value })}
                />
              </div>
            </GroupBox>

            <GroupBox title={polarity === "negative" ? "Negative Adducts" : "Positive Adducts"}>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {polarity === "negative" ? (
                  <>
                    <Check
                      label="+Cl⁻ (Chlorine)"
                      checked={profile.adduct_cl}
                      onChange={(adduct_cl) => patchProfile({ adduct_cl })}
                    />
                    <Check
                      label="+HCOO⁻ (Formate)"
                      checked={profile.adduct_formate}
                      onChange={(adduct_formate) => patchProfile({ adduct_formate })}
                    />
                    <Check
                      label="+CH₃COO⁻ (Acetate)"
                      checked={profile.adduct_acetate}
                      onChange={(adduct_acetate) => patchProfile({ adduct_acetate })}
                    />
                  </>
                ) : (
                  <>
                    <Check
                      label="+Na⁺ (Sodium)"
                      checked={profile.adduct_na}
                      onChange={(adduct_na) => patchProfile({ adduct_na })}
                    />
                    <Check
                      label="+K⁺ (Potassium)"
                      checked={profile.adduct_k}
                      onChange={(adduct_k) => patchProfile({ adduct_k })}
                    />
                  </>
                )}
              </div>
            </GroupBox>
          </div>
        )}

        {activeSubTab === "advanced" && (
          <div className="space-y-4">
            <GroupBox title="Chemical Variations & Neutral Losses">
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                <Check
                  label="Water loss (-H₂O)"
                  checked={shared.h2o_loss}
                  onChange={(h2o_loss) => patchShared({ h2o_loss })}
                />
                <Check
                  label="Decarboxylation (-CO₂)"
                  checked={shared.decarb}
                  onChange={(decarb) => patchShared({ decarb })}
                />
                <Check
                  label="Oxidation (+O)"
                  checked={shared.oxid}
                  onChange={(oxid) => patchShared({ oxid })}
                />
                <Check
                  label={polarity === "negative" ? "Noncovalent dimers (2M-H)⁻" : "Noncovalent dimers (2M+H)⁺"}
                  checked={shared.cluster}
                  onChange={(cluster) => patchShared({ cluster })}
                />
              </div>
            </GroupBox>

            <GroupBox title="Mass Calibration & Allowed Charges">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <NumberSetting
                  label="Extra delta (Da)"
                  value={shared.extra_delta}
                  step={0.000001}
                  onChange={(value) => patchShared({ extra_delta: value ?? shared.extra_delta })}
                />
                <NumberSetting
                  label={polarity === "negative" ? "-H adduct mass" : "+H adduct mass"}
                  value={profile.adduct_mass}
                  step={0.000001}
                  onChange={(value) => patchProfile({ adduct_mass: value ?? profile.adduct_mass })}
                />
                <NumberSetting
                  label="Cluster adduct mass"
                  value={profile.cluster_adduct_mass}
                  step={0.000001}
                  onChange={(value) =>
                    patchProfile({ cluster_adduct_mass: value ?? profile.cluster_adduct_mass })
                  }
                />
              </div>
              <div className="mt-3">
                <TextSetting
                  label="Allowed Charge States (comma-separated, e.g. 1, 2)"
                  value={shared.charges}
                  onChange={(charges) => patchShared({ charges })}
                />
              </div>
            </GroupBox>
          </div>
        )}
      </div>
    </Modal>
  );
}

// Export both names for backwards compatibility
export { PolymerStudioModal as PolymerStudioDrawer };
