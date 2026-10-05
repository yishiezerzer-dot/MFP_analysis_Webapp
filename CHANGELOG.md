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

- **Easier for new users, stage 4: recorded walkthroughs.** Each guided workflow has a short animated walkthrough, recorded on the example data, in the help: LCMS and FTIR *Overview*, Plate Reader *Overview*, and *Prepare for paper* under LCMS *Exports* and Plate Reader *Experiment*. `frontend/scripts/walkthroughs` re-records them when the screens change.
- **Analyse a MIC plate** now prefills the dilution series, growth control, blank rows and a same-plate reference from a plate that already has a layout, not just the compounds. Before, running it on such a plate could clear its blank rows.
- **Easier for new users, stage 3: guided workflows.** A **Guide me** button asks one question per screen, with an "I don't know" explanation for each and a summary of what it will do before it runs. Answers are remembered for next time.
  - **Analyse a MIC plate** (Plate Reader, Home): which plate, compounds and rows (filled in from Gen5 notes), dilution series, growth control and blank, and the reference antibiotic on the same or another plate. It lays out the plate and opens Results.
  - **Find my product** (LCMS, Home): which run, its monomers and/or the product's mass, and the ionisation (polarity, adducts, charges). It switches polarity, turns on chain labels for those monomers, and draws an EIC for each ion of the product. It then shows the spectrum where the product is strongest; with only monomers, it opens Expected Products at the biggest TIC peak.
  - **Identify FTIR peaks** (FTIR, Home): which spectrum, how it was measured (ATR, KBr, film), groups that cannot be present, and how many peaks. It applies the preset, picks the peaks and assigns them from the bond library.
  - **Prepare for paper** (experiment tag menu, Home): saves the charts on screen as SVG and PNG at a journal's size (ACS, Nature, RSC; 300–1200 dpi) and downloads the experiment's SI package.
- **Easier for new users, stage 2: Home page, example data and tours.**
  - **Home** (new first item in the sidebar) asks what you want to do: analyse a MIC plate, find a product in an LCMS run, identify FTIR peaks, or ask the AI. Each card has Open, Try with example data, Take the tour, and the files you already have open. The app opens on Home; choose "the last tab I used" at the bottom of Home to change that.
  - **Try with example data** on every tab's empty page and on Home:
    - a synthetic PLGA (glycolic/lactic acid) oligomer LCMS run with a UV trace;
    - a synthetic PLGA film FTIR spectrum;
    - the two real Gen5 MIC plates, already laid out.

    Examples are ordinary sessions named "Example – …" and tagged "Example"; while one is open, a card lists what to try.
  - **Empty pages** now say what each tab is for and which files it accepts. The FTIR page listed .spa/.dpt, which can't be opened.
  - **Tours:** a one-minute tour per tab, offered once on the first visit, and replayable from Help or Home.
- **Easier for new users, stage 1: hints, a control finder and up-to-date help.**
  - **Hover hints on every control** (about 250): what it does, a typical value from the real defaults, and the help topic. Press **F1** on a control to open help at that topic.
  - **Find a control** (header, or **Ctrl+K** / ⌘K anywhere): type a name or what you want to do ("baseline", "exclude well", "condensation") and press Enter. The app switches tab, opens the right panel or dialog, scrolls to the control and highlights it.
  - **Help rewritten** for LCMS, FTIR and the AI Assistant to match the current screens. LCMS help described tabs that no longer exist, and AI help wrongly said the assistant was read-only and that API keys live on the server. Each help topic has **Show me** buttons that jump to its controls, and help search now covers the full text.
  - **Tooltips are readable in the night theme** (they were white text on a light bubble).
  - **Removed** three LCMS Display-tab checkboxes that did nothing: Confidence, Alignment diagnostics and Multi-drag labels across overlay.
  - **Keyboard shortcuts no longer clash with the browser's:** FTIR's P/O/F and LCMS's B/O ignore keys held with Ctrl, ⌘ or Alt, so Ctrl+F (find) and Ctrl+P (print) work normally.
- **Plate Reader redesigned for MIC plates.** The MIC wizard (row-role buttons, concentration columns, typed tick labels) is replaced by a plate map.
  - **Import:** BioTek Gen5 exports (reader, date, read type, wavelength, temperature) or any sheet with an 8×12 block labelled A–H / 1–12. Notes typed under the plate in Gen5 (e.g. "A-C - LacGlyDOH 5:1:1") fill in the layout.
  - **Plate map:** each well shows its OD. A form sets the dilution series (column 1 = top concentration, default 1024 µg/mL, ÷2 to column 11), the compound rows, the growth-control column and optional blank rows. Drag across wells to reassign them; click a well to exclude it. Layouts save automatically; templates are shared by the lab.
  - **Calculation:** each compound is compared with the growth-control wells in its own rows: % growth = 100 × (mean OD − blank) ÷ (growth control − blank). Automatic checks flag a growth control that did not grow or looks inhibited, a high or uneven blank, disagreeing replicates (naming the row), readings above 2.5 and whether growth falls below 10%.
  - **Results:** heatmap, dose–response (mean ± SD, log₂ axis), % growth, stick plot, optional 4PL IC₅₀ and a results table, all on one page. Each has "How is this calculated?" with this plate's wells and numbers and the Excel steps. The calculation workbook redoes every step with live formulas.
  - **Experiment:** plates with the same experiment tag (e.g. samples and a gentamicin plate) are combined in a % growth chart and a MIC reading grid, with *Export all (Excel)* and the SI package.
  - **Old sessions** open in the new view; set their layout once. Old MIC results stay in the SI package.
- **UI refresh, stage 2 (FTIR).**
  - **Analysis panel:** 360 px wide with a 2×2 section switcher, so there is no sideways scrolling and the page no longer shifts. Settings sit 2 per row with labels above, so values such as baseline lambda (100000) are no longer cut off. Presets are one dropdown, undo/redo use icons, and the constraint lists are readable.
  - **Chart:** a title plus one grey status line. The peak tool (Inspect / Add / Delete) moved into the chart toolbar, and the duplicate "Manual peak edit" controls were removed from the panel. The plot now fills the card, and chart text is readable in night mode.
  - **Removed:** the quick SVG/PNG buttons. Use Export → 1:1 PNG/SVG, which gives a white background at your chosen size and DPI.
  - **Dataset row:** one slim line.
  - **Session list:** slim strip below 1600 px.
  - **Look:** line icons, 12 px minimum text, and status colours from the theme.

- **UI refresh, stage 1 (shared look + LCMS).** Calmer, easier-to-read interface:
  - neutral grey day theme and IBM Plex Sans; text is at least 12 px (13 px body);
  - line icons instead of emoji; one filled button per area, with the rest quiet;
  - status badges now meet contrast minimums (the green badge was 1.9:1);
  - LCMS: chart cards show a title plus one grey status line, and the dataset details form one slim row;
  - LCMS tools panel: "Primary Actions" merged into it (duplicate EIC and m/z buttons removed), tabs renamed Analysis / Display, fixed at 290 px with no sideways scrolling;
  - laptop screens (below 1600 px): the side menu and LCMS session list collapse to slim strips that open over the content;
  - MS1 spectrum: the x-axis now fits the peaks instead of running to the scan limit, and overlapping peak labels are hidden until you zoom in;
  - on-screen axes show ×10ⁿ.

  **Not changed:**
  - analysis results, saved sessions and workspaces;
  - exported figures: they keep their colours, fonts and e-notation;
  - your own chart colours, and day-theme chart line colours.

  **Night theme:** chart lines and text are now visible, and filled buttons are readable (they were 1.7:1). The **night-vision theme was removed**; if you had it selected, the app opens in day.

- **Polymer Studio and Polymer Match dialog now offer the same settings.** The Studio gained per-bond delta, max DP, min relative intensity and the small-oligomer preset; tolerance, unit, max DP and min intensity now sit above the tabs so they are always visible. The dialog gained custom adducts (previously Studio-only). Both are built from the same sections, and a test checks they expose identical controls. "Reset" is now described correctly: it restores your saved defaults, not factory defaults.

- **Operations (plan 6.5):** the server snapshots its SQLite databases to `<data>/backups` once a day (newest 7 kept); `python -m app.backup OUT.tar.gz` writes a full archive (databases + uploads) for an off-site copy. The Docker image sets `MFP_DATA_DIR=/data`, so LCMS index caches now also persist on the Railway volume instead of being rebuilt after each deploy. Server logs are timestamped single lines. Hosting stays public on the Railway link (decision recorded in `plan.md`).

- **CI (plan 6.4):** GitHub Actions runs backend tests (locked deps and pandas 3), frontend type-check and tests, and a Docker build.

- **LCMS sessions (plan 6.1):** each session row shows its upload time; hovering the name shows the full name, upload time and a short file ID (the start of the file's SHA-256), so two uploads with the same name can be told apart.

- **Unexpected server errors (plan 6.1)** now return a short message with a reference code instead of internal details; the full traceback is written to the server log under that code.

- **Help (plan 6.1):** Plate Reader help explains that the 4PL fit needs real concentrations in *Tick labels*; LCMS help describes the polarity message and that the RT unit is display-only.

- **SI package rebuilt (plan 5.2):** tables (LCMS features and deconvolutions, FTIR peaks/fits/integrations, 4PL fits and replicate means) contain only recorded results; the methods text is generated from the settings actually used; `manifest.json` lists every input file's SHA-256 and each result with its parameters and app version; raw input files can be included. An experiment tag (or session list) is required. "Vector PDF" is now labelled "PDF" because panels are embedded as images.

- **Provenance (plan 5.1):** FTIR peaks, fits and integrations, MIC/4PL fits, LCMS deconvolutions and exported LCMS feature tables are now recorded with their exact settings, the input file's SHA-256 and the app version (`GET /api/experiments/results`). Re-running with identical settings replaces the earlier record; records are deleted with their session.

- **Performance (plan 4.1):** one person's analysis (EIC, spectrum, region sum, file upload/parsing) no longer freezes the app for everyone else; analyses run in worker threads instead of on the server's single event loop.
- **Performance (plans 4.2–4.4), measured on a 140 MB mzML (2,400 scans):** spectrum click 1.6 s → 0.01 s; EIC 3.3 s → 2.0 s the first time per file, then 0.09 s; 1-min region sum 2.6 s → 0.1 s; upload 4.0 s → 2.5 s. The first EIC/region sum builds a peak table cached next to the index (≈ 0.8× the mzML size on disk, deleted with the session). Intensities in that table are single precision, so EIC and region-sum intensities can differ from before in the 7th significant digit.

- LCMS feature-table CSV column `Area` renamed to `AreaCountsMin`, and areas are labelled *counts·min* in the UI (plan 1.10). Update any spreadsheet that reads the old column name.

### Fixed

- **FTIR spectrum could be drawn with the wrong y-mode.** When the absorbance/transmittance mode changed while a spectrum was loading (for example on opening the page, when a file is detected as absorbance), an older response could arrive last and be drawn instead, e.g. an absorbance file converted as %T, with bands inverted, under an "absorbance" label. Outdated responses are now ignored. Peaks, integrations and fits are computed on the server with the current settings and were not affected; only the displayed spectrum was.

- **Server hardening (plan 3.1–3.3):** the server no longer opens files by a path given in a request (removed `POST /api/lcms/sessions/from_path` and `/sessions/{id}/uv/from_path`, which could read any numeric file on the server), no longer returns server file paths in session summaries or automation outputs, and ignores a request-supplied Ollama URL (only `OLLAMA_BASE_URL` is used). The unused Vercel Blob upload path (`blob_url`), which made the server download any URL it was given, is removed. Loading an LCMS workspace file now re-links sessions that still exist on the server and asks you to re-upload the rest.
- **Resource limits (plan 3.4):** uploads above `MFP_MAX_UPLOAD_MB` (default 2048) and `.mzML.gz` files that expand beyond `MFP_MAX_DECOMPRESSED_MB` (default 8192) are rejected with HTTP 413 and nothing is kept on disk. Deleting a session now also deletes its uploaded file, UV file and LCMS index cache once no other session uses them (files outside the data directory are never touched), so disk use no longer grows forever. Deleting a session that failed to reload no longer returns 404.
- **CORS (plan 3.5):** the API no longer allows any website to call it from a visitor's browser (`allow_origins=*` removed). The app itself is unaffected (same origin); set `MFP_CORS_ORIGINS` if a frontend is ever hosted on another domain.

- **FTIR peak fits that failed to converge** were shown as results: the table then contained the initial guesses (with an R²) instead of fitted values. Failed fits are now flagged with a warning (plan 2.2). Asking for more components than detected peaks crashed the fit; it now works.
- Saved sessions whose files are missing or unreadable after a restart no longer disappear silently: a banner lists them with the reason, and the server log records the error (plan 2.2).
- AI-assistant automation with several people using the app: the last tab to open took over browser actions for everyone, so one person's request could be carried out in someone else's tab. Each tab now receives its own requests; MCP clients still use the most recently opened tab. The automation action log is kept in the persistent data directory, so it survives redeploys (plan 2.6).
- Data Studio works with pandas 3: decimal-comma files kept text columns unconverted and the *fill forward* step failed (plan 2.3). The deployed version stays pinned to pandas 2.3 until an upgrade is tested.
- Data Studio sheet, header-row and decimal-comma choices are kept after a server restart instead of resetting to defaults (plan 2.4).
- Data Studio *baseline* step with a missing first value turned the whole column empty; it now leaves the column unchanged and shows a warning (plan 2.2).
- LCMS single-scan deconvolution (no RT range) always failed with a server error; it now works (plan 1.5).
- Attached UV traces disappeared after every server restart (the restore call was missing an argument and the error was swallowed); they are now restored (plans 1.9 / 2.1).
- FTIR import of plain comma- or semicolon-separated two-column files (without an `XYDATA` marker) failed with "File must contain at least two numeric columns"; they now load (plan 1.7). Semicolon files with decimal commas are still not supported.

### Removed

- **Data Studio tab** (table import, transforms, plots): its page, API (`/api/data-studio`) and web service. Older Data Studio sessions stay in the database and are still listed in experiment bundles and SI packages, but can no longer be opened. The shared `lab_gui` table code used by the desktop app is unchanged.
- **Figures & SI tab** and the multi-panel figure PDF builder (`/api/publication/render-figure-pdf`, `reportlab` dependency). **The SI package is kept:** download it from the experiment-tag button on the LCMS and FTIR pages.
- Old links to `/data-studio` or `/figures` now open LCMS. Dropping a `.json` or `.parquet` file shows a "no module opens this file" message instead of opening Data Studio.

- FTIR "MSC" normalisation: the single-spectrum version regressed the spectrum on its own polynomial fit, which always returns it unchanged (a no-op). Saved settings using it switch to *none* (plan 1.8).

- The old SI package export wrote placeholder numbers and a fixed methods text instead of real results. **Any SI package downloaded before this version should not be used.**
