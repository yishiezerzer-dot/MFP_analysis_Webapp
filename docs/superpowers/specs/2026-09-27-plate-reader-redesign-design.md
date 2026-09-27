# Plate Reader redesign (MIC first)

Date: 2026-09-27 · Status: approved in brainstorming, awaiting spec review

## Goal

Replace the current MIC "wizard" with a plate-map workflow. The lab should be able to open a BioTek Gen5 export, say which wells are which, and read the MIC by eye from clear charts. Every number should be explainable and reproducible outside the app.

MIC comes first. Growth curves (kinetic reads) and viability/IC₅₀ assays are planned later, so the data model must not assume a single endpoint read.

## Decisions (from the user)

| Topic | Decision |
|---|---|
| Instrument / files | BioTek Gen5 (Synergy H1) Excel exports: metadata block, one 8×12 endpoint grid (OD600), free-text notes under the grid |
| Assays | MIC now; growth curves and viability later |
| Plate layout | Varies per plate. Typically compounds in replicate rows (e.g. A–C, D–F), 2-fold dilutions across columns 1–11, **column 12 = growth control**. Gentamicin reference either on the same plate or on a separate plate |
| Concentrations | Column 1 = top concentration (default **1024 µg/mL**, editable, last value remembered), ÷2 per column to column 11. One plate-level setting (per-compound override not needed now) |
| MIC value | **Read by eye**; the app does not compute or store a MIC value |
| Blank | Optional (sometimes present, e.g. empty rows G–H) |
| Layout entry | **Form fills the plate, then paint to adjust**; layouts saved as reusable templates; Gen5 notes pre-fill the form |
| Bad wells | Click a well to exclude it (e.g. a contaminated growth-control well); excluded wells stay visible and are recorded |
| Outputs | Plate heatmap, dose–response per compound, % growth, stick plot (today's bar chart, kept for export), optional 4PL IC₅₀, results table (CSV/Excel), publication export. No manual-MIC field |
| Results layout | **All charts at once** (grid), each a moderate fixed height (~250–300 px) |
| Explanations | Every chart/table has a **"How is this calculated?"** panel with this plate's wells and numbers, automatic checks, and reproduction steps; plus a downloadable calculation workbook |
| Multiple plates | Plates with the same **experiment tag** are combined in an **Experiment** tab (each compound normalised to its own plate's growth control) |

## 1. Import (backend)

A new reader, `lab_gui/plate_gen5.py` (pure Python, shared with the desktop app), returns a `PlateRead`:

- **metadata:** software version, plate number, date, time, reader type, serial, read type (e.g. "Absorbance Endpoint"), wavelength(s), temperature;
- **grid:** `{well_id: value}` for A1…H12 (float, or None if the cell is blank or non-numeric), plus the wavelength label;
- **notes:** free-text lines after the grid.

How it works:

- **Detection:** it finds the header row with 1…12 and the following rows labelled A…H. The trailing wavelength column ("600") becomes the read label.
- **Not a Gen5 export:** for any sheet or CSV that contains an 8×12 block labelled A–H / 1–12, it still finds the block and leaves the metadata empty.
- **No usable block:** it raises a clear error ("No 8×12 plate block found").
- **Notes parser:** lines like `A-C - LacGlyDOH 5:1:1`, `A–C: name` or `rows D-F name` become compound suggestions `{name, rows}`. Unparseable notes are shown as plain text.
- **Future reads:** multiple blocks in one sheet (e.g. several wavelengths or kinetic reads) are returned as a list of reads, with MIC using the first endpoint read. Kinetic support comes later.

Sessions keep today's storage: an upload creates a session and the raw file is kept. The old spreadsheet-preview endpoint and the MIC wizard endpoint are replaced (see §6).

## 2. Plate map (model + UI)

**Model** (`PlateLayout`, JSON, saved per session and as named templates):

```
dilution: { top: 1024, unit: "µg/mL", factor: 2, direction: "columns" | "rows", first: 1, last: 11 }
groups:   [ { id, name, kind: "sample" | "reference", colour, wells: ["A1", …] } ]
growth_control: ["A12", …]      # wells; each group uses the growth-control wells in its own rows (or columns)
blank:    ["G1", …] | []        # optional
excluded: ["F1", "B12", …]
```

- **Well concentration** comes from its position in the dilution direction: column n → top ÷ factor^(n − first).
- **Growth-control pairing:** each group uses the growth-control wells in *its own rows*. If a group's rows have none, it falls back to all growth-control wells on the plate. The explanation panel shows which case applies.
- **Templates are stored on the server,** shared by the lab (new table `plate_templates`: id, name, layout JSON, created_at).

**UI** (Plate map tab):

- **Plate grid:** wells show the OD, a white→blue fill by OD, a group ring colour, and hatching for excluded wells. Column headers show concentrations.
- **Right panel:** dilution series, a card per compound (name, rows, kind), "+ Add compound" and "+ Reference", controls (growth control and blank), "Apply to plate", "Save as template", and a template dropdown.
- **Painting on the grid:**
  - click toggles *excluded*;
  - drag assigns wells to the selected group;
  - the "Growth control" and "Blank" groups can also be painted;
  - Esc cancels a drag.
- **Opening a plate** pre-fills the layout from the Gen5 notes when present; otherwise it uses the last template.

## 3. Analysis (backend, pure functions in `lab_gui/plate_mic.py`)

For each group g, with blank subtraction on (the default when blank wells exist):

1. `blank = mean(OD of blank wells not excluded)`; with no blank wells or subtraction off, `blank = 0`.
2. `v(w) = OD(w) − blank` for every well.
3. `gc_g = mean(v(w))` over g's growth-control wells not excluded.
4. For each concentration c: `mean_g(c)`, `sd_g(c)` (sample SD, n−1) and `n_g(c)` over g's wells at c not excluded.
5. `% growth_g(c) = 100 × mean_g(c) / gc_g`. The per-replicate % growth uses each well's own `v(w)`.
6. The **4PL fit** (optional, off by default) reuses the existing `lab_gui` 4PL on `(c, mean_g(c))`, reporting IC₅₀ ± SE, Hill slope and R², with the existing out-of-range flag.

The Experiment view applies the same calculation per plate, then lists groups from all plates tagged with the same experiment tag.

**Checks** (returned with the results; thresholds are constants in `plate_mic.py`):

| Check | Rule | Level |
|---|---|---|
| Growth control grew | `gc_g ≥ 0.2` above blank | warn if not |
| Growth-control agreement | CV of g's growth-control wells ≤ 20% | warn |
| Blank low and even | blank mean ≤ 0.1 and CV ≤ 20% | warn |
| Replicate agreement | CV of `v` at each c ≤ 20% (report the worst c and which row deviates) | warn |
| Reader range | any OD > 2.5 | warn |
| Growth-control well looks inhibited | a growth-control well < 50% of the other growth-control wells in the group | warn, suggest excluding |
| MIC in range | lowest mean % growth < 10% within the tested range, or not reached | info |
| Excluded wells | list them, with their effect on n | info |

Results are recorded through `provenance.record()` (module `plate_reader`, kind `mic_plate`), with the layout, excluded wells, blank setting, app version and input SHA-256, so they appear in the SI package.

## 4. Results tab (UI)

A grid of equal cards, each about 250–300 px tall. Each card has a title plus one grey status line, ⓘ "How is this calculated?", Design and Export.

- **Plate heatmap:** the OD grid, the same visual as the plate map, read-only.
- **Dose–response:** mean ± SD per group on a log₂ concentration axis. A dashed line marks each group's growth-control level.
- **% growth:** per group, with a 100% reference line.
- **Stick plot:** today's bar chart (bars per concentration, growth control last), kept for export.
- **4PL fit:** shown only when enabled; the IC₅₀ summary appears under the dose–response chart.
- **Results table:** group, concentration, n, the replicate values, mean, SD and % growth; CSV and Excel export.

Toolbar: *Subtract blank* (disabled when there are no blank wells) and *4PL fit*.

**Explanation panel** (every chart and table), generated from the actual analysis output:

- what the chart shows (one sentence);
- the numbered calculation with this plate's wells and values;
- the checks with ✓ or ⚠;
- "Reproduce it yourself" steps in Excel terms;
- the text for each chart type, fixed in `plateExplanations.ts` so it stays reviewable.

**Calculation workbook** (Excel download, backend with openpyxl). Sheets:

- the raw plate as imported;
- the layout, a well→group/concentration map;
- blank and growth control with **live formulas** (`=AVERAGE(…)`);
- the per-group table with formulas for mean, SD and % growth referencing the raw sheet;
- the checks.

Opening it in Excel recomputes everything from the raw numbers.

## 5. Experiment tab (UI)

- **Header:** experiment tag, number of plates and compounds, date; *Export all (Excel)* and *Download SI package*.
- **% growth — all compounds:** combined chart, about 560×250 px, with the plate checks card beside it.
- **MIC reading grid:** a table of % growth per concentration for each group (mean plus each replicate row), shaded white→blue, with CSV export.
- **Plate checks:** a summary per plate.
- **Explanation panels** as in §4.

## 6. What is removed or changed

- **Removed:** the MIC wizard UI (row-role buttons, concentration-column picking, tick-label typing, `ChartControls`, `WizardForm`, `PreviewTable`). This includes the `/sessions/{sid}/load` preview and `/sessions/{sid}/mic` endpoints and the old `run_mic_wizard` service path, replaced by `/sessions/{sid}/layout` (get/put), `/sessions/{sid}/analysis`, `/sessions/{sid}/workbook`, `/templates` (CRUD) and `/experiments/{tag}/plates`.
- **Old sessions:** sessions saved by the old UI open in the new view (the file is re-read). Any saved old MIC configuration is ignored, and the user sets a layout once.
- **Old results:** previously recorded MIC results stay in the database, the SI package and the changelog history.
- **Page structure:** the page follows the stage 1–2 conventions (SideRail plate list, page header, `ChartCardTitle`, `ToolbarButton`, publication Export menu, 12 px text floor, theme tokens).

## 7. Out of scope

- Kinetic growth curves.
- Viability assays.
- Automatic MIC calling.
- Per-compound top concentration.
- 384-well plates. The model uses well IDs, so 384 can be added later without changing the layout format.

## 8. Testing

- **Gen5 reader:** fixtures shaped like the two exports provided (metadata block, grid with trailing wavelength column, notes). The fixtures are synthetic copies with altered numbers unless the user approves committing the real files. Tests:
  - metadata;
  - all 96 values;
  - wavelength;
  - notes → `{LacGlyDOH 5:1:1: A–C, LacGlyDOH 1:1:1: D–F}`;
  - a non-Gen5 CSV with an 8×12 block;
  - an error when no block is found.
- **Analysis** (hand-computed expectations):
  - blank mean;
  - blank subtraction on and off;
  - growth-control pairing by row;
  - excluded wells change n and the means;
  - % growth;
  - SD with n−1;
  - each check firing on constructed plates, e.g. a B12-style inhibited growth control and the row-A offset.
- **Workbook:** formulas present; values recomputed with openpyxl or LibreOffice match the API output to 1e-9.
- **Frontend:**
  - layout form → wells mapping;
  - paint and exclude interactions;
  - explanation-panel text built from the analysis output;
  - templates round-trip.
- **Live check** on the two provided plates:
  - gentamicin shows 0% down to 4 µg/mL, 22% at 2 and 46% at 1 (with B12 excluded);
  - the polymers show 72–94%.
