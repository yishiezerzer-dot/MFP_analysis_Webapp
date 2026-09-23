# Changelog

## Unreleased

### Results affected

Re-check analyses made before these fixes if they relied on the items below.

- **LCMS polymer / expected-product labels for charge ≥ 2** (plan 1.1). Multiply charged ions were predicted as `(M + 1·H)/z` instead of `(M + z·H)/z`, so real `[M+2H]²⁺`/`[M+3H]³⁺` ions went unlabelled and labels read `[M+H]²⁺`. Na/K/Cl/formate/acetate adducts are now matched at z = 1 only (previously also at z > 1 with a single adduct mass). Affects spectrum labels and the Expected Products table whenever the charges field included values above 1. The same bug existed in a third copy used by the AI assistant / MCP automation action `lcms.compute_expected_products`, which is also fixed.
- **LCMS spectrum polymer labels with zero-valued settings** (plan 1.2). `bond_delta = 0` (addition polymers) was silently replaced by −18.0106, `adduct_mass = 0` by +1.0073 and `min_rel_int = 0` by 0.01 in server-side spectrum labels. The Expected Products table was not affected.
- **Expected Products table variants** (plan 1.3). The table now also lists combined modifications (e.g. `+O-CO2`, `-CO2-H2O`), as the spectrum labels already did, so both views agree.
- **Negative-mode anion adducts** (plan 1.3). Cl⁻, HCOO⁻ and CH₃COO⁻ adduct masses now include the electron (+0.00055 Da; < 1 ppm at m/z 700). Only matters at very tight tolerances.
- **LCMS retention times** (plan 1.4). The time unit declared in the mzML file is now always used. Before, the Display tab's "RT unit" choice was also sent at upload and treated as the file's unit: files uploaded while it was set to *seconds* had their times divided by 60 (a 20-min run appeared as 20 s), and files stored in seconds uploaded with *minutes* appeared 60× too long. Re-upload affected files; old index caches are ignored automatically.
- **LCMS polarity filter** (plan 1.5). Requesting a polarity the file doesn't contain used to silently return the other polarity's scans (e.g. a "negative" EIC or spectrum built from positive scans, including in dual mode). It now reports that the file has no scans of that polarity; in dual mode the available polarity is still shown.
- **Plate Reader MIC 4PL fit** (plan 1.6). With the default auto tick labels (1024, 512, …, 0) the curve was fitted to those placeholder numbers, so the reported IC₅₀ was in meaningless units (e.g. 32.1 for a true 2.0 µg/mL), and with auto labels off the column headers were used. A fit is now only made from concentrations typed into *Tick labels*; bars and curve share a log₂ concentration axis; IC₅₀ is shown with its standard error and flagged when outside the tested range. **Any IC₅₀ reported before this change should be recomputed.**
- **Plate Reader blank-subtraction error bars** (plan 1.6). Error bars now add the standard error of the blank mean (blank SD/√n) instead of the blank SD, so they are slightly smaller than before.
- **Plate Reader concentrations are stored per plate** (plan 1.6). Previously the tick labels typed for one plate were silently reused for the next.
- **FTIR transmittance spectra** (plan 1.7). Transmittance data were baseline-corrected, normalised and integrated as-is, but every baseline method estimates a lower envelope, which for %T runs through the absorption bands and inverts or distorts intensities (e.g. a 0.8 A band became 0 or −46 after correction). Transmittance is now converted to absorbance (A = −log₁₀T) before any processing, so displayed y-values, peak heights, integrated areas and fit components are in absorbance. The default mode was *transmittance* with an airPLS baseline, so **FTIR intensities, areas and amide-I percentages from before this change may be wrong** unless the mode matched the data and no baseline was used. The y-mode is now detected per file on upload.
- **FTIR pseudo-Voigt fits** (plan 1.8). The Voigt profile mixed a Gaussian and a Lorentzian of different widths and reported FWHM with an approximate factor (0.9 % error). It now uses a shared FWHM, so reported widths are exact for the profile; fitted component shapes, widths and area percentages from the Voigt option can differ slightly from before.
- **FTIR "atmospheric" mask** (plan 1.8). The mask removed 1340–1900 and 3400–4000 cm⁻¹ (all carbonyl, amide I/II, O–H/N–H bands) from peak picking; it now removes only the CO₂ doublet (2310–2390 cm⁻¹). It was on in the *KBr disc* and *Polymer thin film* presets, so peaks in those regions were missing from picked-peak lists made with those presets.
- **LCMS UV trace time axis** (plan 1.9). Headerless UV CSVs whose times went above 60 were assumed to be in seconds and divided by 60 (a 70-min run became ~1.2 min), and the first data row of headerless files was dropped as a header. Headerless files are now read in full and assumed to be minutes unless *UV CSV time unit* (Display tab) says otherwise; headers such as `Time (sec)` are still recognised.
- **LCMS EIC peak integration with a reference RT** (plan 1.10). The apex was the raw local maximum nearest the reference RT, so a single noisy point on a peak's shoulder could be integrated instead of the peak. Candidates now come from a 3-point moving average and must reach 5 % of the trace maximum; height and area are still computed from the raw data. Integrations of clean peaks are unchanged.

### Changed

- LCMS feature-table CSV column `Area` renamed to `AreaCountsMin`, and areas are labelled *counts·min* in the UI (plan 1.10). Update any spreadsheet that reads the old column name.

### Fixed

- **FTIR peak fits that failed to converge** were shown as results: the table then contained the initial guesses (with an R²) instead of fitted values. Failed fits are now flagged with a warning (plan 2.2). Asking for more components than detected peaks crashed the fit; it now works.
- Saved sessions whose files are missing or unreadable after a restart no longer disappear silently: a banner lists them with the reason, and the server log records the error (plan 2.2).
- Data Studio works with pandas 3: decimal-comma files kept text columns unconverted and the *fill forward* step failed (plan 2.3). The deployed version stays pinned to pandas 2.3 until an upgrade is tested.
- Data Studio sheet, header-row and decimal-comma choices are kept after a server restart instead of resetting to defaults (plan 2.4).
- Data Studio *baseline* step with a missing first value turned the whole column empty; it now leaves the column unchanged and shows a warning (plan 2.2).
- LCMS single-scan deconvolution (no RT range) always failed with a server error; it now works (plan 1.5).
- Attached UV traces disappeared after every server restart (the restore call was missing an argument and the error was swallowed); they are now restored (plans 1.9 / 2.1).
- FTIR import of plain comma- or semicolon-separated two-column files (without an `XYDATA` marker) failed with "File must contain at least two numeric columns"; they now load (plan 1.7). Semicolon files with decimal commas are still not supported.

### Removed

- FTIR "MSC" normalisation: the single-spectrum version regressed the spectrum on its own polynomial fit, which always returns it unchanged (a no-op). Saved settings using it switch to *none* (plan 1.8).

- SI package export (`/api/publication/si-package`) is disabled: it wrote placeholder numbers and a fixed methods text instead of real results. It will be rebuilt from stored analysis results (plan Phase 5). **Any SI package downloaded before this change should not be used.**
