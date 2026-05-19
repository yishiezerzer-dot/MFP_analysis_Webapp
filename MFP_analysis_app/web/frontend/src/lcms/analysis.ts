import type { LCMSEICData, PolymerSettings, SpectrumData } from "../api";

export type LCMSPolarity = "all" | "positive" | "negative";
export type ExpectedProductResolutionMode = "normal" | "low";
export type FeatureMatrixMetric = "area" | "height";
export type FeatureMatrixGroupMode = "evidence" | "mz";

export interface PolymerSharedSettings {
  enabled: boolean;
  monomers_text: string;
  bond_delta: number;
  extra_delta: number;
  charges: string;
  decarb: boolean;
  oxid: boolean;
  h2o_loss: boolean;
  cluster: boolean;
  max_dp: number;
  tol_value: number;
  tol_unit: "Da" | "ppm";
  min_rel_int: number;
}

export type PolymerMonomerCategory = "hydroxy" | "amino";

export interface PolymerMonomerPreset {
  id: string;
  category: PolymerMonomerCategory;
  name: string;
  abbr: string;
  mass: number;
  selected: boolean;
  custom?: boolean;
}

export interface PolymerModeSettings {
  adduct_mass: number;
  cluster_adduct_mass: number;
  adduct_na: boolean;
  adduct_k: boolean;
  adduct_cl: boolean;
  adduct_formate: boolean;
  adduct_acetate: boolean;
}

export interface PolymerUiSettings {
  shared: PolymerSharedSettings;
  positive: PolymerModeSettings;
  negative: PolymerModeSettings;
  monomers: PolymerMonomerPreset[];
}

export interface LCMSEICMetadata {
  source: "manual" | "spectrum" | "expected";
  sourceSessionId?: string | null;
  sourceFile?: string;
  label?: string;
  expectedProduct?: string;
  annotation?: string;
}

export interface LCMSEICPlot {
  id: string;
  eic: LCMSEICData;
  metadata?: LCMSEICMetadata;
}

export interface LCMSFeatureRow {
  id: string;
  eicPlotId: string;
  session_id: string | null;
  sourceFile: string;
  mz: number;
  tolerance: number;
  polarity: string | null;
  rtStart: number;
  rtApex: number;
  rtEnd: number;
  height: number;
  area: number;
  baseline: number;
  nPoints: number;
  source: LCMSEICMetadata["source"];
  label?: string | undefined;
  expectedProduct?: string | undefined;
  annotation?: string | undefined;
  createdAt: string;
}

export interface FeatureMatrixCell {
  row: LCMSFeatureRow;
  collisions: LCMSFeatureRow[];
}

export interface FeatureMatrixGroup {
  id: string;
  label: string;
  annotation: string;
  polarity: string | null;
  mz: number;
  rtApex: number;
  anchorMz: number;
  rtMin: number;
  rtMax: number;
  rows: LCMSFeatureRow[];
  cells: Record<string, FeatureMatrixCell>;
}

export interface FeatureMatrixResult {
  groups: FeatureMatrixGroup[];
  columnIds: string[];
  columnLabels: Record<string, string>;
}

export interface ExpectedProductHit {
  id: string;
  composition: string;
  neutralMass: number;
  variant: string;
  ion: string;
  expectedMz: number;
  toleranceDa: number;
  observedMz: number | null;
  intensity: number | null;
  absErr: number | null;
  ppmErr: number | null;
}

export interface KendrickPoint {
  id: string;
  mz: number;
  intensity: number;
  relIntensity: number;
  kendrickMass: number;
  kendrickNominalMass: number;
  kmd: number;
  seriesId: number | null;
}

export interface KendrickSeries {
  id: number;
  center: number;
  count: number;
  maxIntensity: number;
}

export interface SpectrumIndex {
  mz: Float64Array;
  intensity: Float64Array;
  order: Int32Array;
}

export type CsvCell = string | number | boolean | null | undefined;

export const PROTON_MASS = 1.007276;
export const NA_MASS = 22.989218;
export const K_MASS = 38.963158;
export const CL_MASS = 34.968853;
export const FORMATE_MASS = 44.997655;
export const ACETATE_MASS = 59.013851;
export const H2O_LOSS_MASS = 18.010565;
export const CO2_LOSS_MASS = 43.989829;
export const OXIDATION_MASS = 15.994915;
export const EXPECTED_PRODUCT_MAX_DP = 20;
export const EXPECTED_PRODUCT_COMPOSITION_LIMIT = 50000;
export const KENDRICK_POINT_LIMIT = 8000;

export function escapeCsvCell(value: CsvCell): string {
  if (value == null) return "";
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function rowsToCsv(rows: CsvCell[][]): string {
  return rows.map((row) => row.map(escapeCsvCell).join(",")).join("\n");
}

const SUPERSCRIPT_DIGITS: Record<string, string> = {
  "0": "\u2070",
  "1": "\u00b9",
  "2": "\u00b2",
  "3": "\u00b3",
  "4": "\u2074",
  "5": "\u2075",
  "6": "\u2076",
  "7": "\u2077",
  "8": "\u2078",
  "9": "\u2079",
};

function toSuperscript(n: number): string {
  return String(n).split("").map((c) => SUPERSCRIPT_DIGITS[c] ?? c).join("");
}

export function polymerMonomerText(settings: PolymerUiSettings): string {
  const presetLines = settings.monomers
    .filter((monomer) => monomer.selected)
    .map((monomer) => `${monomer.abbr.trim() || monomer.name} ${monomer.mass.toFixed(6)}`);
  const otherLines = settings.shared.monomers_text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return [...presetLines, ...otherLines].join("\n");
}

export function parseExpectedProductMonomers(text: string): Array<{ name: string; mass: number }> {
  return text
    .split(/\r?\n/)
    .map((line, index) => {
      const clean = line.trim();
      if (!clean) return null;
      const parts = clean
        .replace(/,/g, " ")
        .split(/\s+/)
        .filter(Boolean);
      const massText = parts.at(-1) ?? "";
      const mass = Number.parseFloat(massText);
      if (!Number.isFinite(mass)) return null;
      const name = parts.slice(0, -1).join(" ") || `M${index + 1}`;
      return { name, mass };
    })
    .filter((item): item is { name: string; mass: number } => item != null);
}

export function parsePositiveCharges(text: string): number[] {
  const charges = text
    .replace(/;/g, ",")
    .split(",")
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((charge) => Number.isFinite(charge) && charge > 0);
  return charges.length > 0 ? charges : [1];
}

export function autoSignedProtonLike(value: number, polarity: Exclude<LCMSPolarity, "all">): number {
  if (Math.abs(Math.abs(value) - PROTON_MASS) <= 0.01) {
    return polarity === "positive" ? Math.abs(value) : -Math.abs(value);
  }
  return value;
}

export function ionLabel(
  core: "M" | "2M",
  adductLabel: string,
  adductMass: number,
  charge: number,
  polarity: Exclude<LCMSPolarity, "all">,
): string {
  const sign = polarity === "negative" ? "\u207b" : "\u207a";
  const suffix = charge > 1 ? `${toSuperscript(charge)}${sign}` : sign;
  const label = adductLabel.replace(/-/g, "\u2212");
  if (label) return `[${core}${label}]${suffix}`;
  const proton =
    Math.abs(adductMass - PROTON_MASS) <= 0.002
      ? "+H"
      : Math.abs(adductMass + PROTON_MASS) <= 0.002
        ? "\u2212H"
        : `${adductMass >= 0 ? "+" : "\u2212"}${Math.abs(adductMass).toFixed(4)}`;
  return `[${core}${proton}]${suffix}`;
}

export function generateCompositions(
  monomers: Array<{ name: string; mass: number }>,
  maxDp: number,
  limit = EXPECTED_PRODUCT_COMPOSITION_LIMIT,
): Array<{ label: string; mass: number; dp: number }> {
  const out: Array<{ label: string; mass: number; dp: number }> = [];
  const n = monomers.length;
  const walk = (index: number, remaining: number, counts: number[]) => {
    if (out.length >= limit) return;
    if (index === n - 1) {
      const next = [...counts, remaining];
      const dp = next.reduce((sum, value) => sum + value, 0);
      if (dp <= 0) return;
      const parts: string[] = [];
      let mass = 0;
      next.forEach((count, monomerIndex) => {
        if (count <= 0) return;
        mass += count * monomers[monomerIndex].mass;
        parts.push(`${count}-${monomers[monomerIndex].name}`);
      });
      out.push({ label: parts.join(" + "), mass, dp });
      return;
    }
    for (let count = 0; count <= remaining; count += 1) {
      if (out.length >= limit) break;
      walk(index + 1, remaining - count, [...counts, count]);
    }
  };
  for (let total = 1; total <= maxDp && out.length < limit; total += 1) walk(0, total, []);
  return out;
}

export function buildSpectrumIndex(spectrum: SpectrumData): SpectrumIndex {
  const n = spectrum.mz.length;
  const order = new Int32Array(n);
  for (let i = 0; i < n; i += 1) order[i] = i;
  order.sort((a, b) => spectrum.mz[a] - spectrum.mz[b]);
  const mz = new Float64Array(n);
  const intensity = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    const j = order[i];
    mz[i] = spectrum.mz[j];
    intensity[i] = spectrum.intensity[j] ?? 0;
  }
  return { mz, intensity, order };
}

function lowerBound(arr: Float64Array, target: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function findMostIntenseSpectrumPeak(
  index: SpectrumIndex,
  expectedMz: number,
  tolDa: number,
): { mz: number; intensity: number; absErr: number; ppmErr: number } | null {
  const start = lowerBound(index.mz, expectedMz - tolDa);
  const end = lowerBound(index.mz, expectedMz + tolDa);
  let best: { mz: number; intensity: number; absErr: number; ppmErr: number } | null = null;
  for (let i = start; i < end; i += 1) {
    const absErr = Math.abs(index.mz[i] - expectedMz);
    if (absErr > tolDa) continue;
    const intensity = index.intensity[i];
    const ppmErr = expectedMz === 0 ? 0 : (absErr / Math.abs(expectedMz)) * 1e6;
    if (
      best == null ||
      intensity > best.intensity ||
      (intensity === best.intensity && absErr < best.absErr)
    ) {
      best = { mz: index.mz[i], intensity, absErr, ppmErr };
    }
  }
  return best;
}

export function integrateEICPeak(
  eic: LCMSEICData,
  referenceRt?: number | null,
): {
  rtStart: number;
  rtApex: number;
  rtEnd: number;
  height: number;
  area: number;
  baseline: number;
  nPoints: number;
} | null {
  const points = eic.rt_min
    .map((rt, index) => ({ rt, intensity: eic.intensity[index] ?? 0 }))
    .filter((point) => Number.isFinite(point.rt) && Number.isFinite(point.intensity))
    .sort((a, b) => a.rt - b.rt);
  if (points.length === 0) return null;

  let apexIndex = 0;
  if (referenceRt != null && Number.isFinite(referenceRt)) {
    const localMaxes: number[] = [];
    for (let i = 0; i < points.length; i += 1) {
      const cur = points[i].intensity;
      if (cur <= 0) continue;
      const prev = i > 0 ? points[i - 1].intensity : -Infinity;
      const next = i < points.length - 1 ? points[i + 1].intensity : -Infinity;
      if (cur >= prev && cur >= next) localMaxes.push(i);
    }
    if (localMaxes.length > 0) {
      apexIndex = localMaxes.reduce(
        (best, idx) =>
          Math.abs(points[idx].rt - referenceRt) < Math.abs(points[best].rt - referenceRt) ? idx : best,
        localMaxes[0],
      );
    } else {
      for (let i = 1; i < points.length; i += 1) {
        if (points[i].intensity > points[apexIndex].intensity) apexIndex = i;
      }
    }
  } else {
    for (let i = 1; i < points.length; i += 1) {
      if (points[i].intensity > points[apexIndex].intensity) apexIndex = i;
    }
  }

  const height = points[apexIndex].intensity;
  let start = apexIndex;
  while (start > 0 && points[start - 1].intensity <= points[start].intensity) start -= 1;
  let end = apexIndex;
  while (end < points.length - 1 && points[end + 1].intensity <= points[end].intensity) end += 1;

  let baseline = 0;
  const outside: number[] = [];
  for (let i = 0; i < start; i += 1) outside.push(points[i].intensity);
  for (let i = end + 1; i < points.length; i += 1) outside.push(points[i].intensity);
  if (outside.length >= 5) {
    outside.sort((a, b) => a - b);
    baseline = outside[Math.floor(outside.length / 2)];
  } else {
    let edgeMin = Infinity;
    const edgeCandidates = [points[start].intensity, points[end].intensity];
    if (start > 0) edgeCandidates.push(points[start - 1].intensity);
    if (end < points.length - 1) edgeCandidates.push(points[end + 1].intensity);
    for (const v of edgeCandidates) if (v < edgeMin) edgeMin = v;
    baseline = Number.isFinite(edgeMin) ? edgeMin : 0;
  }
  baseline = Math.max(0, baseline);

  const peakSignal = Math.max(0, height - baseline);
  const threshold = baseline + peakSignal * 0.05;
  while (start < apexIndex && points[start].intensity < threshold) start += 1;
  while (end > apexIndex && points[end].intensity < threshold) end -= 1;

  if (start === end) {
    start = Math.max(0, start - 1);
    end = Math.min(points.length - 1, end + 1);
  }

  let area = 0;
  for (let i = start; i < end; i += 1) {
    const y0 = Math.max(0, points[i].intensity - baseline);
    const y1 = Math.max(0, points[i + 1].intensity - baseline);
    const dx = Math.max(0, points[i + 1].rt - points[i].rt);
    area += ((y0 + y1) / 2) * dx;
  }
  return {
    rtStart: points[start].rt,
    rtApex: points[apexIndex].rt,
    rtEnd: points[end].rt,
    height,
    area,
    baseline,
    nPoints: end - start + 1,
  };
}

export function eicSourceSessionId(plot: LCMSEICPlot): string | null {
  return plot.metadata?.sourceSessionId ?? null;
}

export function eicSourceFile(plot: LCMSEICPlot): string {
  return plot.metadata?.sourceFile || "LCMS session";
}

export function buildKendrickPoints(
  spectrum: SpectrumData,
  repeatMass: number,
  minRelIntensity: number,
  toleranceValue: number,
  toleranceUnit: "kmd" | "ppm",
  minSeriesPoints: number,
): { points: KendrickPoint[]; series: KendrickSeries[]; truncated: boolean } {
  if (!Number.isFinite(repeatMass) || repeatMass <= 0) {
    return { points: [], series: [], truncated: false };
  }
  let maxIntensity = 0;
  for (let i = 0; i < spectrum.intensity.length; i += 1) {
    const v = spectrum.intensity[i];
    if (Number.isFinite(v) && v > maxIntensity) maxIntensity = v;
  }
  if (maxIntensity <= 0) return { points: [], series: [], truncated: false };
  const threshold = maxIntensity * (Math.max(0, minRelIntensity) / 100);
  const nominalRepeatMass = Math.max(1, Math.round(repeatMass));
  const scale = nominalRepeatMass / repeatMass;
  const rawPoints: KendrickPoint[] = [];
  for (let i = 0; i < spectrum.mz.length; i += 1) {
    const mz = spectrum.mz[i];
    const intensity = spectrum.intensity[i] ?? 0;
    if (!Number.isFinite(mz) || !Number.isFinite(intensity) || intensity < threshold) continue;
    const kendrickMass = mz * scale;
    const kendrickNominalMass = Math.round(kendrickMass);
    rawPoints.push({
      id: `${i}-${mz.toFixed(6)}`,
      mz,
      intensity,
      relIntensity: (intensity / maxIntensity) * 100,
      kendrickMass,
      kendrickNominalMass,
      kmd: kendrickNominalMass - kendrickMass,
      seriesId: null,
    });
  }

  const truncated = rawPoints.length > KENDRICK_POINT_LIMIT;
  const points = rawPoints
    .sort((a, b) => b.intensity - a.intensity)
    .slice(0, KENDRICK_POINT_LIMIT)
    .sort((a, b) => a.kmd - b.kmd);
  const tolForPoint = (point: KendrickPoint): number =>
    toleranceUnit === "ppm"
      ? Math.max(1e-9, toleranceValue * 1e-6 * point.mz * scale)
      : Math.max(1e-9, toleranceValue);

  const clusters: KendrickPoint[][] = [];
  let runningSum = 0;
  let runningCount = 0;
  for (const point of points) {
    const mean = runningCount > 0 ? runningSum / runningCount : point.kmd;
    if (runningCount === 0 || Math.abs(point.kmd - mean) > tolForPoint(point)) {
      clusters.push([point]);
      runningSum = point.kmd;
      runningCount = 1;
    } else {
      clusters[clusters.length - 1].push(point);
      runningSum += point.kmd;
      runningCount += 1;
    }
  }

  const series: KendrickSeries[] = [];
  clusters.forEach((cluster) => {
    if (cluster.length < minSeriesPoints) return;
    const id = series.length + 1;
    const count = cluster.length;
    let sumKmd = 0;
    let maxClusterIntensity = 0;
    for (const point of cluster) {
      sumKmd += point.kmd;
      if (point.intensity > maxClusterIntensity) maxClusterIntensity = point.intensity;
    }
    const center = sumKmd / count;
    cluster.forEach((point) => {
      point.seriesId = id;
    });
    series.push({ id, center, count, maxIntensity: maxClusterIntensity });
  });

  return { points: points.sort((a, b) => a.mz - b.mz), series, truncated };
}

export function buildExpectedProductHits(
  settings: PolymerUiSettings,
  polarity: Exclude<LCMSPolarity, "all">,
  index: SpectrumIndex,
  maxDp: number,
  resolutionMode: ExpectedProductResolutionMode,
  lowResolutionTolerance: number,
): ExpectedProductHit[] {
  const monomers = parseExpectedProductMonomers(polymerMonomerText(settings));
  if (monomers.length === 0) return [];
  const profile = settings[polarity];
  const shared = settings.shared;
  const charges = parsePositiveCharges(shared.charges);
  const dpMax = Math.max(1, Math.min(EXPECTED_PRODUCT_MAX_DP, Math.round(maxDp)));
  const baseAdduct = autoSignedProtonLike(profile.adduct_mass, polarity);
  const clusterAdduct = autoSignedProtonLike(profile.cluster_adduct_mass, polarity);
  const adducts: Array<{ label: string; mass: number }> = [{ label: "", mass: baseAdduct }];
  if (polarity === "positive") {
    if (profile.adduct_na) adducts.push({ label: "+Na", mass: NA_MASS });
    if (profile.adduct_k) adducts.push({ label: "+K", mass: K_MASS });
  } else {
    if (profile.adduct_cl) adducts.push({ label: "+Cl", mass: CL_MASS });
    if (profile.adduct_formate) adducts.push({ label: "+HCOO", mass: FORMATE_MASS });
    if (profile.adduct_acetate) adducts.push({ label: "+Ac", mass: ACETATE_MASS });
  }
  const variants: Array<{ label: string; delta: number }> = [{ label: "", delta: 0 }];
  if (shared.h2o_loss) variants.push({ label: "-H2O", delta: -H2O_LOSS_MASS });
  if (shared.decarb) variants.push({ label: "-CO2", delta: -CO2_LOSS_MASS });
  if (shared.oxid) variants.push({ label: "+O", delta: OXIDATION_MASS });
  const tolDaFor = (mz: number) => {
    const configuredTolerance =
      shared.tol_unit === "ppm" ? (Math.abs(mz) * Math.max(0, shared.tol_value)) / 1e6 : Math.max(0, shared.tol_value);
    return resolutionMode === "low"
      ? Math.max(configuredTolerance, Math.max(0.01, lowResolutionTolerance))
      : configuredTolerance;
  };
  const clusterMonomerMinRatioVsDimer = 1.0;
  const rows: ExpectedProductHit[] = [];
  const seen = new Set<string>();
  const addHit = (
    composition: string,
    neutralMass: number,
    variant: string,
    ion: string,
    expectedMz: number,
  ) => {
    const key = `${composition}|${variant}|${ion}|${expectedMz.toFixed(6)}`;
    if (seen.has(key)) return;
    seen.add(key);
    const toleranceDa = tolDaFor(expectedMz);
    const match = findMostIntenseSpectrumPeak(index, expectedMz, toleranceDa);
    rows.push({
      id: key,
      composition,
      neutralMass,
      variant,
      ion,
      expectedMz,
      toleranceDa,
      observedMz: match?.mz ?? null,
      intensity: match?.intensity ?? null,
      absErr: match?.absErr ?? null,
      ppmErr: match?.ppmErr ?? null,
    });
  };
  for (const composition of generateCompositions(monomers, dpMax)) {
    const neutralBase = composition.mass + (composition.dp - 1) * shared.bond_delta + shared.extra_delta;
    for (const variant of variants) {
      const neutralMass = neutralBase + variant.delta;
      for (const charge of charges) {
        for (const adduct of adducts) {
          const expectedMz = (neutralMass + adduct.mass) / charge;
          addHit(composition.label, neutralMass, variant.label, ionLabel("M", adduct.label, adduct.mass, charge, polarity), expectedMz);
        }
      }
    }
    if (shared.cluster) {
      for (const charge of charges) {
        const expectedMz = (2 * neutralBase + clusterAdduct) / charge;
        const clusterMatch = findMostIntenseSpectrumPeak(index, expectedMz, tolDaFor(expectedMz));
        if (clusterMatch == null) continue;
        const monomerMz = neutralBase + clusterAdduct;
        const monomerMatch = findMostIntenseSpectrumPeak(index, monomerMz, tolDaFor(monomerMz));
        const monomerIntensity = monomerMatch != null ? monomerMatch.intensity : 0;
        if (monomerIntensity < clusterMonomerMinRatioVsDimer * clusterMatch.intensity) continue;
        addHit(composition.label, 2 * neutralBase, "2M", ionLabel("2M", "", clusterAdduct, charge, polarity), expectedMz);
      }
    }
  }
  return rows.sort((a, b) => {
    const aMatched = a.observedMz != null ? 0 : 1;
    const bMatched = b.observedMz != null ? 0 : 1;
    if (aMatched !== bMatched) return aMatched - bMatched;
    return (b.intensity ?? 0) - (a.intensity ?? 0);
  });
}

export function toApiPolymerSettings(
  settings: PolymerUiSettings,
  polarity: Exclude<LCMSPolarity, "all">,
): PolymerSettings {
  const profile = settings[polarity];
  return {
    ...settings.shared,
    monomers_text: polymerMonomerText(settings),
    ...profile,
    adduct_na: polarity === "positive" ? profile.adduct_na : false,
    adduct_k: polarity === "positive" ? profile.adduct_k : false,
    adduct_cl: polarity === "negative" ? profile.adduct_cl : false,
    adduct_formate: polarity === "negative" ? profile.adduct_formate : false,
    adduct_acetate: polarity === "negative" ? profile.adduct_acetate : false,
  };
}

export function featureMatrixValue(row: LCMSFeatureRow, metric: FeatureMatrixMetric): number {
  return metric === "area" ? row.area : row.height;
}

export function groupFeatureRowsForMatrix(
  rows: LCMSFeatureRow[],
  sessions: Array<{ session_id: string; display_name: string }>,
  options: {
    metric: FeatureMatrixMetric;
    groupMode: FeatureMatrixGroupMode;
    mzTolerance: number;
  },
): FeatureMatrixResult {
  const sessionById = new Map(sessions.map((session) => [session.session_id, session]));
  const columnIdsSet = new Set<string>();
  const columnLabels: Record<string, string> = {};
  sessions.forEach((session) => {
    columnIdsSet.add(session.session_id);
    columnLabels[session.session_id] = session.display_name;
  });
  rows.forEach((row) => {
    const id = row.session_id && sessionById.has(row.session_id) ? row.session_id : `file:${row.sourceFile}`;
    columnIdsSet.add(id);
    if (!(id in columnLabels)) columnLabels[id] = id.startsWith("file:") ? id.slice(5) : id;
  });
  const columnIds = Array.from(columnIdsSet);
  const evidenceKeyFor = (row: LCMSFeatureRow) => {
    const evidence = row.expectedProduct?.trim() || row.label?.trim();
    if (!evidence) return null;
    return [
      "ev",
      evidence.toLowerCase(),
      (row.annotation ?? "").trim().toLowerCase(),
      row.polarity ?? "",
    ].join("|");
  };
  const tolerance = Math.max(0.000001, options.mzTolerance);
  const built: FeatureMatrixGroup[] = [];
  for (const row of rows) {
    const columnId = row.session_id && sessionById.has(row.session_id) ? row.session_id : `file:${row.sourceFile}`;
    const evidenceKey = options.groupMode === "evidence" ? evidenceKeyFor(row) : null;
    let group = evidenceKey ? built.find((item) => item.id === evidenceKey) : undefined;
    if (!group) {
      // Compare against the group's anchor m/z (the first row that seeded it),
      // NOT a running mean. Running-mean clustering is transitive: a chain of
      // rows each within tolerance of the previous can collapse into one group
      // whose endpoints differ by far more than the tolerance.
      group = built.find((item) => {
        if (item.id.startsWith("ev|")) return false;
        if ((item.polarity ?? "") !== (row.polarity ?? "")) return false;
        return Math.abs(item.anchorMz - row.mz) <= tolerance;
      });
    }
    if (!group) {
      const label = row.expectedProduct || row.label || `m/z ${row.mz.toFixed(4)}`;
      group = {
        id: evidenceKey ?? `mz-${built.length}-${row.mz.toFixed(4)}-${row.polarity ?? "unk"}`,
        label,
        annotation: row.annotation ?? "",
        polarity: row.polarity,
        mz: row.mz,
        rtApex: row.rtApex,
        anchorMz: row.mz,
        rtMin: row.rtApex,
        rtMax: row.rtApex,
        rows: [],
        cells: {},
      };
      built.push(group);
    }
    group.rows.push(row);
    group.mz = group.rows.reduce((sum, item) => sum + item.mz, 0) / group.rows.length;
    group.rtApex = group.rows.reduce((sum, item) => sum + item.rtApex, 0) / group.rows.length;
    if (row.rtApex < group.rtMin) group.rtMin = row.rtApex;
    if (row.rtApex > group.rtMax) group.rtMax = row.rtApex;
    if (!group.annotation && row.annotation) group.annotation = row.annotation;
    const previous = group.cells[columnId];
    if (!previous) {
      group.cells[columnId] = { row, collisions: [] };
    } else {
      // Multiple rows landed in the same (group, sample) cell. Pick the larger
      // by metric as the headline value, but keep the others so callers can
      // surface a "+N more" badge or sum them if they prefer.
      const incomingIsLarger =
        featureMatrixValue(row, options.metric) > featureMatrixValue(previous.row, options.metric);
      if (incomingIsLarger) {
        group.cells[columnId] = { row, collisions: [previous.row, ...previous.collisions] };
      } else {
        previous.collisions.push(row);
      }
    }
  }
  return {
    groups: built.sort((a, b) => a.mz - b.mz || a.label.localeCompare(b.label)),
    columnIds,
    columnLabels,
  };
}
