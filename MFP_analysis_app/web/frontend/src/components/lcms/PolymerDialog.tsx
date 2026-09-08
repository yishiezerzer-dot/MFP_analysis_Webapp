import { useState } from "react";
import clsx from "clsx";
import {
  loadPolymerUiSettings,
  polymerMonomerText,
  type Polarity,
  type PolymerModeSettings,
  type PolymerMonomerCategory,
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

export function MonomerPresetBox({
  title,
  category,
  monomers,
  onChange,
}: {
  title: string;
  category: PolymerMonomerCategory;
  monomers: PolymerMonomerPreset[];
  onChange: (monomers: PolymerMonomerPreset[]) => void;
}) {
  const [name, setName] = useState("");
  const [abbr, setAbbr] = useState("");
  const [massText, setMassText] = useState("");
  const rows = monomers.filter((monomer) => monomer.category === category);
  const patchMonomer = (id: string, patch: Partial<PolymerMonomerPreset>) => {
    onChange(
      monomers.map((monomer) =>
        monomer.id === id ? { ...monomer, ...patch } : monomer,
      ),
    );
  };
  const addCustom = () => {
    const mass = parseFloat(massText);
    const cleanName = name.trim();
    const cleanAbbr = abbr.trim() || cleanName;
    if (!cleanName || !Number.isFinite(mass)) return;
    const slug = cleanName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    onChange([
      ...monomers,
      {
        id: `${category}:custom:${slug || "monomer"}:${Date.now()}`,
        category,
        name: cleanName,
        abbr: cleanAbbr,
        mass,
        selected: true,
        custom: true,
      },
    ]);
    setName("");
    setAbbr("");
    setMassText("");
  };
  return (
    <div className="rounded-md border border-ink-200 bg-surface p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-ink-500">
          {title}
        </div>
        <div className="text-xs text-ink-500">
          {rows.filter((monomer) => monomer.selected).length} selected
        </div>
      </div>
      <div className="max-h-56 overflow-auto rounded border border-ink-100">
        {rows.map((monomer) => (
          <div
            key={monomer.id}
            className="grid grid-cols-[minmax(0,1fr)_5rem_6rem_auto] items-center gap-2 border-b border-ink-100 px-2 py-1.5 last:border-b-0"
          >
            <label className="flex min-w-0 items-center gap-2">
              <input
                type="checkbox"
                checked={monomer.selected}
                onChange={(e) => patchMonomer(monomer.id, { selected: e.target.checked })}
              />
              <span className="min-w-0 truncate" title={monomer.name}>
                {monomer.name}
              </span>
            </label>
            <input
              className="input h-8 px-2 text-xs"
              value={monomer.abbr}
              title="Abbreviation used in labels"
              onChange={(e) => patchMonomer(monomer.id, { abbr: e.target.value })}
            />
            <span className="font-mono text-xs text-ink-500">
              {monomer.mass.toFixed(4)}
            </span>
            {monomer.custom ? (
              <button
                className="rounded px-1.5 py-0.5 text-xs text-ink-400 hover:bg-red-50 hover:text-red-600"
                onClick={() => onChange(monomers.filter((item) => item.id !== monomer.id))}
                title="Delete custom monomer"
              >
                x
              </button>
            ) : (
              <span className="w-4" />
            )}
          </div>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-[minmax(0,1fr)_5rem_6rem_auto] gap-2">
        <input
          className="input h-8 px-2 text-xs"
          placeholder="Custom name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          className="input h-8 px-2 text-xs"
          placeholder="Abbr"
          value={abbr}
          onChange={(e) => setAbbr(e.target.value)}
        />
        <input
          className="input h-8 px-2 text-xs"
          placeholder="Mass"
          type="number"
          step="0.000001"
          value={massText}
          onChange={(e) => setMassText(e.target.value)}
        />
        <button
          className="rounded-md border border-ink-200 bg-surface px-2 text-xs text-ink-700 hover:bg-ink-100 disabled:cursor-not-allowed disabled:opacity-60"
          onClick={addCustom}
          disabled={!name.trim() || !Number.isFinite(parseFloat(massText))}
        >
          Add
        </button>
      </div>
    </div>
  );
}

export function PolymerDialog({
  polarity,
  settings,
  onChange,
  onClose,
}: {
  polarity: Polarity;
  settings: PolymerUiSettings;
  onChange: (settings: PolymerUiSettings) => void;
  onClose: () => void;
}) {
  const activeMode = polarity === "negative" ? "negative" : "positive";
  const disabled = polarity === "all";
  const shared = settings.shared;
  const profile = settings[activeMode];
  const patchShared = (next: Partial<PolymerSharedSettings>) =>
    onChange({ ...settings, shared: { ...settings.shared, ...next } });
  const patchProfile = (next: Partial<PolymerModeSettings>) =>
    onChange({ ...settings, [activeMode]: { ...profile, ...next } });
  const patchMonomers = (monomers: PolymerMonomerPreset[]) => onChange({ ...settings, monomers });
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
    .slice(0, 6)
    .join(", ");
  return (
    <Modal
      title="Polymer / Reaction Match"
      onClose={onClose}
      footer={
        <>
          <button
            className="rounded-md border border-ink-200 bg-surface px-3 py-1.5 text-sm text-ink-700 hover:bg-ink-100"
            onClick={() => onChange(loadPolymerUiSettings())}
          >
            Reset
          </button>
          <button className="btn-primary" onClick={onClose} disabled={disabled}>
            Apply
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4 text-sm">
        {disabled && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">
            Choose Positive or Negative polarity before enabling polymer matching.
          </div>
        )}
        <label
          className={clsx(
            "flex items-center gap-2 text-sm text-ink-800",
            disabled && "opacity-60",
          )}
        >
          <input
            type="checkbox"
            checked={shared.enabled && !disabled}
            disabled={disabled}
            onChange={(e) => patchShared({ enabled: e.target.checked })}
          />
          <span>Enable polymer/reaction matching on spectrum</span>
        </label>
        {!disabled && (
          <div className="rounded-md border border-brand-200 bg-brand-50 px-3 py-2 text-xs text-brand-700">
            {polarity === "positive"
              ? "Positive mode: +H adduct mass with optional +Na/+K, water loss, and 2M clusters."
              : "Negative mode: -H adduct mass with optional +Cl/+HCOO/+Ac, water loss, and 2M clusters."}
          </div>
        )}
        {!disabled && (
          <button
            type="button"
            className="rounded-md border border-brand-200 bg-surface px-3 py-2 text-left text-xs text-brand-700 transition-colors hover:bg-brand-50"
            onClick={applySmallOligomerPreset}
          >
            Apply small-oligomer MS1 annotation preset
          </button>
        )}
        <GroupBox title="Monomers">
          <div className="rounded-md border border-ink-200 bg-ink-50/60 px-3 py-2 text-xs text-ink-600">
            Using: {selectedSummary || "no monomers selected"}
          </div>
          {!selectedSummary && (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Select at least one monomer below — adduct annotations are computed for compositions of the selected monomers.
            </div>
          )}
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
          <label className="block">
            <div className="label">Other</div>
            <textarea
              className="input mt-1 h-24 w-full font-mono"
              value={shared.monomers_text}
              placeholder={"PEG 44.0262\nCustom,123.4567"}
              onChange={(e) => patchShared({ monomers_text: e.target.value })}
            />
            <p className="mt-1 text-xs text-ink-500">
              Freeform monomers still work: one per line as name mass, name,mass, or mass.
            </p>
          </label>
        </GroupBox>

        <div className="grid grid-cols-2 gap-3">
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
            label="Cluster H adduct"
            value={profile.cluster_adduct_mass}
            step={0.000001}
            onChange={(value) =>
              patchProfile({ cluster_adduct_mass: value ?? profile.cluster_adduct_mass })
            }
          />
          <TextSetting
            label="Charges"
            value={shared.charges}
            onChange={(charges) => patchShared({ charges })}
          />
          <NumberSetting
            label="Max DP"
            value={shared.max_dp}
            min={1}
            max={200}
            step={1}
            onChange={(value) => patchShared({ max_dp: Math.max(1, value ?? shared.max_dp) })}
          />
          <NumberSetting
            label="Tolerance"
            value={shared.tol_value}
            min={0}
            step={0.001}
            onChange={(value) => patchShared({ tol_value: Math.max(0, value ?? shared.tol_value) })}
          />
          <SelectSetting
            label="Tolerance unit"
            value={shared.tol_unit}
            options={[
              { value: "Da", label: "Da" },
              { value: "ppm", label: "ppm" },
            ]}
            onChange={(tol_unit) => patchShared({ tol_unit: tol_unit as "Da" | "ppm" })}
          />
          <NumberSetting
            label="Min rel intensity"
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
          <GroupBox title={polarity === "negative" ? "Negative adducts" : "Positive adducts"}>
            <div className="grid grid-cols-2 gap-2">
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

        <GroupBox title="Variants">
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
        </GroupBox>
      </div>
    </Modal>
  );
}
