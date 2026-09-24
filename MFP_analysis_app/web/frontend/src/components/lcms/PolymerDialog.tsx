import { useState, type KeyboardEvent } from "react";
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

// The Polymer Match dialog and the Polymer Studio both render these sections, so every setting
// is editable in both places.
export interface PolymerSectionProps {
  polarity: Polarity;
  settings: PolymerUiSettings;
  onChange: (settings: PolymerUiSettings) => void;
}

function polymerPatchers({ polarity, settings, onChange }: PolymerSectionProps) {
  const mode: "positive" | "negative" = polarity === "negative" ? "negative" : "positive";
  const profile = settings[mode];
  return {
    mode,
    shared: settings.shared,
    profile,
    patchShared: (next: Partial<PolymerSharedSettings>) =>
      onChange({ ...settings, shared: { ...settings.shared, ...next } }),
    patchProfile: (next: Partial<PolymerModeSettings>) =>
      onChange({ ...settings, [mode]: { ...profile, ...next } }),
  };
}

export interface PolymerSessionProps {
  sessions?: Array<{ session_id: string; display_name: string }>;
  activeSessionId?: string | null;
  onSelectSession?: (sessionId: string) => void;
  onCopyFromSession?: (fromSessionId: string) => void;
  onApplyToAllSessions?: () => void;
}

export function PolymerTargetFileBanner({
  sessions,
  activeSessionId,
  onSelectSession,
  onCopyFromSession,
  onApplyToAllSessions,
}: PolymerSessionProps) {
  if (!sessions || sessions.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-brand-200 bg-brand-50/50 p-2.5 shadow-2xs">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-brand-900">Target File:</span>
        {sessions.length > 1 && onSelectSession ? (
          <select
            aria-label="Target File"
            value={activeSessionId ?? ""}
            onChange={(e) => onSelectSession(e.target.value)}
            className="rounded-md border border-brand-300 bg-surface px-2.5 py-1 text-xs font-semibold text-ink-800 shadow-2xs focus:border-brand-500 focus:outline-none"
          >
            {sessions.map((s) => (
              <option key={s.session_id} value={s.session_id}>
                {s.display_name}
              </option>
            ))}
          </select>
        ) : (
          <span className="rounded-md border border-brand-200 bg-surface px-2.5 py-1 text-xs font-semibold text-ink-800 shadow-2xs">
            {sessions.find((s) => s.session_id === activeSessionId)?.display_name ?? "Default File"}
          </span>
        )}
        <span className="text-[11px] font-medium text-brand-700">(Settings apply to this mzML)</span>
      </div>
      {sessions.length > 1 && (
        <div className="flex items-center gap-2">
          {onCopyFromSession && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-ink-600">Copy from:</span>
              <select
                aria-label="Copy from file"
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value) {
                    onCopyFromSession(e.target.value);
                    e.target.value = "";
                  }
                }}
                className="rounded-md border border-ink-300 bg-surface px-2 py-1 text-xs text-ink-700 shadow-2xs hover:border-ink-400 focus:outline-none"
              >
                <option value="" disabled>
                  Select file...
                </option>
                {sessions
                  .filter((s) => s.session_id !== activeSessionId)
                  .map((s) => (
                    <option key={s.session_id} value={s.session_id}>
                      {s.display_name}
                    </option>
                  ))}
              </select>
            </div>
          )}
          {onApplyToAllSessions && (
            <button
              type="button"
              onClick={onApplyToAllSessions}
              className="rounded-md border border-brand-300 bg-surface px-2.5 py-1 text-xs font-medium text-brand-700 shadow-2xs transition-colors hover:bg-brand-100/60"
              title="Apply this file's polymer settings to all open mzML files"
            >
              ⚡ Apply to all open files
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function PolymerEnableToggle(props: PolymerSectionProps) {
  const { shared, patchShared } = polymerPatchers(props);
  const disabled = props.polarity === "all";
  return (
    <label className={clsx("flex items-center gap-2 text-sm font-semibold text-ink-800", disabled && "opacity-60")}>
      <input
        type="checkbox"
        checked={shared.enabled && !disabled}
        disabled={disabled}
        onChange={(e) => patchShared({ enabled: e.target.checked })}
      />
      <span>Enable polymer matching on spectrum</span>
    </label>
  );
}

export function PolymerMatchingSettings(props: PolymerSectionProps) {
  const { shared, patchShared } = polymerPatchers(props);
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <NumberSetting
        label="Tolerance"
        value={shared.tol_value}
        min={0}
        step={shared.tol_unit === "ppm" ? 1 : 0.001}
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
        label="Max DP"
        value={shared.max_dp}
        min={1}
        max={200}
        step={1}
        onChange={(value) => patchShared({ max_dp: Math.max(1, value ?? shared.max_dp) })}
      />
      <NumberSetting
        label="Min rel intensity"
        value={shared.min_rel_int}
        min={0}
        max={1}
        step={0.01}
        onChange={(value) => patchShared({ min_rel_int: Math.max(0, Math.min(1, value ?? shared.min_rel_int)) })}
      />
    </div>
  );
}

export function PolymerPresetButton(props: PolymerSectionProps) {
  const { mode, profile } = polymerPatchers(props);
  if (props.polarity === "all") return null;
  return (
    <button
      type="button"
      className="self-start rounded-md border border-brand-200 bg-surface px-3 py-1.5 text-left text-xs text-brand-700 transition-colors hover:bg-brand-50"
      title={
        mode === "positive"
          ? "Turns on matching, +Na, +K, water loss and 2M clusters"
          : "Turns on matching, +Cl, +HCOO, +Ac, water loss and 2M clusters"
      }
      onClick={() =>
        props.onChange({
          ...props.settings,
          shared: {
            ...props.settings.shared,
            enabled: true,
            h2o_loss: true,
            cluster: true,
            charges: props.settings.shared.charges || "1",
          },
          [mode]: {
            ...profile,
            ...(mode === "positive"
              ? { adduct_na: true, adduct_k: true }
              : { adduct_cl: true, adduct_formate: true, adduct_acetate: true }),
          },
        })
      }
    >
      Apply small-oligomer MS1 annotation preset
    </button>
  );
}

export function PolymerMonomerSettings({ wide, ...props }: PolymerSectionProps & { wide?: boolean }) {
  const { shared, patchShared } = polymerPatchers(props);
  const patchMonomers = (monomers: PolymerMonomerPreset[]) => props.onChange({ ...props.settings, monomers });
  const selectedSummary = polymerMonomerText(props.settings)
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(0, 6)
    .join(", ");
  return (
    <div className="flex flex-col gap-3">
      {selectedSummary ? (
        <div className="rounded-md border border-brand-100 bg-brand-50/40 px-3 py-2 text-xs text-brand-900">
          <span className="font-semibold">Using:</span> {selectedSummary}
        </div>
      ) : (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Select at least one monomer below — adduct annotations are computed for compositions of the selected
          monomers.
        </div>
      )}
      <div className={clsx("grid grid-cols-1 gap-3", wide && "lg:grid-cols-2")}>
        <MonomerPresetBox title="Known hydroxy acids" category="hydroxy" monomers={props.settings.monomers} onChange={patchMonomers} />
        <MonomerPresetBox title="Amino acids" category="amino" monomers={props.settings.monomers} onChange={patchMonomers} />
      </div>
      <label className="block">
        <div className="label">Other monomers</div>
        <textarea
          className="input mt-1 h-20 w-full font-mono text-xs"
          value={shared.monomers_text}
          placeholder={"PEG 44.0262\nCustom,123.4567"}
          onChange={(e) => patchShared({ monomers_text: e.target.value })}
        />
      </label>
      <p className="-mt-2 text-xs text-ink-500">One per line as &quot;Name Mass&quot;, &quot;Name,Mass&quot; or &quot;Mass&quot;.</p>
    </div>
  );
}

const CUSTOM_ADDUCT_PRESETS = {
  positive: [
    { name: "NH4", mass: 18.0338, charge: 1 },
    { name: "Li", mass: 6.941, charge: 1 },
    { name: "Ca", mass: 39.9626, charge: 2 },
    { name: "Mg", mass: 23.985, charge: 2 },
  ],
  negative: [
    { name: "TFA", mass: 112.9856, charge: 1 },
    { name: "Br", mass: 78.9183, charge: 1 },
    { name: "SO4", mass: 95.9517, charge: 2 },
  ],
};

export function PolymerAdductSettings(props: PolymerSectionProps) {
  const { mode, profile, patchProfile } = polymerPatchers(props);
  const [customName, setCustomName] = useState("");
  const [customMass, setCustomMass] = useState("");
  const [customCharge, setCustomCharge] = useState("1");
  const customAdducts = profile.custom_adducts ?? [];
  const addCustomAdduct = () => {
    const trimmed = customName.trim();
    const mass = parseFloat(customMass);
    const charge = parseInt(customCharge, 10);
    if (!trimmed || !Number.isFinite(mass)) return;
    patchProfile({
      custom_adducts: [
        ...customAdducts,
        {
          id: `custom:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`,
          name: trimmed.startsWith("+") || trimmed.startsWith("-") ? trimmed : `+${trimmed}`,
          mass,
          charge: Number.isFinite(charge) && charge > 0 ? charge : 1,
          enabled: true,
        },
      ],
    });
    setCustomName("");
    setCustomMass("");
    setCustomCharge("1");
  };
  const onEnter = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") addCustomAdduct();
  };
  return (
    <div className="flex flex-col gap-4">
      <GroupBox title={mode === "negative" ? "Negative adducts" : "Positive adducts"}>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {mode === "negative" ? (
            <>
              <Check label="+Cl⁻ (Chloride)" checked={profile.adduct_cl} onChange={(adduct_cl) => patchProfile({ adduct_cl })} />
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
              <Check label="+Na⁺ (Sodium)" checked={profile.adduct_na} onChange={(adduct_na) => patchProfile({ adduct_na })} />
              <Check label="+K⁺ (Potassium)" checked={profile.adduct_k} onChange={(adduct_k) => patchProfile({ adduct_k })} />
            </>
          )}
        </div>
      </GroupBox>

      <GroupBox title="Custom adducts">
        {customAdducts.length > 0 ? (
          <div className="max-h-40 space-y-1.5 overflow-y-auto rounded-md border border-ink-200 bg-surface p-2">
            {customAdducts.map((adduct) => (
              <div
                key={adduct.id}
                className="flex items-center justify-between gap-2 rounded bg-ink-50 px-2.5 py-1.5 text-xs transition-colors hover:bg-ink-100/70"
              >
                <label className="flex cursor-pointer select-none items-center gap-2">
                  <input
                    type="checkbox"
                    checked={adduct.enabled}
                    onChange={(e) =>
                      patchProfile({
                        custom_adducts: customAdducts.map((a) =>
                          a.id === adduct.id ? { ...a, enabled: e.target.checked } : a,
                        ),
                      })
                    }
                  />
                  <span className="font-semibold text-ink-900">{adduct.name}</span>
                </label>
                <div className="flex items-center gap-3 text-ink-600">
                  <span className="font-mono text-xs">
                    {adduct.mass >= 0 ? `+${adduct.mass.toFixed(4)}` : adduct.mass.toFixed(4)} Da
                  </span>
                  <span className="rounded bg-ink-200/80 px-1.5 py-0.5 font-mono text-[10px] font-medium text-ink-800">
                    z = {adduct.charge}
                  </span>
                  <button
                    type="button"
                    className="flex min-h-6 min-w-6 items-center justify-center rounded font-bold text-ink-400 transition-colors hover:bg-rose-100 hover:text-rose-600"
                    title="Remove custom adduct"
                    aria-label={`Remove custom adduct ${adduct.name}`}
                    onClick={() => patchProfile({ custom_adducts: customAdducts.filter((a) => a.id !== adduct.id) })}
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs italic text-ink-500">No custom adducts yet. Add one below or pick a preset.</p>
        )}
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-ink-500">
          <span className="font-medium text-ink-600">Presets:</span>
          {CUSTOM_ADDUCT_PRESETS[mode].map((p) => (
            <button
              key={p.name}
              type="button"
              className="min-h-6 rounded border border-ink-200 bg-surface px-2 py-0.5 text-[11px] text-ink-700 transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700"
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
        <div className="grid grid-cols-1 items-end gap-2 rounded-md border border-ink-200 bg-surface p-2.5 sm:grid-cols-4">
          <label className="block text-[11px] font-medium text-ink-600">
            Adduct name
            <input
              type="text"
              className="input h-7 w-full text-xs"
              placeholder="e.g. NH4 or Ca"
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              onKeyDown={onEnter}
            />
          </label>
          <label className="block text-[11px] font-medium text-ink-600">
            Mass delta (Da)
            <input
              type="number"
              step="0.0001"
              className="input h-7 w-full text-xs"
              placeholder="e.g. 18.0338"
              value={customMass}
              onChange={(e) => setCustomMass(e.target.value)}
              onKeyDown={onEnter}
            />
          </label>
          <label className="block text-[11px] font-medium text-ink-600">
            Charge state (z)
            <input
              type="number"
              min="1"
              max="6"
              step="1"
              className="input h-7 w-full text-xs"
              placeholder="1"
              value={customCharge}
              onChange={(e) => setCustomCharge(e.target.value)}
              onKeyDown={onEnter}
            />
          </label>
          <button
            type="button"
            className="btn-primary flex h-7 items-center justify-center whitespace-nowrap text-xs disabled:opacity-50"
            disabled={!customName.trim() || !Number.isFinite(parseFloat(customMass))}
            onClick={addCustomAdduct}
          >
            ➕ Add adduct
          </button>
        </div>
      </GroupBox>
    </div>
  );
}

export function PolymerMassSettings(props: PolymerSectionProps) {
  const { mode, shared, profile, patchShared, patchProfile } = polymerPatchers(props);
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <NumberSetting
        label="Per-bond delta (Da)"
        value={shared.bond_delta}
        step={0.000001}
        onChange={(value) => patchShared({ bond_delta: value ?? shared.bond_delta })}
      />
      <NumberSetting
        label="Extra delta (Da)"
        value={shared.extra_delta}
        step={0.000001}
        onChange={(value) => patchShared({ extra_delta: value ?? shared.extra_delta })}
      />
      <NumberSetting
        label={mode === "negative" ? "-H adduct mass" : "+H adduct mass"}
        value={profile.adduct_mass}
        step={0.000001}
        onChange={(value) => patchProfile({ adduct_mass: value ?? profile.adduct_mass })}
      />
      <NumberSetting
        label="Cluster adduct mass"
        value={profile.cluster_adduct_mass}
        step={0.000001}
        onChange={(value) => patchProfile({ cluster_adduct_mass: value ?? profile.cluster_adduct_mass })}
      />
      <TextSetting
        label="Allowed charge states (e.g. 1, 2)"
        value={shared.charges}
        onChange={(charges) => patchShared({ charges })}
      />
    </div>
  );
}

export function PolymerVariantSettings(props: PolymerSectionProps) {
  const { mode, shared, patchShared } = polymerPatchers(props);
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      <Check label="Water loss (-H₂O)" checked={shared.h2o_loss} onChange={(h2o_loss) => patchShared({ h2o_loss })} />
      <Check label="Decarboxylation (-CO₂)" checked={shared.decarb} onChange={(decarb) => patchShared({ decarb })} />
      <Check label="Oxidation (+O)" checked={shared.oxid} onChange={(oxid) => patchShared({ oxid })} />
      <Check
        label={mode === "negative" ? "Noncovalent dimers (2M-H)⁻" : "Noncovalent dimers (2M+H)⁺"}
        checked={shared.cluster}
        onChange={(cluster) => patchShared({ cluster })}
      />
    </div>
  );
}

export function PolymerDialog({
  polarity,
  settings,
  onChange,
  onClose,
  ...sessionProps
}: PolymerSectionProps & PolymerSessionProps & { onClose: () => void }) {
  const disabled = polarity === "all";
  const section = { polarity, settings, onChange };
  return (
    <Modal
      title="Polymer / Reaction Match"
      onClose={onClose}
      width="max-w-2xl"
      footer={
        <>
          <button
            className="rounded-md border border-ink-200 bg-surface px-3 py-1.5 text-sm text-ink-700 hover:bg-ink-100"
            title="Reset to your saved defaults (factory defaults if none are saved)"
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
        <PolymerTargetFileBanner {...sessionProps} />
        {disabled && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">
            Choose Positive or Negative polarity before enabling polymer matching.
          </div>
        )}
        <PolymerEnableToggle {...section} />
        {!disabled && (
          <div className="rounded-md border border-brand-200 bg-brand-50 px-3 py-2 text-xs text-brand-700">
            {polarity === "negative"
              ? "Negative mode: -H adduct mass with optional +Cl/+HCOO/+Ac, water loss, and 2M clusters."
              : "Positive mode: +H adduct mass with optional +Na/+K, water loss, and 2M clusters."}
          </div>
        )}
        <PolymerPresetButton {...section} />
        <GroupBox title="Matching">
          <PolymerMatchingSettings {...section} />
        </GroupBox>
        <GroupBox title="Monomers">
          <PolymerMonomerSettings {...section} />
        </GroupBox>
        {!disabled && <PolymerAdductSettings {...section} />}
        <GroupBox title="Masses & charges">
          <PolymerMassSettings {...section} />
        </GroupBox>
        <GroupBox title="Variants">
          <PolymerVariantSettings {...section} />
        </GroupBox>
      </div>
    </Modal>
  );
}
