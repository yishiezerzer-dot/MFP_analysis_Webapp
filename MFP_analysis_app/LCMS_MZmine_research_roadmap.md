# Focused LCMS Roadmap for Prebiotic Small-Oligomer Chemistry

This app is not trying to become a full professional metabolomics platform. The goal is to make LCMS work faster and clearer for prebiotic chemistry, small monomer systems, and 2-3 unit oligomers.

For that use case, the most useful features are the ones that answer:

- Is this m/z a real chromatographic peak or just noise?
- Is this peak actually a known adduct, dehydration product, cluster, dimer, or trimer?
- Do related oligomer peaks form a recognizable series?
- How do expected products compare across samples, batches, controls, and reaction conditions?

## UI/UX Direction

Keep the current UI/UX style. New analytical features should feel like natural extensions of the existing app, not a separate complicated software package.

Guidelines:

- Do not clutter the main screen with every new function.
- Put new controls in the relevant existing section whenever possible.
- Keep the main workflow centered on the current plots: TIC, EIC, UV, and MS1 spectrum.
- Prefer contextual actions over permanent buttons. For example, clicking an MS1 peak can offer EIC/adduct/product actions near the spectrum instead of adding many global buttons.
- Keep advanced settings inside dialogs or collapsible sections.
- Use clear section names such as EIC, MS1 annotations, Expected products, Kendrick plot, and Feature table.
- Keep default views simple; advanced analysis should be easy to access but not always visible.
- Avoid turning the sidebar into a long list of unrelated tools.
- Keep visual styling consistent with the current app: compact controls, restrained colors, plot-first layout, and practical labels.
- Each new feature should answer a specific research question and should have an obvious place in the workflow.

Suggested placement:

- **Click MS1 peak to generate EIC**: spectrum plot interaction, with EIC tolerance in EIC settings.
- **Adduct/neutral-loss annotation**: MS1 annotation/polymer matching section.
- **Expected products library**: polymer/chemistry section, with results linked to MS1 and EIC.
- **Kendrick mass defect plot**: analysis view or optional plot panel, opened from expected products/polymer tools.
- **Feature table**: its own table panel below/near plots, not mixed into plot controls.
- **Multi-sample matrix**: export/comparison section after feature table exists.

## Implementation Status

- [x] ~~Click MS1 peak to generate EIC~~
- [x] ~~Adduct / cluster / neutral-loss annotation~~
- [x] ~~Expected products / oligomer library~~
- [x] ~~Kendrick mass defect plot~~
- [x] ~~Lightweight feature table and integration~~
- [ ] Multi-sample comparison matrix

## Top Priority Features

### 1. Click MS1 Peak to Generate EIC - Done

This is the single most useful day-to-day workflow upgrade.

Implemented behavior:

- Clicking a peak/bar in the MS1 spectrum creates a new EIC for that m/z.
- The EIC uses the current EIC tolerance.
- The generated EIC is appended to the existing EIC plots instead of replacing them.
- The EIC input is updated to the clicked m/z for visibility/reuse.
- If the EIC has a strongest RT, the app loads the MS1 spectrum at that RT.

Current workflow:

1. Inspect TIC or summed region MS1.
2. Notice an interesting m/z.
3. Manually type that m/z into EIC.
4. Check whether it forms a real chromatographic peak.

Better workflow:

1. Click an m/z peak in the MS1 spectrum.
2. The app automatically creates an EIC using the current m/z tolerance.
3. The EIC appears below, either as a separate plot or in the EIC overlay.

Why it matters:

- Confirms whether an MS1 peak has a sensible RT shape.
- Helps distinguish real LC peaks from noise, carryover, contaminants, and random scan spikes.
- Saves a lot of repeated typing.
- Fits the existing app extremely well because it already has MS1 spectra, EICs, and EIC overlays.

Suggested controls:

- Default EIC tolerance in Da or ppm.
- Modifier option: click peak normally to select, click a button or shortcut to create EIC.
- Add peak m/z to EIC title automatically.
- Keep EICs persistent until cleared.

Relevant MZmine idea:

- Linked chromatogram-spectrum navigation and XIC/EIC extraction.
- Source: https://mzmine.github.io/mzmine_documentation/visualization_modules/raw_data_overview/raw_data_overview.html

## 2. Adduct / Cluster / Neutral-Loss Annotation on MS1 - Done

Implemented behavior:

- Polymer/reaction matching now supports explicit water-loss annotation (`-H2O`).
- MS1 labels now use clearer ion notation such as `[M+H]+`, `[M+Na]+`, `[M+K]+`, `[M-H]-`, and `[2M+H]+`.
- Positive mode can annotate proton, sodium, potassium, water-loss, and noncovalent 2M cluster matches.
- Negative mode can annotate deprotonated, chloride, formate, acetate, water-loss, and noncovalent 2M cluster matches.
- The Polymer / Reaction Match dialog includes a small-oligomer MS1 annotation preset that enables the most relevant adduct/cluster/water-loss options without adding clutter to the main screen.

For small monomers, dimers, and trimers, the same molecule often appears as several related peaks. Without adduct annotation, it is easy to waste time treating adducts as new products.

Add MS1 annotations for expected relationships such as:

- `[M+H]+`
- `[M+Na]+`
- `[M+K]+`
- `[M-H]-`
- `[M+Cl]-`
- `[M+formate]-`
- `[M+acetate]-`
- `[M-H2O+H]+`
- `[M+H-H2O]+`
- `[2M+H]+`
- `[2M+Na]+`
- dehydration variants
- oxidation / decarboxylation variants if relevant to the current polymer settings

Why it matters:

- Prevents chasing the same molecule multiple times.
- Makes MS1 spectra easier to interpret.
- Pairs naturally with the existing polymer matching.
- Useful even without MS2.

Suggested behavior:

- In MS1 spectrum, annotate related peaks with adduct labels.
- Group related ions under a shared neutral mass.
- Show mass error for each match.
- Let user enable/disable adduct families.
- Allow positive-mode and negative-mode presets.

Best first version:

- Use the current polymer/product candidate masses.
- For each candidate neutral mass, predict common adduct m/z values.
- Match predicted adducts against observed MS1 peaks.
- Display labels and a compact evidence table.

Relevant MZmine idea:

- Ion identity/adduct networking.
- Source: https://mzmine.github.io/mzmine_documentation/module_docs/id_ion_networking/iin/iin.html

## 3. Kendrick Mass Defect Plot

This is especially relevant for repeating monomer systems.

Implemented behavior:

- Polymer tools now include a `Kendrick Plot...` dialog for the currently displayed MS1 spectrum or summed TIC-region MS1.
- The dialog can use a selected monomer as the repeat unit or a custom repeat-unit mass.
- It filters peaks by relative intensity, calculates Kendrick mass and Kendrick mass defect, and plots the results.
- The x-axis can show either observed m/z or Kendrick nominal mass.
- The plot detects repeated horizontal KMD lines using a configurable KMD tolerance and minimum point count.
- Detected series are color-coded, optionally labeled on the plot, and summarized in a compact table.

Kendrick mass defect plots are useful because oligomers built from the same repeat unit tend to align into recognizable series. For your chemistry, that can help spot monomer-dimer-trimer ladders quickly.

Why it matters:

- Very good fit for small repeating monomer/oligomer systems.
- Helps reveal series that are hard to see in raw MS1 spectra.
- Can separate related oligomers from unrelated background peaks.
- More targeted and useful for your app than broad metabolomics dashboards.

Suggested behavior:

- User chooses a repeat unit, such as glycine, alanine, lactate, or a custom monomer mass.
- App calculates Kendrick mass and Kendrick mass defect for detected peaks or the current MS1 spectrum.
- Plot:
  - x-axis: Kendrick nominal mass or m/z
  - y-axis: Kendrick mass defect
  - point size/color: intensity
  - color/facet by RT, sample, or polarity
- Points in a horizontal line suggest an oligomer series.

Useful controls:

- repeat unit mass
- polarity/adduct assumption
- intensity threshold
- RT region filter
- use current MS1, summed TIC region, or feature table
- label likely monomer/dimer/trimer points

Best first version:

- Use peaks from the currently displayed MS1 spectrum or summed region MS1.
- Let user pick one repeat mass.
- Draw KMD scatter plot and label points that align within tolerance.

Relevant MZmine idea:

- Specialized chemical-space visualizations such as Kendrick and Van Krevelen style plots.
- Related source: https://mzmine.github.io/mzmine_documentation/visualization_modules/vankrevelen/van_krevelen_plot.html

## 4. Expected Products / Oligomer Library Panel

Implemented behavior:

- Polymer tools now include an `Expected Products...` dialog.
- The dialog generates expected oligomer products from the currently selected monomers, with the max oligomer size adjustable up to 20.
- It applies the current polymer/reaction settings: bond delta, extra delta, charges, adducts, water loss, oxidation, decarboxylation, and 2M clusters.
- It matches expected m/z values against the currently displayed MS1 spectrum or summed region MS1.
- It includes a low-resolution matching mode for instruments where m/z precision is closer to one decimal place; this mode applies a wider Da tolerance while keeping normal tolerance mode available.
- Matched rows show expected m/z, observed m/z, mass error, ppm error, and intensity.
- Each row has an `EIC` action to create a chromatogram for the observed m/z or expected m/z.
- Unmatched candidates are hidden by default to keep the table focused, but can be shown from inside the dialog.

Instead of broad metabolomics database search, the app should generate a small targeted library from the chemistry being tested.

For each selected monomer system, generate expected products:

- monomer
- dimer
- trimer
- mixed dimers/trimers for 2-3 monomer systems
- dehydrated products
- oxidized products
- decarboxylated products
- common adducts
- clusters

Why it matters:

- This matches the actual research question better than generic compound databases.
- Keeps interpretation focused.
- Turns polymer matching into a structured expected-product workflow.
- Makes comparison across samples much clearer.

Suggested table columns:

- product formula/name
- composition, for example `2 Gly + 1 Ala - H2O`
- neutral mass
- expected adduct m/z values
- observed m/z
- mass error
- RT
- intensity or area
- detected in which samples
- confidence / evidence tags

Best first version:

- Generate expected monomer/dimer/trimer masses from selected monomers.
- Match against current MS1 or summed region MS1.
- Show hits in a table.
- Clicking a row highlights the MS1 peak and generates an EIC.

Relevant MZmine ideas:

- Local compound database search and formula/adduct-aware annotation.
- Sources:
  - https://mzmine.github.io/mzmine_documentation/module_docs/id_prec_local_cmpd_db/local-cmpd-db-search.html
  - https://mzmine.github.io/mzmine_documentation/module_docs/id_spectra_chem_formula/chem-formula-pred.html

## 5. Lightweight Feature Table and Peak Integration

This is still important, but for this app it should be lightweight and targeted rather than a full untargeted metabolomics pipeline.

Implemented behavior:

- Every generated EIC plot now has an `Integrate` action; EIC overlay mode has `Integrate all`.
- Integration finds the strongest EIC apex, estimates a local baseline, expands the RT window to points above 5% of peak height, and calculates baseline-corrected trapezoid area.
- Integrated rows are stored in a `Feature table...` dialog available from Primary Actions.
- Feature rows include m/z, tolerance, polarity, RT apex, RT start/end, height, area, source file, and expected-product evidence when the EIC came from the expected-products table.
- The feature table can remove individual rows, clear all rows, export CSV, and is saved into LCMS workspace files.

The goal is not to detect every possible metabolite. The goal is to quantify relevant LCMS peaks.

Suggested feature fields:

- feature ID
- m/z
- RT apex
- RT start/end
- height
- area
- polarity
- source file
- matched expected product
- adduct/neutral-loss annotation
- polymer/oligomer match

Why it matters:

- Makes the app quantitative.
- Enables sample comparison.
- Enables export to CSV.
- Gives expected products a measured peak area/height.

Best first version:

- Integrate EICs that the user has generated manually or by clicking MS1 peaks.
- Use simple peak apex and area calculation.
- Store integrated results in a feature table.
- Let user export the table.

Relevant MZmine ideas:

- Chromatogram building, feature detection, and feature filtering.
- Sources:
  - https://mzmine.github.io/mzmine_documentation/module_docs/lc-ms_featdet/featdet_adap_chromatogram_builder/adap-chromatogram-builder.html
  - https://mzmine.github.io/mzmine_documentation/module_docs/feature_filter/feature_filter.html

## 6. Multi-Sample Comparison Matrix

Once features can be integrated, compare them across samples.

Suggested behavior:

- Rows: expected products or integrated features.
- Columns: loaded samples.
- Values: peak area or peak height.
- Optional grouping: control, blank, timepoint, batch, condition.

Why it matters:

- Directly answers which reactions produced which oligomers.
- Helps compare batches and screening conditions.
- More useful for this project than PCA/statistics dashboards at the beginning.

Best first version:

- Use the expected-products table as rows.
- For each loaded sample, extract/integrate EIC around expected m/z values.
- Export matrix as CSV.

Relevant MZmine ideas:

- Feature alignment and feature list export.
- Sources:
  - https://mzmine.github.io/mzmine_documentation/module_docs/align_join_aligner/join_aligner.html
  - https://mzmine.github.io/mzmine_documentation/module_docs/io/feat-list-export.html

## What I Would Not Prioritize Now

These are powerful MZmine features, but they are probably too much for the current research use case:

- full untargeted metabolomics workflow
- complex ADAP deconvolution as a first milestone
- MS/MS library networking unless the data consistently includes useful MS2
- lipidomics-specific workflows
- PCA/volcano/statistics dashboard before feature quantification exists
- full GNPS/network export
- 3D LCMS surface plots

## Final Recommended Build Order

1. **Click MS1 peak to generate EIC**
   - Highest day-to-day payoff.
   - Fits the current app immediately.

2. **Adduct / cluster / neutral-loss annotation**
   - Prevents misinterpreting related peaks as new products.
   - Builds naturally on existing polymer matching.

3. **Expected products / oligomer library**
   - Generate monomer/dimer/trimer candidates for the specific chemistry.
   - Match them against MS1 and EIC data.

4. **Kendrick mass defect plot**
   - Especially useful for repeating monomer units.
   - Great for spotting oligomer ladders visually.

5. **Lightweight feature table and integration**
   - Quantify selected/expected peaks.
   - Export useful results.

6. **Multi-sample comparison matrix**
   - Compare expected products across samples, controls, and batches.

This keeps the app focused on prebiotic oligomer chemistry rather than turning it into a heavy general-purpose metabolomics platform.
