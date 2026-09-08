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

export function PolymerStudioDrawer({
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
  spectrumAvailable,
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

  // Quick Preset Handlers
  const applyPlgaPreset = () => {
    const updated = settings.monomers.map((m) => {
      const isLa = m.name.toLowerCase().includes("lactic") || m.abbr === "LA";
      const isGa = m.name.toLowerCase().includes("glycolic") || m.abbr === "GA";
      return { ...m, selected: isLa || isGa };
    });
    onChange({
      ...settings,
      monomers: updated,
      shared: { ...settings.shared, enabled: true, h2o_loss: true, tol_unit: "ppm", tol_value: 10 },
      [activeMode]: {
        ...profile,
        ...(activeMode === "positive"
          ? { adduct_na: true, adduct_k: true }
          : { adduct_cl: true, adduct_formate: true }),
      },
    });
  };

  const applyPegPreset = () => {
    const pegId = "custom:preset:peg:44.0262";
    const existing = settings.monomers.find((m) => m.name === "PEG" || m.abbr === "EG");
    let monomers = settings.monomers.map((m) => ({ ...m, selected: false }));
    if (existing) {
      monomers = monomers.map((m) => (m.id === existing.id ? { ...m, selected: true } : m));
    } else {
      monomers = [
        ...monomers,
        {
          id: pegId,
          category: "hydroxy",
          name: "Ethylene Glycol (PEG)",
          abbr: "EG",
          mass: 44.0262,
          selected: true,
          custom: true,
        },
      ];
    }
    onChange({
      ...settings,
      monomers,
      shared: { ...settings.shared, enabled: true, h2o_loss: false, tol_unit: "ppm", tol_value: 10 },
      [activeMode]: {
        ...profile,
        ...(activeMode === "positive" ? { adduct_na: true, adduct_k: true } : { adduct_cl: true }),
      },
    });
  };

  const applyPclPreset = () => {
    const pclId = "custom:preset:pcl:114.0681";
    const existing = settings.monomers.find((m) => m.name === "Caprolactone" || m.abbr === "CL");
    let monomers = settings.monomers.map((m) => ({ ...m, selected: false }));
    if (existing) {
      monomers = monomers.map((m) => (m.id === existing.id ? { ...m, selected: true } : m));
    } else {
      monomers = [
        ...monomers,
        {
          id: pclId,
          category: "hydroxy",
          name: "Caprolactone",
          abbr: "CL",
          mass: 114.0681,
          selected: true,
          custom: true,
        },
      ];
    }
    onChange({
      ...settings,
      monomers,
      shared: { ...settings.shared, enabled: true, h2o_loss: true, tol_unit: "ppm", tol_value: 10 },
      [activeMode]: {
        ...profile,
        ...(activeMode === "positive" ? { adduct_na: true, adduct_k: true } : { adduct_cl: true }),
      },
    });
  };

  const applySmallOligomerPreset = () => {
    onChange({
      ...settings,
      shared: {
        ...settings.shared,
        enabled: true,
        h2o_loss: true,
        cluster: true,
        charges: settings.shared.charges || "1",
      },
      [activeMode]: {
        ...profile,
        ...(activeMode === "positive"
          ? { adduct_na: true, adduct_k: true }
          : { adduct_cl: true, adduct_formate: true, adduct_acetate: true }),
      },
    });
  };

  const selectedSummary = polymerMonomerText(settings)
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(0, 5)
    .join(", ");

  return (
    <aside
      aria-label="Polymer & Reaction Studio"
      className="flex w-96 shrink-0 flex-col border-l border-ink-200 bg-surface shadow-xl animate-in slide-in-from-right-5 duration-200"
    >
      {/* Drawer Header */}
      <div className="flex items-center justify-between border-b border-ink-200 px-4 py-3 bg-ink-50/50">
        <div className="flex items-center gap-2">
          <span className="text-base font-bold text-ink-900">🧬 Polymer Studio</span>
          <span
            className={clsx(
              "rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider",
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
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="rounded p-1 text-xs text-ink-500 hover:bg-ink-100 hover:text-ink-800"
            onClick={onSaveDefaults}
            title="Save current configuration as default"
          >
            💾 Save
          </button>
          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded-md text-ink-400 hover:bg-ink-100 hover:text-ink-700"
            onClick={onClose}
            title="Close drawer"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Main Enable & Quick Preset Bar */}
      <div className="border-b border-ink-200 p-3 bg-surface">
        <div className="flex items-center justify-between">
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
          <span className="text-[11px] text-brand-600 font-medium">
            {shared.enabled ? "● Live On Spectrum" : "○ Off"}
          </span>
        </div>

        {disabled && (
          <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800">
            Set polarity to Positive or Negative to enable polymer matching.
          </div>
        )}

        {/* 1-Click System Presets */}
        {!disabled && (
          <div className="mt-2.5">
            <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-ink-500">
              Quick Presets:
            </div>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                className="rounded-md border border-ink-200 bg-ink-50 px-2 py-1 text-xs font-medium text-ink-700 transition-colors hover:border-brand-500 hover:bg-brand-50 hover:text-brand-700"
                onClick={applyPlgaPreset}
                title="Select Lactic Acid + Glycolic Acid with standard adducts"
              >
                PLGA (LA+GA)
              </button>
              <button
                type="button"
                className="rounded-md border border-ink-200 bg-ink-50 px-2 py-1 text-xs font-medium text-ink-700 transition-colors hover:border-brand-500 hover:bg-brand-50 hover:text-brand-700"
                onClick={applyPegPreset}
                title="Select Ethylene Glycol / PEG 44.0262"
              >
                PEG
              </button>
              <button
                type="button"
                className="rounded-md border border-ink-200 bg-ink-50 px-2 py-1 text-xs font-medium text-ink-700 transition-colors hover:border-brand-500 hover:bg-brand-50 hover:text-brand-700"
                onClick={applyPclPreset}
                title="Select Caprolactone 114.0681"
              >
                PCL
              </button>
              <button
                type="button"
                className="rounded-md border border-brand-200 bg-brand-50/70 px-2 py-1 text-xs font-medium text-brand-700 transition-colors hover:bg-brand-100"
                onClick={applySmallOligomerPreset}
                title="Enable H2O loss, clusters, and common adducts"
              >
                + Oligomer Rules
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Navigation Sub-Tabs */}
      <div className="flex border-b border-ink-200 bg-ink-50/70 px-3">
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
              "-mb-px border-b-2 px-3 py-2 text-xs font-medium transition-colors",
              activeSubTab === tab.id
                ? "border-brand-500 text-brand-700 font-semibold"
                : "border-transparent text-ink-500 hover:text-ink-800",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Drawer Body */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3.5">
        {activeSubTab === "monomers" && (
          <div className="space-y-3">
            <div className="rounded-md border border-ink-200 bg-ink-50/60 px-2.5 py-1.5 text-xs text-ink-600">
              <span className="font-semibold text-ink-800">Active: </span>
              {selectedSummary || <span className="italic text-amber-700">None selected</span>}
            </div>

            <MonomerPresetBox
              title="Known hydroxy acids"
              category="hydroxy"
              monomers={settings.monomers}
              onChange={patchMonomers}
            />

            <MonomerPresetBox
              title="Amino acids"
              category="amino"
              monomers={settings.monomers}
              onChange={patchMonomers}
            />

            <div className="rounded-md border border-ink-200 bg-surface p-2.5">
              <div className="text-xs font-semibold uppercase tracking-wide text-ink-500 mb-1">
                Custom Text Monomers
              </div>
              <textarea
                className="input h-16 w-full font-mono text-xs"
                value={shared.monomers_text}
                placeholder={"PEG 44.0262\nCustom,123.4567"}
                onChange={(e) => patchShared({ monomers_text: e.target.value })}
              />
              <p className="mt-1 text-[11px] text-ink-400">
                Format: name mass (one per line).
              </p>
            </div>
          </div>
        )}

        {activeSubTab === "parameters" && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <NumberSetting
                label="Tolerance"
                value={shared.tol_value}
                min={0}
                step={0.001}
                onChange={(value) => patchShared({ tol_value: Math.max(0, value ?? shared.tol_value) })}
              />
              <SelectSetting
                label="Unit"
                value={shared.tol_unit}
                options={[
                  { value: "ppm", label: "ppm" },
                  { value: "Da", label: "Da" },
                ]}
                onChange={(tol_unit) => patchShared({ tol_unit: tol_unit as "Da" | "ppm" })}
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <NumberSetting
                label="Max DP"
                value={shared.max_dp}
                min={1}
                max={200}
                step={1}
                onChange={(value) => patchShared({ max_dp: Math.max(1, value ?? shared.max_dp) })}
              />
              <NumberSetting
                label="Min Rel Int"
                value={shared.min_rel_int}
                min={0}
                max={1}
                step={0.01}
                onChange={(value) =>
                  patchShared({ min_rel_int: Math.max(0, Math.min(1, value ?? shared.min_rel_int)) })
                }
              />
            </div>

            {!disabled && (
              <GroupBox title={polarity === "negative" ? "Negative Adducts" : "Positive Adducts"}>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {polarity === "negative" ? (
                    <>
                      <Check
                        label="+Cl"
                        checked={profile.adduct_cl}
                        onChange={(adduct_cl) => patchProfile({ adduct_cl })}
                      />
                      <Check
                        label="+HCOO"
                        checked={profile.adduct_formate}
                        onChange={(adduct_formate) => patchProfile({ adduct_formate })}
                      />
                      <Check
                        label="+Ac"
                        checked={profile.adduct_acetate}
                        onChange={(adduct_acetate) => patchProfile({ adduct_acetate })}
                      />
                    </>
                  ) : (
                    <>
                      <Check
                        label="+Na"
                        checked={profile.adduct_na}
                        onChange={(adduct_na) => patchProfile({ adduct_na })}
                      />
                      <Check
                        label="+K"
                        checked={profile.adduct_k}
                        onChange={(adduct_k) => patchProfile({ adduct_k })}
                      />
                    </>
                  )}
                </div>
              </GroupBox>
            )}

            <GroupBox title="Reaction & Ion Variants">
              <div className="space-y-1.5 text-xs">
                <Check
                  label="Water loss (-H2O)"
                  checked={shared.h2o_loss}
                  onChange={(h2o_loss) => patchShared({ h2o_loss })}
                />
                <Check
                  label="Decarboxylation (-CO2)"
                  checked={shared.decarb}
                  onChange={(decarb) => patchShared({ decarb })}
                />
                <Check
                  label="Oxidation (+O)"
                  checked={shared.oxid}
                  onChange={(oxid) => patchShared({ oxid })}
                />
                <Check
                  label={polarity === "negative" ? "Noncovalent dimers (2M-H)" : "Noncovalent dimers (2M+H)"}
                  checked={shared.cluster}
                  onChange={(cluster) => patchShared({ cluster })}
                />
              </div>
            </GroupBox>
          </div>
        )}

        {activeSubTab === "advanced" && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <NumberSetting
                label="Per-bond delta"
                value={shared.bond_delta}
                step={0.000001}
                onChange={(value) => patchShared({ bond_delta: value ?? shared.bond_delta })}
              />
              <NumberSetting
                label="Extra delta"
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
                label="Cluster adduct"
                value={profile.cluster_adduct_mass}
                step={0.000001}
                onChange={(value) =>
                  patchProfile({ cluster_adduct_mass: value ?? profile.cluster_adduct_mass })
                }
              />
            </div>
            <TextSetting
              label="Allowed Charges"
              value={shared.charges}
              onChange={(charges) => patchShared({ charges })}
            />
            <button
              type="button"
              className="mt-2 w-full rounded-md border border-ink-200 bg-surface px-3 py-1.5 text-xs text-ink-600 hover:bg-ink-100"
              onClick={() => onChange(loadPolymerUiSettings())}
            >
              Reset to Factory Defaults
            </button>
          </div>
        )}
      </div>

      {/* Integrated Analysis Tools Footer */}
      <div className="border-t border-ink-200 p-3 bg-ink-50/50 space-y-2">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">
          Integrated Polymer Views:
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            className="flex items-center justify-center gap-1.5 rounded-lg border border-ink-200 bg-surface px-2.5 py-1.5 text-xs font-semibold text-ink-700 shadow-sm transition-colors hover:bg-brand-50 hover:border-brand-300 hover:text-brand-700 disabled:cursor-not-allowed disabled:opacity-40"
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
            className="flex items-center justify-center gap-1.5 rounded-lg border border-ink-200 bg-surface px-2.5 py-1.5 text-xs font-semibold text-ink-700 shadow-sm transition-colors hover:bg-brand-50 hover:border-brand-300 hover:text-brand-700 disabled:cursor-not-allowed disabled:opacity-40"
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
        </div>
      </div>
    </aside>
  );
}
