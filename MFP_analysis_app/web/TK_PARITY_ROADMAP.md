# Tk-Parity Web Roadmap

This file is the durable implementation checklist for the reordered parity plan.
Update it at the end of each phase so future work can resume without
rediscovering the Tk desktop behavior.

## Phase Order

1. LCMS
2. FTIR
3. Plate Reader
4. Data Studio
5. AI Assistant

Microscopy is intentionally deferred because it is not currently a web tab.

## Current Pause Point

LCMS and FTIR parity layers are smoke-tested and complete enough to move on.
Plate Reader workspace, MIC state, plot controls, exports, and blank
subtraction are implemented and compile/type-check cleanly. Manual browser
smoke is still pending.

Recommended next step when continuing:

1. Run Plate Reader browser smoke: upload a real plate file, mark sample,
   control, and blank rows, run MIC, adjust chart controls, export CSV/JSON/
   PNG/SVG, save workspace, reload workspace, rename and clear sessions.
2. Do a quick LCMS/FTIR regression smoke.
3. Move to Data Studio parity.

## Phase 1 - LCMS

Status: first parity layer smoke-tested; remaining overlay parity implemented.

Implemented in this phase:

- [x] Persistent web workspace export/import for LCMS UI state.
- [x] Server-side find m/z across MS1 scans.
- [x] Server-side EIC/SIM chromatogram endpoint.
- [x] Region-summed spectrum endpoint.
- [x] Multi-session TIC overlay controls.
- [x] Richer CSV exports for spectrum, all labels, TIC overlays, and UV traces.
- [x] Label state preserved in workspace JSON.
- [x] Multi-session UV and spectrum overlay controls.

Verification checklist:

- [x] Backend modules compile with `python -m compileall`.
- [x] Frontend `npm run lint`.
- [x] Frontend `npm run build`.
- [x] Current-code smoke: upload real mzML/UV files, load TIC/spectrum, run
  find m/z, EIC, region-summed spectrum, overlays, and CSV exports.
- [ ] Manual browser smoke: click TIC and save/load workspace through the UI.

Smoke details from current-code API run:

- Uploaded two real mzML sessions and attached matching UV CSV files.
- Verified TIC, spectrum, find m/z, EIC, region-summed spectrum, UV traces, UV
  peaks, TIC overlays, and spectrum/labels/UV/TIC overlay CSV exports.

## Phase 2 - FTIR

Status: first parity layer smoke-tested; remaining label/export parity implemented.

- [x] Workspace save/load for current web FTIR sessions and analysis state.
- [x] Multi-spectrum overlays for selected loaded sessions.
- [x] Min-height peak-picking control wired to the backend.
- [x] Peaks CSV export with top assignment.
- [x] Label overrides/suppression, draggable label positions, bond annotations,
  apply-to-all stored peak results, and plot image export.

Verification checklist:

- [x] Frontend lint/build passes after FTIR parity changes.
- [x] Current-code smoke: upload two real FTIR CSV sessions, retrieve spectra,
  peak pick, load assignments, and load the bond library.
- [ ] Manual browser smoke: save/load workspace, drag labels, hide/override
  labels, and export SVG/PNG/CSV from the UI.

## Phase 3 - Plate Reader

Status: implementation layer complete enough for manual browser smoke.

Implemented:

- [x] Workspace save/load controls wired into the Plate Reader UI.
- [x] Rename and clear-session controls.
- [x] Persist and restore MIC config/result and chart settings end-to-end.
- [x] Plot controls for sample/control/blank colors, line width, marker size,
  bar width, height, grid, and legend.
- [x] MIC CSV/JSON exports and Plotly PNG/SVG image exports.
- [x] Blank-row role and backend blank subtraction.
- [x] Basic MIC-wide helpers: auto-pick numeric concentration columns, reverse
  concentration order, and clear picks.

Verification checklist:

- [x] Frontend `npm run lint`.
- [x] Frontend `npm run build`.
- [x] Backend Plate Reader modules and shared MIC model compile with
  `python -m compileall`.
- [x] In-process MIC smoke confirms blank subtraction returns adjusted means
  and blank mean arrays.
- [x] Current-code API smoke: upload synthetic CSV, run MIC with blank rows and
  blank subtraction, verify adjusted sample means and blank means, then delete
  the session.
- [ ] Run Plate Reader manual/browser smoke.

## Phase 4 - Data Studio

Status: not started.

- Workspace state, plot definitions, recipes, overlays, advanced plot types,
  preview filters/stats, transformed CSV and plot/data exports.

## Phase 5 - AI Assistant

Status: not started.

- Streaming chat, transcript export, richer context snapshots from stable tab
  workspace states, strict context size limits.
