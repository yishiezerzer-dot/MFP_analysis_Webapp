import { describe, expect, it } from "vitest";
import { PRODUCT_DEFAULTS, parseMass, productIons, productSettings } from "../lcmsProduct";
import { defaultPolymerUiSettings } from "../../lcms/analysis";

describe("Find my product: answers → ions and polymer settings", () => {
  it("gives the protonated, multiply charged and adduct ions in positive mode", () => {
    // GA–LA dimer, the example run's main product
    const ions = productIons(148.037173, "positive", ["na", "cl"], "1,2");
    expect(ions.map((i) => i.label)).toEqual(["[M+H]⁺", "[M+2H]²⁺", "[M+Na]⁺"]);
    expect(ions[0].mz).toBeCloseTo(149.044449, 5);
    expect(ions[1].mz).toBeCloseTo(75.025863, 5);
    expect(ions[2].mz).toBeCloseTo(171.026391, 5);
  });

  it("gives deprotonated and anion adducts in negative mode", () => {
    const ions = productIons(200, "negative", ["na", "formate"], "1");
    expect(ions.map((i) => i.label)).toEqual(["[M−H]⁻", "[M+HCOO]⁻"]);
    expect(ions[0].mz).toBeCloseTo(198.992724, 5);
    expect(ions[1].mz).toBeCloseTo(244.998204, 5);
  });

  it("reads masses with a comma or a point and rejects nonsense", () => {
    expect(parseMass("206,0427")).toBeCloseTo(206.0427);
    expect(parseMass("abc")).toBeNull();
    expect(parseMass("-5")).toBeNull();
  });

  it("selects only the chosen monomers and switches polymer labels on", () => {
    const settings = productSettings(
      { ...PRODUCT_DEFAULTS, monomers: ["hydroxy:glycolic-acid", "hydroxy:lactic-acid"], adducts: ["k"], maxDp: 4, charges: "1,2" },
      defaultPolymerUiSettings(),
    );
    expect(settings.monomers.filter((m) => m.selected).map((m) => m.abbr)).toEqual(["GA", "LA"]);
    expect(settings.shared).toMatchObject({ enabled: true, max_dp: 4, charges: "1,2" });
    expect(settings.positive).toMatchObject({ adduct_na: false, adduct_k: true });
  });

  it("leaves polymer labels off when only a mass is known", () => {
    const settings = productSettings({ ...PRODUCT_DEFAULTS, mass: "206.04" }, defaultPolymerUiSettings());
    expect(settings.shared.enabled).toBe(false);
  });
});
