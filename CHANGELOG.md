# Changelog

## Unreleased

### Results affected

Re-check analyses made before these fixes if they relied on the items below.

- **LCMS polymer / expected-product labels for charge ≥ 2** (plan 1.1). Multiply charged ions were predicted as `(M + 1·H)/z` instead of `(M + z·H)/z`, so real `[M+2H]²⁺`/`[M+3H]³⁺` ions went unlabelled and labels read `[M+H]²⁺`. Na/K/Cl/formate/acetate adducts are now matched at z = 1 only (previously also at z > 1 with a single adduct mass). Affects spectrum labels and the Expected Products table whenever the charges field included values above 1.
- **LCMS spectrum polymer labels with zero-valued settings** (plan 1.2). `bond_delta = 0` (addition polymers) was silently replaced by −18.0106, `adduct_mass = 0` by +1.0073 and `min_rel_int = 0` by 0.01 in server-side spectrum labels. The Expected Products table was not affected.
- **Expected Products table variants** (plan 1.3). The table now also lists combined modifications (e.g. `+O-CO2`, `-CO2-H2O`), as the spectrum labels already did, so both views agree.
- **Negative-mode anion adducts** (plan 1.3). Cl⁻, HCOO⁻ and CH₃COO⁻ adduct masses now include the electron (+0.00055 Da; < 1 ppm at m/z 700). Only matters at very tight tolerances.
- **LCMS retention times** (plan 1.4). The time unit declared in the mzML file is now always used. Before, the Display tab's "RT unit" choice was also sent at upload and treated as the file's unit: files uploaded while it was set to *seconds* had their times divided by 60 (a 20-min run appeared as 20 s), and files stored in seconds uploaded with *minutes* appeared 60× too long. Re-upload affected files; old index caches are ignored automatically.
- **LCMS polarity filter** (plan 1.5). Requesting a polarity the file doesn't contain used to silently return the other polarity's scans (e.g. a "negative" EIC or spectrum built from positive scans, including in dual mode). It now reports that the file has no scans of that polarity; in dual mode the available polarity is still shown.
- **Plate Reader MIC 4PL fit** (plan 1.6). With the default auto tick labels (1024, 512, …, 0) the curve was fitted to those placeholder numbers, so the reported IC₅₀ was in meaningless units (e.g. 32.1 for a true 2.0 µg/mL), and with auto labels off the column headers were used. A fit is now only made from concentrations typed into *Tick labels*; bars and curve share a log₂ concentration axis; IC₅₀ is shown with its standard error and flagged when outside the tested range. **Any IC₅₀ reported before this change should be recomputed.**
- **Plate Reader blank-subtraction error bars** (plan 1.6). Error bars now add the standard error of the blank mean (blank SD/√n) instead of the blank SD, so they are slightly smaller than before.
- **Plate Reader concentrations are stored per plate** (plan 1.6). Previously the tick labels typed for one plate were silently reused for the next.

### Fixed

- LCMS single-scan deconvolution (no RT range) always failed with a server error; it now works (plan 1.5).

### Removed

- SI package export (`/api/publication/si-package`) is disabled: it wrote placeholder numbers and a fixed methods text instead of real results. It will be rebuilt from stored analysis results (plan Phase 5). **Any SI package downloaded before this change should not be used.**
