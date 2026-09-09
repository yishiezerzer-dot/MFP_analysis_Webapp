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
  const [customName, setCustomName] = useState("");
  const [customMass, setCustomMass] = useState("");
  const [customCharge, setCustomCharge] = useState("1");
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

  const handleAddCustomAdduct = () => {
    const trimmed = customName.trim();
    const massVal = parseFloat(customMass);
    const chargeVal = parseInt(customCharge, 10);
    if (!trimmed || !Number.isFinite(massVal)) return;
    const newAdduct = {
      id: `custom:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`,
      name: trimmed.startsWith("+") || trimmed.startsWith("-") ? trimmed : `+${trimmed}`,
      mass: massVal,
      charge: Number.isFinite(chargeVal) && chargeVal > 0 ? chargeVal : 1,
      enabled: true,
    };
    const existing = profile.custom_adducts ?? [];
    patchProfile({ custom_adducts: [...existing, newAdduct] });
    setCustomName("");
    setCustomMass("");
    setCustomCharge("1");
  };

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

            <GroupBox title="Custom Adducts">
              <div className="space-y-3">
                {/* List of active custom adducts */}
                {(profile.custom_adducts ?? []).length > 0 ? (
                  <div className="space-y-1.5 max-h-40 overflow-y-auto rounded-md border border-ink-200 bg-surface p-2">
                    {(profile.custom_adducts ?? []).map((adduct) => (
                      <div
                        key={adduct.id}
                        className="flex items-center justify-between gap-2 rounded px-2.5 py-1.5 bg-ink-50 hover:bg-ink-100/70 text-xs transition-colors"
                      >
                        <label className="flex items-center gap-2 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            className="rounded border-ink-300 text-brand-600 focus:ring-brand-500"
                            checked={adduct.enabled}
                            onChange={(e) => {
                              const updated = (profile.custom_adducts ?? []).map((a) =>
                                a.id === adduct.id ? { ...a, enabled: e.target.checked } : a,
                              );
                              patchProfile({ custom_adducts: updated });
                            }}
                          />
                          <span className="font-semibold text-ink-900">{adduct.name}</span>
                        </label>
                        <div className="flex items-center gap-3 text-ink-600">
                          <span className="font-mono text-xs">
                            {adduct.mass >= 0 ? `+${adduct.mass.toFixed(4)}` : adduct.mass.toFixed(4)} Da
                          </span>
                          <span className="rounded bg-ink-200/80 px-1.5 py-0.5 text-[10px] font-mono text-ink-800 font-medium">
                            z = {adduct.charge}
                          </span>
                          <button
                            type="button"
                            className="flex h-5 w-5 items-center justify-center rounded text-ink-400 hover:bg-rose-100 hover:text-rose-600 font-bold transition-colors"
                            title="Remove custom adduct"
                            onClick={() => {
                              const updated = (profile.custom_adducts ?? []).filter((a) => a.id !== adduct.id);
                              patchProfile({ custom_adducts: updated });
                            }}
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-ink-500 italic">
                    No custom adducts added yet. Use the inputs or presets below to add custom adducts with specific charge states.
                  </p>
                )}

                {/* Quick Presets */}
                <div className="flex items-center gap-1.5 flex-wrap text-[11px] text-ink-500">
                  <span className="font-medium text-ink-600">Quick presets:</span>
                  {(polarity === "negative"
                    ? [
                        { name: "TFA", mass: 112.9856, charge: 1 },
                        { name: "Br", mass: 78.9183, charge: 1 },
                        { name: "SO4", mass: 95.9517, charge: 2 },
                      ]
                    : [
                        { name: "NH4", mass: 18.0338, charge: 1 },
                        { name: "Li", mass: 6.941, charge: 1 },
                        { name: "Ca", mass: 39.9626, charge: 2 },
                        { name: "Mg", mass: 23.985, charge: 2 },
                      ]
                  ).map((p) => (
                    <button
                      key={p.name}
                      type="button"
                      className="rounded border border-ink-200 bg-surface px-2 py-0.5 text-[11px] text-ink-700 hover:bg-brand-50 hover:border-brand-300 hover:text-brand-700 transition-colors"
                      onClick={() => {
                        setCustomName(p.name);
                        setCustomMass(p.mass.toString());
                        setCustomCharge(p.charge.toString());
                      }}
                      title={`Fill ${p.name} (+${p.mass} Da, z=${p.charge})`}
                    >
                      +{p.name} ({p.mass} Da, z={p.charge})
                    </button>
                  ))}
                </div>

                {/* Add Custom Adduct Form */}
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-4 items-end rounded-md border border-ink-200 bg-surface p-2.5">
                  <div>
                    <label className="block text-[11px] font-medium text-ink-600">Adduct Name</label>
                    <input
                      type="text"
                      className="input h-7 w-full text-xs"
                      placeholder="e.g. NH4 or Ca"
                      value={customName}
                      onChange={(e) => setCustomName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleAddCustomAdduct();
                      }}
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-ink-600">Mass Delta (Da)</label>
                    <input
                      type="number"
                      step="0.0001"
                      className="input h-7 w-full text-xs"
                      placeholder="e.g. 18.0338"
                      value={customMass}
                      onChange={(e) => setCustomMass(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleAddCustomAdduct();
                      }}
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-ink-600">Charge State (z)</label>
                    <input
                      type="number"
                      min="1"
                      max="6"
                      step="1"
                      className="input h-7 w-full text-xs"
                      placeholder="1"
                      value={customCharge}
                      onChange={(e) => setCustomCharge(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleAddCustomAdduct();
                      }}
                    />
                  </div>
                  <button
                    type="button"
                    className="btn-primary h-7 text-xs whitespace-nowrap flex items-center justify-center disabled:opacity-50"
                    disabled={!customName.trim() || !Number.isFinite(parseFloat(customMass))}
                    onClick={handleAddCustomAdduct}
                  >
                    ➕ Add Adduct
                  </button>
                </div>
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
