# FTIR Tab — Codex Implementation Plan

**Target codebase:** `MFP_analysis_app/web` (full-stack Python FastAPI + React TypeScript)
**Module:** FTIR (IR spectroscopy peak picking + functional-group assignment + analysis)
**Goal:** Replace the unreliable peak-labeling system with a scientifically rigorous one, give users full control to override and constrain assignments, and add high-impact analysis features missing from the current build.

---

## 0 · Context for Codex (read first)

This is a polymer/biomolecule lab analysis webapp. The FTIR tab loads `.spa / .csv / .txt / .dpt` files, preprocesses them, picks peaks, and currently tries to label each peak with a functional group — but the labels are **wrong in important cases**:

| Wavenumber | Currently labeled | Should be labeled |
|------------|-------------------|-------------------|
| 1740 cm⁻¹ | "aromatic" or "C=O generic" | **Ester C=O stretch** (when C–O bands present at 1150–1310) |
| 1650 cm⁻¹ | "C=C" generic | **Amide I** (when N–H ~3300 + Amide II ~1540 are present) |
| 1715 cm⁻¹ | sometimes ester | **Ketone** (no aldehyde C–H, no broad O–H, no C–O) |
| 1710 cm⁻¹ | C=O generic | **Carboxylic acid** (when broad 3300–2500 O–H present) |

**The root cause:** the current labeler scores each peak in isolation without inspecting other peaks in the spectrum to confirm or rule out candidates. Aromatic ring stretches **never** appear at 1740 — they appear at 1600 + 1500 — so the current code is structurally incorrect.

**Two parallel asks the user has stated explicitly:**
1. The user wants to **override** any peak label manually (already partially implemented via `FTIRLabelEdits`, but not exposed in the UI for a full assignment swap — only text edits).
2. The user wants to **rule out functional groups** that are chemically impossible for the sample (e.g., "this sample contains no nitrogen, suppress all amide/amine candidates"). This concept does NOT exist today.

Everything below assumes the existing webapp architecture; do not rewrite plumbing that already works.

---

## 1 · Current Architecture (from code exploration)

### 1.1 Files involved

| File | Role |
|------|------|
| `MFP_analysis_app/lab_gui/ftir_library.py` | `FTIR_LIBRARY_V2` — 40-entry list of band dicts. Currently the source of truth for assignments. |
| `MFP_analysis_app/lab_gui/ftir_assignment.py` | `assign_ftir_peaks()` + `_score_entry()` — scoring engine, 0–100, threshold default 35. |
| `MFP_analysis_app/lab_gui/ftir_analysis.py` | `pick_peaks()` (scipy.signal.find_peaks wrapper) + `preprocess_spectrum()`. |
| `MFP_analysis_app/web/backend/app/routers/ftir.py` | FastAPI routes — see §1.2. |
| `MFP_analysis_app/web/backend/app/services/ftir_service.py` | Service layer; in-memory session registry. |
| `MFP_analysis_app/web/frontend/src/views/FTIRView.tsx` (1696 lines) | UI — preprocess card, peak card, spectrum chart with draggable annotations. |

### 1.2 Existing API surface (`/api/ftir/...`)

- `POST /sessions/{sid}/peaks` — body `PeaksRequest` (mode, smoothing_window, poly_order, baseline, normalize, min_prominence, min_height, min_distance_cm1, top_n, assign, assign_top_n, assign_min_score). Returns `{peaks: [...], assignments: [...] | null}`.
- Each assignment: `{wn, peak_metrics, candidates: [{id, label, score, reasons}]}`.

### 1.3 Existing frontend state

```ts
interface FTIRLabelEdit { text?: string; hidden?: boolean; ax?: number; ay?: number; }
type FTIRLabelEdits = Record<string, FTIRLabelEdit>;  // key: "sessionId:wavenumber"
```

`labelEdits` is persisted in the workspace JSON. CSV export already includes `plot_label` and `label_hidden` columns. **Reuse this state**; extend its shape rather than create a parallel one.

---

## 2 · Research-grounded fix for peak labeling

### 2.1 New library data structure (replace `FTIR_LIBRARY_V2`)

Move the library to a JSON file at `MFP_analysis_app/lab_gui/ftir_library_v3.json` so non-coders can edit it. Schema below — derived from Coates 2000, Socrates 2001, Stuart 2004, Barth 2007 (amides), Koenig 1999 (polymers). **Cite these sources in the file header.**

```json
{
  "schema_version": 3,
  "categories": [
    "alkane_ch", "alkene_ch", "aromatic_ch", "alkyne_ch", "oh", "nh",
    "carbonyl", "amide", "nitrile", "alkene_cc", "aromatic_cc", "imine",
    "co_single", "cn_single", "halide", "fingerprint", "atmospheric"
  ],
  "bands": [
    {
      "id": "ester_co",
      "range_cm1": [1735, 1750],
      "primary": {
        "group": "Ester C=O stretch",
        "category": "carbonyl",
        "subcategory": "ester",
        "intensity": "strong",
        "shape": "sharp"
      },
      "alternatives": [
        { "group": "Aldehyde C=O", "subcategory": "aldehyde", "range_cm1": [1720, 1740], "prior": 0.20 },
        { "group": "Ketone C=O",   "subcategory": "ketone",   "range_cm1": [1705, 1725], "prior": 0.15 }
      ],
      "confirm_if_present": [
        { "id": "ester_co_asym", "range_cm1": [1230, 1310], "role": "C-O asym stretch", "boost": 2.5 },
        { "id": "ester_co_sym",  "range_cm1": [1150, 1210], "role": "C-O sym stretch",  "boost": 2.0 }
      ],
      "exclude_if_present": [
        { "id": "broad_oh_acid", "range_cm1": [2500, 3300], "shape_hint": "very_broad", "implies": "carboxylic_acid", "penalty": 0.25 },
        { "id": "amide_nh",      "range_cm1": [3270, 3340], "implies": "amide",           "penalty": 0.5 }
      ],
      "polymer_hints": ["PMMA", "PET", "PLA", "polyurethane"],
      "sources": ["Coates 2000", "Socrates 2001 §10"]
    },
    {
      "id": "amide_I",
      "range_cm1": [1630, 1690],
      "primary": {
        "group": "Amide I (C=O stretch, coupled)",
        "category": "amide",
        "subcategory": "amide_I",
        "intensity": "strong",
        "shape": "sharp"
      },
      "alternatives": [
        { "group": "Alkene C=C",        "subcategory": "alkene",   "range_cm1": [1620, 1680], "prior": 0.20 },
        { "group": "Aromatic C=C ring", "subcategory": "aromatic", "range_cm1": [1580, 1620], "prior": 0.15 },
        { "group": "Imine C=N",         "subcategory": "imine",    "range_cm1": [1620, 1690], "prior": 0.05 }
      ],
      "confirm_if_present": [
        { "id": "nh_stretch", "range_cm1": [3270, 3340], "boost": 3.0 },
        { "id": "amide_II",   "range_cm1": [1510, 1580], "boost": 3.0 }
      ],
      "polymer_hints": ["nylon-6", "nylon-6,6", "polyurethane", "chitosan", "protein"],
      "sources": ["Barth 2007", "Coates 2000"]
    }
  ]
}
```

**Codex must populate the full library.** Use the table in Appendix A as the seed dataset (~70 bands). At minimum cover: O–H, N–H, ≡C–H, =C–H, sp³ C–H, aldehyde Fermi doublet, anhydride doublet, acid chloride, ester, aldehyde, ketone, carboxylic acid, amide I/II/III (primary/secondary/tertiary), alkene C=C, aromatic ring (1600 + 1500), nitrile, alkyne, isocyanate, NO₂ asymmetric/symmetric, sulfoxide, sulfone, C–O ether/alcohol (primary/secondary/tertiary), C–N, Si–O–Si, halide C–Cl/C–Br, =C–H out-of-plane (mono/di/para substitution), CH₂ rock at 720 (PE), CO₂/H₂O atmospheric.

### 2.2 New scoring algorithm

Replace `_score_entry()` in `ftir_assignment.py` with a multi-pass evaluator that **looks at the whole spectrum**, not just one peak:

```python
def score_band(band: dict, peak: PeakMetrics, all_peaks: list[PeakMetrics],
               excluded_categories: set[str], excluded_subcategories: set[str]) -> tuple[float, list[str]]:
    """Return (score, reasons) for a single band candidate. 0 = ruled out."""
    # 0. Hard rule-out
    if band["primary"]["category"] in excluded_categories: return 0.0, ["category excluded by user"]
    if band["primary"]["subcategory"] in excluded_subcategories: return 0.0, ["subcategory excluded by user"]

    # 1. Range fit (primary range 70%, otherwise check alternatives 50%)
    score, reasons = base_range_score(band, peak.wn)
    if score == 0:
        return 0.0, ["wavenumber outside band range"]

    # 2. Shape & intensity match (existing _score_entry weights are reasonable; keep them)
    score += shape_bonus(band, peak); reasons += [...]
    score += intensity_bonus(band, peak); reasons += [...]

    # 3. CONFIRMATION PEAKS — multiplicative boost (this is the big fix)
    other_wns = [p.wn for p in all_peaks if p.wn != peak.wn]
    for cp in band.get("confirm_if_present", []):
        if any(cp["range_cm1"][0] <= w <= cp["range_cm1"][1] for w in other_wns):
            score *= cp.get("boost", 2.0)
            reasons.append(f"confirmation peak {cp['role']} at {cp['range_cm1']} present")

    # 4. EXCLUSION PEAKS — multiplicative penalty
    for ep in band.get("exclude_if_present", []):
        if any(ep["range_cm1"][0] <= w <= ep["range_cm1"][1] for w in other_wns):
            score *= ep.get("penalty", 0.3)
            reasons.append(f"penalty: {ep['implies']} signature present at {ep['range_cm1']}")

    return score, reasons
```

Then in `assign_ftir_peaks()`:
1. For every peak, run `score_band` against every band in the library that contains the peak's wavenumber.
2. Sort candidates by score.
3. If `top.score / second.score < 1.3` → mark as "ambiguous" and return the top-3 with no auto-pick (frontend renders "(no auto-label)" + lets user choose).
4. If top score ≥ threshold → that's the auto label.
5. Always return up to top 5 candidates with reasons so the UI can show the dropdown.

### 2.3 Backend API additions

**Extend `PeaksRequest`** (router `ftir.py`):
```python
excluded_categories: list[str] = []
excluded_subcategories: list[str] = []
ambiguity_ratio: float = Field(1.3, ge=1.0, le=5.0)  # threshold for "ambiguous"
```

**New route — manual override stored server-side** (so it survives full-spectrum recomputes):
```python
PUT /api/ftir/sessions/{sid}/peak-labels
body: { wn: float, override: { band_id: str | null, custom_text: str | null, hidden: bool } }
→ stores in session; returned by subsequent /peaks calls; persisted in workspace JSON.
```

**New route — list categories** (so frontend can render a checkbox grid):
```python
GET /api/ftir/library/categories
→ { categories: ["carbonyl", "amide", ...], subcategories_by_category: {...} }
```

### 2.4 Frontend UX changes (in `FTIRView.tsx`)

#### 2.4.1 New "Constraints" card in the right panel
A new collapsible section above the peak table:

```
┌─ Sample composition ──────────────────────────────┐
│ Rule out functional groups not present in this    │
│ sample:                                            │
│                                                    │
│ ☐ Carbonyls (C=O)                                  │
│   ↳ ☐ Ester  ☐ Ketone  ☐ Aldehyde  ☐ Acid          │
│ ☑ Amides (N-containing) ← user excluded            │
│   ↳ greyed-out children                            │
│ ☐ Aromatics                                        │
│ ☐ Alkenes                                          │
│ ☐ Nitriles                                         │
│ ☐ Halides                                          │
│ ☐ Sulfur-containing                                │
│ ☐ Silicon (Si-O)                                   │
│                                                    │
│ [ Apply & re-label ]                              │
└────────────────────────────────────────────────────┘
```

State shape:
```ts
interface FTIRConstraints {
  excludedCategories: Set<string>;
  excludedSubcategories: Set<string>;
}
```
Persisted in `viewState.constraints`. Sent on every `/peaks` request.

#### 2.4.2 Per-peak "Change label" dropdown in the peak table
Currently the peak row shows a single label. Add an inline control:

```
1740.5 cm⁻¹   [Ester C=O stretch ▾]   prom 0.12   width 22.3
                ├─ Ester C=O stretch  (auto, score 78.5) ✓
                ├─ Aldehyde C=O      (alt, score 42.1)
                ├─ Ketone C=O        (alt, score 38.3)
                ├─ ──────────────
                ├─ Custom text…      (free text)
                ├─ Hide label
                └─ Reset to auto
```

Component: `<PeakLabelPicker peak={p} candidates={c} edit={labelEdits[key]} onChange={...}/>`.

State change:
```ts
// Extend FTIRLabelEdit:
interface FTIRLabelEdit {
  text?: string;
  hidden?: boolean;
  ax?: number; ay?: number;
  bandId?: string | null;   // ← NEW: which library band the user picked
                             //    null means "no auto label, only custom text or hidden"
}
```

When `bandId` is set, the chart annotation pulls the band's `primary.group` instead of the auto-resolved one. When `text` is set, it overrides regardless.

#### 2.4.3 Drag-and-drop on the chart
Already has draggable annotations (`ax`, `ay`). Add: **right-click on a peak label** → context menu → "Change to…" submenu with candidate list + custom + hide.

#### 2.4.4 Peak table improvements
- Add a small **confidence pill** next to each label: green ≥ 70 score, amber 35–70, red < 35 ("low confidence" with tooltip explaining why).
- Add an "Ambiguous" filter chip at the top of the peak table.
- Add a column: **"Override"** showing `auto / user-bandId / custom-text / hidden`, with an X to reset.

### 2.5 Verification — peak labeling fix

Add backend pytest tests in `MFP_analysis_app/web/backend/tests/test_ftir_assignment.py`:

```python
def test_1740_with_ester_co_bands_resolves_to_ester():
    spectrum_peaks = [PeakMetrics(wn=1740, ...), PeakMetrics(wn=1170, ...), PeakMetrics(wn=1280, ...)]
    out = assign_ftir_peaks(spectrum_peaks)
    assert out[0].candidates[0].band_id == "ester_co"

def test_1650_with_nh_and_amideII_resolves_to_amideI():
    spectrum_peaks = [PeakMetrics(wn=1650, ...), PeakMetrics(wn=3300, ...), PeakMetrics(wn=1540, ...)]
    out = assign_ftir_peaks(spectrum_peaks)
    assert out[0].candidates[0].band_id == "amide_I"

def test_1650_without_nh_resolves_to_alkene_or_aromatic():
    spectrum_peaks = [PeakMetrics(wn=1650, ...)]
    out = assign_ftir_peaks(spectrum_peaks)
    assert out[0].candidates[0].band_id in {"alkene_cc", "aromatic_cc"}

def test_excluded_amides_filters_amide_I():
    spectrum_peaks = [PeakMetrics(wn=1650, ...), PeakMetrics(wn=3300, ...), PeakMetrics(wn=1540, ...)]
    out = assign_ftir_peaks(spectrum_peaks, excluded_categories={"amide"})
    assert all(c.band_id != "amide_I" for c in out[0].candidates)
```

---

## 3 · Additional FTIR analysis improvements

These came from a separate research pass. **Each is independently shippable** — implement in the order listed; numbers 3.1–3.4 are highest impact.

### 3.1 Expanded normalization & baseline correction (HIGH)

In `lab_gui/ftir_analysis.py:preprocess_spectrum()`:
- Add baseline methods: `rubberband` (convex hull), `asls` (Asymmetric Least Squares — Eilers & Boelens 2005), `airpls`. Expose `lambda` (smoothness, log-scale slider) and `p` (asymmetry, 0.001–0.1) in `PreprocessCard`.
- Add normalization modes: `snv` (mean-center + ÷ SD), `vector` (÷ √Σy²), `msc` (Multiplicative Scatter Correction — needs reference mean across overlay set), `min-max` (0–1 over selected region).

Expand the `Literal[...]` type in `ftir.py:PeaksRequest` to include the new options. Update the preset dropdown in `FTIRView` so users get one-click "Polymer thin film" / "ATR sample" / "KBr disc" presets that pick sensible (baseline + normalization + smoothing) combos.

### 3.2 Region-of-interest band integration & ratios (HIGH)

New backend route:
```python
POST /api/ftir/sessions/{sid}/integrate
body: { region: [wn_lo, wn_hi], baseline_mode: "linear" | "horizontal" | "tangent" }
→ { area, height, fwhm, baseline_y_at_lo, baseline_y_at_hi, peak_wn }
```

Frontend: shift-drag on the chart to define a region; display in a "Bands" panel with name editing. Support **band ratios** (e.g. carbonyl index = A1715/A1465) — central to polymer aging studies.

### 3.3 Difference spectra with weighting (HIGH)

```python
POST /api/ftir/subtract
body: { sid_a, sid_b, k: float, region_minimize?: [lo, hi] }
→ y_diff = y_a - k*y_b on common wn grid
```
If `region_minimize` is given, server runs `scipy.optimize.minimize_scalar` on `k` to minimise `‖y_a − k·y_b‖₂` in that region. Frontend exposes `k` slider 0–2 and a "auto-fit" button.

Also add **mean ± std envelope** trace when ≥3 spectra are overlaid (Plotly `fill: "tonexty"`).

### 3.4 Library spectrum search / hit list (HIGH)

New backend module `lab_gui/ftir_reference_library.py` with bundled NPZ reference spectra for: PE, PP, PS, PMMA, PET, PLA, nylon-6, nylon-6,6, cellulose, chitosan, polyurethane, PVA. Add 1-line text source attribution per spectrum.

```python
POST /api/ftir/sessions/{sid}/match
body: { region: [lo, hi] | null, derivative_order: 0 | 1 | 2 = 1 }
→ { hits: [{ name: "PET", correlation: 0.94, ranking_method: "first-derivative-pearson" }, ...] }
```
Use first-derivative Pearson correlation over a user-chosen window (default 650–1800 cm⁻¹). Frontend "Hit list" card with bar gauge per match, click to overlay reference.

### 3.5 Atmospheric correction (MEDIUM)

Add a "Mask atmospheric" toggle in `PreprocessCard` that excludes 2310–2390 (CO₂) and 1340–1900 / 3400–4000 H₂O rotational fine structure from peak picking and renders them as a translucent grey region in the chart.

### 3.6 ATR penetration-depth correction (MEDIUM)

Extend `preprocess_spectrum()`: when `atr_correction=true` and `n_crystal` (default 1.5), multiply absorbance by `(ν / ν_ref)`-derived factor (standard "Extended ATR" in Bruker OPUS).

### 3.7 Peak-picking improvements (MEDIUM-HIGH)

- **Click-to-add / click-to-remove peaks** via Plotly `onClick`. Append to a new `userAddedPeaks: number[]` and `userRemovedPeaks: number[]` per session; merge into the displayed list.
- **2nd-derivative-aided picking**: toggle in `PeakCard` — applies Savitzky-Golay 2nd-derivative, finds zero-crossings/minima, returns wavenumbers; great for shoulders.
- **Peak fitting** for overlapping bands: new route `POST /sessions/{sid}/fit` body `{ region: [lo, hi], n_components: int, profile: "gauss"|"lorentz"|"voigt" }` → uses `scipy.optimize.curve_fit`; returns fitted components rendered as translucent traces.

### 3.8 Group-frequency overlay shading (LOW, but free)

Toggle "Show group-frequency regions" → Plotly `layout.shapes` with translucent vrects + labels: 3200–3550 (O–H/N–H), 2850–3000 (sp³ C–H), 1700–1750 (C=O carbonyls), 1630–1690 (Amide I / C=C), 1500–1580 (Amide II / aromatic), 1000–1300 (C–O / fingerprint). Reuses the new library `range_cm1` data.

### 3.9 Peak hover with assignment & confidence (LOW, trivial)

In `SpectrumChart`, pass the band ID + label as `customdata` and update `hovertemplate` to include `<b>%{customdata.label}</b><br>conf %{customdata.score}<br>%{x:.1f} cm⁻¹<br>I=%{y:.4f}`.

### 3.10 Peak table sort / filter (LOW)

Sortable column headers (wn, y, prominence, score), text filter on assignment, multi-select rows with bulk hide/delete. Pure frontend.

### 3.11 JCAMP-DX export (MEDIUM)

Add "Export spectrum" → JCAMP-DX (.jdx) writer. Headers `##TITLE=`, `##XYDATA=(X++(Y..Y))`. Universal spectroscopy interchange format.

### 3.12 PDF report (MEDIUM)

`POST /sessions/{sid}/report` → server-side renders `weasyprint`/`reportlab` PDF: metadata, preprocessing parameters, annotated SVG, peak table with assignments, band-area table. One-click for SI files.

### 3.13 Keyboard shortcuts (LOW, nice)

`R` reset zoom, `F` fingerprint region, `G` group region, `O` toggle overlay, `P` run pick, `[`/`]` cycle sessions, `Esc` clear selection. Show in a `?` modal. `useEffect` keydown listener in `FTIRView`.

### 3.14 Quick-compare split-pane (MEDIUM)

Toggle in OverlayCard for `stacked` (Plotly subplots, shared x-axis) vs `overlay` vs `offset` (each trace +k·n on y).

---

## 4 · Recommended phasing

| Phase | Items | Why bundle |
|-------|-------|-----------|
| **A — Labels, the headline fix** | §2.1, §2.2, §2.3, §2.4, §2.5 | Single coherent unit. The user has explicitly asked for this. |
| **B — Preprocessing upgrade** | §3.1 (baselines, SNV/vector), §3.5 (atmospheric), §3.6 (ATR) | All touch `preprocess_spectrum()` together. Unlocks better matching downstream. |
| **C — Quantitative tools** | §3.2 (band integration), §3.3 (difference spectra) | Both need region-selection UX; build the picker once. |
| **D — Reference matching** | §3.4 (library search) | Standalone; ship after Phase B improves the input quality. |
| **E — Peak picking polish** | §3.7 (click-add/remove + 2nd deriv + fit) | All `PeakCard` work. |
| **F — UX polish** | §3.8, §3.9, §3.10, §3.13, §3.14 | Pure-frontend wins. |
| **G — Reporting** | §3.11 (JCAMP-DX), §3.12 (PDF) | Independent. |

---

## 5 · Files Codex will touch

```
MFP_analysis_app/lab_gui/ftir_library.py            # DELETE old V2 (or keep frozen for migration)
MFP_analysis_app/lab_gui/ftir_library_v3.json       # NEW — full library (Appendix A)
MFP_analysis_app/lab_gui/ftir_assignment.py         # REWRITE score_band() per §2.2
MFP_analysis_app/lab_gui/ftir_analysis.py           # ADD: AsLS, rubberband, SNV, vector, MSC, ATR, atm-mask
MFP_analysis_app/lab_gui/ftir_reference_library.py  # NEW — bundled polymer references
MFP_analysis_app/lab_gui/ftir_reference_data/*.npz  # NEW — bundled reference spectra
MFP_analysis_app/web/backend/app/routers/ftir.py    # extend PeaksRequest, add /peak-labels, /integrate, /subtract, /match, /fit, /report, /library/categories
MFP_analysis_app/web/backend/app/services/ftir_service.py  # implement above; persist user overrides + constraints
MFP_analysis_app/web/backend/tests/test_ftir_assignment.py # NEW — pytest cases per §2.5
MFP_analysis_app/web/frontend/src/views/FTIRView.tsx       # Constraints card, PeakLabelPicker, integration UX, hit list, etc.
MFP_analysis_app/web/frontend/src/api.ts                   # New typed wrappers
MFP_analysis_app/web/frontend/src/components/ftir/PeakLabelPicker.tsx  # NEW
MFP_analysis_app/web/frontend/src/components/ftir/ConstraintsCard.tsx  # NEW
MFP_analysis_app/web/frontend/src/components/ftir/BandIntegrator.tsx   # NEW
MFP_analysis_app/web/frontend/src/components/ftir/HitList.tsx          # NEW
```

---

## 6 · Acceptance checklist

After Phase A:
- [ ] `npx tsc --noEmit` passes (frontend) — 0 errors
- [ ] `pytest backend/tests/test_ftir_assignment.py -q` — all 4 demo cases pass
- [ ] Manual: load a known PET spectrum, see `Ester C=O` at 1715 (not generic C=O / aromatic)
- [ ] Manual: load a known nylon-6 spectrum, see `Amide I` at 1640 + `Amide II` at 1540, NOT `C=C`
- [ ] Manual: tick "exclude amides" in the Constraints card → labels regenerate; no amide on amide-bearing spectrum
- [ ] Manual: click a peak label, change to a different band via dropdown → annotation updates, override persists in workspace JSON, exported CSV's `plot_label` column reflects the user choice
- [ ] Manual: right-click a label on the chart → context menu → "Hide" → label disappears, reappears with "Reset to auto"

After Phase B:
- [ ] AsLS slider produces visibly different baseline than polyfit on a wide-band polymer spectrum
- [ ] SNV normalization makes overlay of 3 spectra visually align in shape
- [ ] CO₂ doublet at 2350 disappears with "Mask atmospheric" on

After Phase D:
- [ ] Loading a polyethylene spectrum lists "PE" at top of hit list with > 0.85 correlation

---

## Appendix A — Seed band list for `ftir_library_v3.json`

Compile the following into the JSON. Sources: Coates 2000 (Encyclopedia of Analytical Chemistry, Wiley); Socrates 2001 (Infrared and Raman Characteristic Group Frequencies, 3rd ed.); Stuart 2004; Pavia et al. 2014; Barth 2007 (BBA Bioenergetics 1767:1073–1101 — definitive amide); Koenig 1999 (Spectroscopy of Polymers); NIST Chemistry WebBook; SDBS (AIST Japan).

### A1 — 4000–2500 cm⁻¹ (X–H stretches)

| id | range_cm1 | primary group | subcategory | I | shape | confirms | excludes |
|----|-----------|---------------|-------------|---|-------|----------|----------|
| oh_free | [3580, 3650] | Free O–H stretch | oh_free | s | sharp | — | — |
| oh_h_bonded | [3200, 3550] | H-bonded O–H stretch | oh | s | broad | c_o_alcohol | broad_oh_acid |
| oh_acid_broad | [2500, 3300] | Carboxylic acid O–H | oh | s | very_broad | acid_co (1680–1725), acid_oh_bend (1410), acid_co_stretch (1280) | — |
| nh_primary | [3300, 3500] | Primary amine/amide N–H (asym + sym = doublet) | nh | m | sharp | nh_primary_pair (3170–3300) | — |
| nh_secondary | [3250, 3400] | Secondary amine/amide N–H | nh | m | sharp | amide_I, amide_II | — |
| nh_alkyne | [3290, 3320] | ≡C–H terminal alkyne | alkyne_ch | s | very_sharp | alkyne_cc_terminal | — |
| ch_aromatic | [3000, 3100] | =C–H aromatic / vinyl | aromatic_ch | w-m | sharp | aromatic_cc_1600, aromatic_cc_1500, ar_oop (700–900) | — |
| ch_sp3_ch3_asym | [2940, 2980] | CH₃ asym stretch | alkane_ch | s | sharp | ch3_sym_bend, ch_sp3_ch3_sym | — |
| ch_sp3_ch3_sym | [2860, 2890] | CH₃ sym stretch | alkane_ch | m | sharp | ch3_sym_bend | — |
| ch_sp3_ch2_asym | [2900, 2940] | CH₂ asym stretch | alkane_ch | s | sharp | ch2_scissor (1450–1470), ch2_rock (720) | — |
| ch_sp3_ch2_sym | [2840, 2870] | CH₂ sym stretch | alkane_ch | m | sharp | ch2_scissor | — |
| aldehyde_ch_fermi | [2700, 2830] | Aldehyde C–H (Fermi doublet) | alkane_ch | w | sharp | aldehyde_co (1720–1740) | — |
| sh_stretch | [2550, 2600] | S–H stretch | sulfur | w | sharp | — | — |

### A2 — 2500–2000 cm⁻¹ (triple bonds + cumulenes)

| id | range_cm1 | primary group | subcategory | I | shape |
|----|-----------|---------------|-------------|---|-------|
| nitrile_cn | [2220, 2260] | C≡N nitrile | nitrile | m-s | sharp |
| alkyne_cc_internal | [2190, 2260] | Internal C≡C | alkyne_cc | w | sharp |
| alkyne_cc_terminal | [2100, 2150] | Terminal C≡C | alkyne_cc | w-m | sharp |
| atm_co2 | [2310, 2390] | Atmospheric CO₂ doublet | atmospheric | v | sharp |
| isocyanate | [2250, 2280] | N=C=O isocyanate | nitrile | vs | sharp |
| azide_carbodiimide | [2100, 2150] | N=N=N / N=C=N | nitrile | s | sharp |

### A3 — 2000–1500 cm⁻¹ (the diagnostic double-bond region)

| id | range_cm1 | primary group | subcategory | I | shape | confirms | excludes |
|----|-----------|---------------|-------------|---|-------|----------|----------|
| anhydride_co_high | [1800, 1870] | Anhydride C=O (asym) | carbonyl/anhydride | s | sharp | anhydride_co_low | — |
| anhydride_co_low | [1740, 1790] | Anhydride C=O (sym) | carbonyl/anhydride | s | sharp | anhydride_co_high | — |
| acid_chloride_co | [1770, 1815] | Acid chloride C=O | carbonyl/acid_chloride | s | sharp | — | — |
| ester_co | [1735, 1750] | Ester C=O | carbonyl/ester | s | sharp | ester_co_asym (1230–1310), ester_co_sym (1150–1210) | broad_oh_acid, amide_nh |
| aldehyde_co | [1720, 1740] | Aldehyde C=O | carbonyl/aldehyde | s | sharp | aldehyde_ch_fermi | — |
| ketone_co | [1705, 1725] | Ketone C=O | carbonyl/ketone | vs | sharp | — | broad_oh_acid, amide_nh, ester_co_sym |
| acid_co | [1700, 1725] | Carboxylic acid C=O | carbonyl/acid | s | sharp | oh_acid_broad | — |
| amide_I_primary | [1645, 1690] | Amide I (primary) | amide/amide_I | s | sharp | nh_primary, amide_II | — |
| amide_I_secondary | [1630, 1680] | Amide I (secondary) | amide/amide_I | s | sharp | nh_secondary, amide_II | — |
| amide_I_tertiary | [1630, 1670] | Amide I (tertiary) | amide/amide_I | s | sharp | amide_II | — |
| alkene_cc_isolated | [1620, 1680] | Alkene C=C (isolated) | alkene_cc | w-m | sharp | alkene_ch_oop | nh_primary, nh_secondary, amide_II |
| imine_cn | [1600, 1660] | Imine C=N | imine | v | sharp | — | — |
| aromatic_cc_lower | [1580, 1620] | Aromatic C=C ring (lower) | aromatic_cc | m-v | sharp | aromatic_cc_upper, ar_oop | — |
| amide_II | [1490, 1580] | Amide II (N–H bend + C–N stretch) | amide/amide_II | s | sharp | amide_I_secondary OR amide_I_primary | — |
| aromatic_cc_upper | [1490, 1550] | Aromatic C=C ring (upper) | aromatic_cc | m | sharp | aromatic_cc_lower | — |
| nitro_asym | [1500, 1570] | NO₂ asymmetric | fingerprint | vs | sharp | nitro_sym | — |
| nitro_sym | [1300, 1380] | NO₂ symmetric | fingerprint | vs | sharp | nitro_asym | — |

### A4 — 1500–1000 cm⁻¹ (fingerprint)

| id | range_cm1 | primary group | subcategory | I | notes |
|----|-----------|---------------|-------------|---|-------|
| ch2_scissor | [1450, 1470] | CH₂ scissor / CH₃ asym bend | alkane_ch | m | ubiquitous |
| ch3_sym_bend | [1365, 1390] | CH₃ sym bend (umbrella) | alkane_ch | m | doublet at 1385/1370 → gem-dimethyl |
| oh_bend | [1330, 1420] | O–H in-plane bend | oh | m | — |
| amide_III | [1250, 1310] | Amide III | amide | w-m | protein secondary structure |
| ester_co_asym | [1230, 1310] | Ester C–O asym stretch | co_single | s | confirms ester_co |
| ester_co_sym | [1150, 1210] | Ester C–O sym stretch | co_single | s | confirms ester_co |
| amine_cn | [1020, 1250] | C–N amine stretch | cn_single | m | — |
| co_alcohol_primary | [1000, 1075] | Primary C–O alcohol | co_single | s | ~1050 |
| co_alcohol_secondary | [1075, 1125] | Secondary C–O alcohol | co_single | s | ~1100 |
| co_alcohol_tertiary | [1125, 1175] | Tertiary C–O alcohol | co_single | s | ~1150 |
| ar_ether | [1220, 1260] | Aromatic ether (Ar–O–C) | co_single | s | anisole-type |
| ether_coc | [1050, 1150] | Aliphatic ether C–O–C asym | co_single | s | — |
| si_o | [1000, 1100] | Si–O–Si / Si–O–C | silicon | vs | silicones |
| sulfoxide | [1030, 1080] | S=O sulfoxide / sulfonate | sulfur | s | — |
| sulfone_high | [1300, 1370] | SO₂ sulfone (asym) | sulfur | vs | doublet with sulfone_low |
| sulfone_low | [1130, 1180] | SO₂ sulfone (sym) | sulfur | vs | — |

### A5 — 1000–400 cm⁻¹ (out-of-plane bends, halides)

| id | range_cm1 | primary group | subcategory | notes |
|----|-----------|---------------|-------------|-------|
| alkene_ch_oop_vinyl | [890, 1000] | Vinyl =C–H oop (doublet) | alkene_ch | 990 + 910 |
| alkene_ch_oop_trans | [960, 990] | trans-disubstituted | alkene_ch | — |
| alkene_ch_oop_cis | [665, 730] | cis-disubstituted | alkene_ch | — |
| ar_oop_mono | [680, 770] | Aromatic monosubstituted (doublet) | aromatic_ch | 750 + 690 unmistakable |
| ar_oop_para | [810, 850] | Aromatic para-substituted | aromatic_ch | — |
| ar_oop_ortho | [735, 770] | Aromatic ortho-substituted | aromatic_ch | — |
| c_cl | [600, 800] | C–Cl | halide | — |
| c_br_ci | [500, 700] | C–Br, C–I | halide | — |
| ch2_rock_pe | [715, 730] | CH₂ rocking (long chain) | alkane_ch | PE marker, doublet in HDPE |

### A6 — Polymer hint table (for the hit list and tooltips)

```json
{
  "PE":  { "diagnostic_peaks": [2915, 2845, 1465, 720], "absent": ["1715", "1600"] },
  "PP":  { "diagnostic_peaks": [2950, 2915, 1455, 1375, 1165, 995, 970], "absent": ["1715", "1600"] },
  "PS":  { "diagnostic_peaks": [3025, 2920, 1600, 1490, 750, 700], "must_have": ["750+700 doublet"] },
  "PET": { "diagnostic_peaks": [1715, 1240, 1090, 870, 720, 1410], "category": "ester+aromatic" },
  "Nylon-6":  { "diagnostic_peaks": [3300, 2930, 1640, 1540, 1260], "category": "secondary amide" },
  "Nylon-6,6":{ "diagnostic_peaks": [3300, 2930, 1640, 1540, 1260], "category": "secondary amide" },
  "PMMA":{ "diagnostic_peaks": [2995, 2950, 1730, 1450, 1240, 1190, 1150, 750] },
  "Cellulose":{ "diagnostic_peaks": [3330, 2900, 1640, 1430, 1370, 1160, 1110, 1030], "category": "polysaccharide" },
  "Chitosan": { "diagnostic_peaks": [3360, 2870, 1650, 1590, 1380, 1070, 1020], "must_have": ["1590"] },
  "PLA":  { "diagnostic_peaks": [2995, 2945, 1750, 1450, 1380, 1180, 1080, 870, 755], "category": "ester" },
  "PVA":  { "diagnostic_peaks": [3300, 2940, 1735, 1430, 1090], "notes": "1735 amplitude reveals hydrolysis degree" },
  "Polyurethane":{ "diagnostic_peaks": [3320, 2940, 2860, 1730, 1700, 1530, 1220, 1100], "category": "ester+amide" }
}
```

---

## Appendix B — Drop-in disambiguation rules (quick reference for the scoring engine)

> Apply these AFTER the range-based scoring, BEFORE returning the top candidate.

1. **1700–1750**:
   - if 1150–1310 has 2 peaks → **ester** wins
   - else if 2700–2830 doublet present → **aldehyde**
   - else if 2500–3300 very broad → **carboxylic acid**
   - else → **ketone**

2. **1600–1700**:
   - if 3270–3340 (N–H) AND 1510–1580 (Amide II) → **Amide I**
   - elif 1490–1620 paired band → **aromatic ring**
   - else (no N–H, no aromatic pair) → **alkene C=C**

3. **3200–3550**:
   - if extends down to 2500 (very broad merge with C–H) AND 1700–1725 present → **carboxylic acid O–H**
   - elif sharp pair (3170–3300 + 3300–3500) → **primary amine/amide N–H**
   - elif single sharp at 3300 with 2100 partner → **alkyne ≡C–H**
   - else → **alcohol O–H** (broad)

4. **1450–1470**:
   - default to CH₂ scissor (always present in aliphatics — low diagnostic value)
   - if 1385/1370 pair AND no other diagnostic → suggest **isopropyl/tert-butyl**

---

**End of plan.** This document is self-contained and intended for direct ingestion by Codex. All file paths, function names, JSON schemas, API contracts, and acceptance criteria are explicit.
