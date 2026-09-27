# Plate Reader redesign: build plan

Spec: `docs/superpowers/specs/2026-09-27-plate-reader-redesign-design.md` · Branch: `design/plate-reader-redesign`

Each task is one commit. Tests are written first, and backend `pytest`, frontend `tsc` and `vitest` pass after every task.

1. **Gen5 reader:** `lab_gui/plate_gen5.py`.
   - Fixtures: the two real exports, copied to `web/backend/tests/fixtures/plate_reader/`.
   - Check: tests for metadata, the 96 values, wavelength, the notes → groups parser, a non-Gen5 8×12 CSV, and the no-block error.
2. **Analysis:** `lab_gui/plate_mic.py`.
   - `PlateLayout` model, concentrations, blank, growth-control pairing, exclusions, mean/SD/n, % growth, optional 4PL (reusing `fit_4pl_curve`), and checks.
   - Check: hand-computed expectations on the real plates:
     - blank 0.0473;
     - growth control 1.141 / 1.169;
     - % growth for gentamicin 0 → 22 → 46 with B12 excluded;
     - the row-A CV warning;
     - a B12-style inhibited growth-control warning.
3. **Backend API:**
   - Session summary with Gen5 metadata and notes.
   - `GET/PUT /sessions/{sid}/layout`, `POST /sessions/{sid}/analysis` (recorded via provenance), `GET /sessions/{sid}/workbook`.
   - `/templates` CRUD, backed by a new DB table.
   - `GET /experiments/{tag}/plates`.
   - Remove the old `/load` and `/mic` endpoints and the wizard service path.
   - Check: API tests, including the workbook's live formulas recomputing to the API values.
4. **Frontend API client:** `api.ts` types and calls; old MIC types removed. Check: `tsc`.
5. **Plate map tab:**
   - New `PlateReaderView` shell (SideRail plates, header, tabs Plate map / Results / Experiment).
   - `PlateGrid`: OD fill, group rings, concentration headers, click to exclude, drag to assign.
   - `LayoutPanel`: dilution settings, compounds, controls, Apply, templates, prefill from notes.
   - Check: component tests for layout → wells, paint, exclude, prefill.
6. **Results tab:**
   - Heatmap, dose–response, % growth, stick plot, 4PL toggle, results table with CSV/Excel export.
   - `plateExplanations.ts` explanation panels.
   - Check: tests that the explanation text is built from the analysis output; live check on the real plates.
7. **Experiment tab:**
   - Combined % growth chart, MIC reading grid, plate checks.
   - Export all and the SI package.
   - Check: tests and a live check (gentamicin + polymers).
8. **Finish:**
   - Help content, changelog and README.
   - Full `tsc`, `vitest`, `build` and `pytest`.
   - Live check in day and night themes; the user reviews; merge; CI green.
