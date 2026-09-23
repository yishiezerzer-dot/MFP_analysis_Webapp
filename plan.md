# MFP Analysis App — Fix Plan

Source: independent review of 2026-09-23. Finding IDs (C1, H1…, M1…, L1…) refer to that review.

**Scope decision:** the app stays open to the lab with **no authentication and no per-user workspace isolation**. Workspaces remain convenience labels. Items that only existed to separate users are dropped. Hardening that protects the *server itself* (arbitrary file reads, server-side URL fetches, resource exhaustion) is kept, because it is needed regardless of who the users are.

> Note: with no auth, whoever can reach the URL can use the app and see all lab data. That is fine on a lab network or behind the university VPN; on a public Railway URL it means anyone with the link. Phase 6 covers hosting options — decide there.

## Ground rules for every task

- One task = one commit/PR with its own test. Write the failing test first, then the fix.
- Verify with: `pytest` (backend, via the isolated conftest from task 0.1), `npm run test:run`, `npm run lint`.
- Any fix that changes numeric results gets a line in `CHANGELOG.md` under "Results affected", naming which past analyses may differ.
- Don't touch unrelated code.

---

## ~~Phase 0 — Safety net (do first, ~0.5 day)~~ ✅ DONE 2026-09-23

> **Done:**
> - `tests/conftest.py` isolates data; `requirements-dev.txt` added. The 8 `sid_*` fixture rows were removed from the local dev DB, and the suite leaves the DB untouched.
> - `requirements.txt` now caps `numpy>=2.0,<3` and `pandas>=2.0,<3`; `requirements.lock` (uv, universal, Python 3.12) is installed by the Dockerfile. Fresh 3.12 venv from the lock: 105/105 pass.
> - SI endpoint returns 410; SI buttons removed from the Figure Builder and the experiment-tag popover; nav label is now "Figures".
>
> **Not verified:** `docker build` (Docker isn't installed on this machine) — the first Railway deploy is the check.

### ~~0.1 Isolate tests from real data (M5)~~
- **Files:** new `web/backend/tests/conftest.py`
- **Change:** session-scoped autouse fixture that sets `MFP_DATA_DIR` and `MFP_AUTOMATION_LOG_DB` to a `tmp_path_factory` directory *before* `app.main` is imported.
- Add `pytest` and `pytest-asyncio` to a new `web/backend/requirements-dev.txt`.
- **Verify:** run the suite and confirm `MFP_analysis_app/.data/mfp_database.db` is unchanged (mtime + row count). Then delete the 8 `sid_*` fixture rows from the local dev DB by hand.

### ~~0.2 Pin dependencies (H9)~~
- **Files:** `web/backend/requirements.txt` → generate `requirements.lock` with `pip-compile` or `uv pip compile`; update `Dockerfile` to install from the lock file.
- Pin to the currently tested set (pandas 2.3.x, numpy 2.x ≥ 2.0 so `np.trapezoid` exists).
- **Verify:** fresh venv from the lock → full test suite passes; `docker build` succeeds.

### ~~0.3 Disable the SI package now (C1, stop-gap)~~
- **Files:** `web/backend/app/routers/publication.py`, `web/frontend/src/views/FigureBuilderView.tsx`
- **Change:** `/si-package` returns HTTP 410 with a message; hide both "Download SI Package" buttons. The figure PDF export stays.
- **Verify:** test asserts 410; button is absent from the UI.

---

## ~~Phase 1 — Scientific correctness (highest priority, ~4–5 days)~~ ✅ DONE 2026-09-23

> **Done** on branch `fix/review-phase-0-1`: one commit per task, test first, every results-changing fix listed in `CHANGELOG.md`. Final state: 191 backend tests (also pass in a clean Python 3.12 venv built from `requirements.lock`) and 164 frontend tests pass; type-check clean. The MIC fix was checked visually in the running app (IC₅₀ 2.01 ± 0.011 µg/mL for a true 2.0; bars and curve on one log₂ axis).
>
> **Deviations from the plan:**
> - **1.3:** the Expected Products table still runs in TypeScript. The engines are aligned instead (combined variants, electron mass for anions) and locked together by the shared fixtures `polymer_charges.json` and `polymer_variants.json`. Moving the table to a backend endpoint remains optional.
> - **1.6 item 5 (MIC threshold rule) skipped:** `compute_mic`, `compute_mic_wide` and `compute_mic_wide_od` aren't called anywhere, and the web wizard never computes an MIC value. Decide whether the wizard should report an MIC; if not, delete those functions.
> - **1.8:** the atmospheric mask now covers only CO₂. Water-vapour lines overlap the sample bands and can't be masked; vapour subtraction would be a new feature.
> - **2.1** was fixed as part of 1.9 (same code path).
>
> **Found and fixed along the way** (listed in CHANGELOG under Fixed):
> - The AI/MCP automation action `lcms.compute_expected_products` was a third polymer engine with the same charge and zero-setting bugs. All three engines now share `charge_states()` and `setting_float()`.
> - Single-scan LCMS deconvolution (no RT range) always returned HTTP 500.
> - FTIR files in plain comma/semicolon CSV format (no `XYDATA` marker) couldn't be loaded.
>
> **Still open:**
> - Semicolon-separated FTIR files with decimal commas.
> - Lorentzian fits come out about 3% narrow when the fit window is only ±5 FWHM, because the linear end-point baseline clips the tails. A better baseline for fits could be added to Phase 2.


### ~~1.1 Polymer matching: charge-state formula (H2)~~
- **Files:** `lab_gui/lcms_polymer_match.py` (lines ~711, 761, 783 and the matching code in `explain_best_match_for_peak_sorted` ~1012–1060), `web/frontend/src/lcms/analysis.ts` (~843, 856, 859)
- **Change:** for proton-like adducts (|mass| ≈ 1.00728) use `m/z = (M + z·adduct)/z`. For metal/anion adducts, keep a single adduct at z=1; for z>1, use `(M + adduct + (z−1)·H⁺)/z` (e.g. [M+H+Na]²⁺), or restrict them to z=1 — pick one and document it in help. Labels become `[M+2H]²⁺`, `[M−2H]²⁻`.
- Update the neutral-mass pruning window (`lcms_polymer_match.py` ~555–562) to match.
- **Tests:**
  - Python and TS: dp10 lactic-acid oligomer, [M+2H]²⁺ at 370.1182 labelled; z=3 case; negative mode [M−2H]²⁻.
  - Add a shared fixture in `web/shared_fixtures/lcms/polymer_charges.json` consumed by both `test_cross_language_fixtures.py` and `cross_language_fixtures.test.ts`.

### ~~1.2 Polymer settings: zero values replaced by defaults (H3)~~
- **File:** `web/backend/app/services/lcms_service.py` (~734–768)
- **Change:** replace every `float(settings.get(k, d) or d)` with a helper `_num(settings, k, d)` that falls back only on `None` / missing / non-numeric.
- **Tests:** `bond_delta=0` labels the styrene 10-mer at the right m/z; `adduct_mass=0`; `min_rel_int=0`.

### ~~1.3 Unify the two polymer engines (L2, follow-up to 1.1)~~
- **Change:** make the Python engine the single source of truth; the Expected Products table calls a backend endpoint instead of `buildExpectedProductHits`, or both are driven by the shared fixtures until merged. Align the variant set (Python has +O−CO₂ combos; TS doesn't).
- Add the electron mass to anion adducts (Cl⁻, HCOO⁻, CH₃COO⁻) in both constant tables.
- **Tests:** shared fixture gives identical hit lists in both.

### ~~1.4 RT units read from the file (H4)~~
- **Files:** `lab_gui/lcms_model.py` (`_extract_rt_minutes`), `lab_gui/lcms_io.py`, `web/backend/app/routers/lcms.py`, `web/frontend/src/views/LCMSView.tsx` (~2494), `web/frontend/src/api.ts` (~962)
- **Change:** use `getattr(value, "unit_info", None)` from pyteomics `unitfloat` (`"minute"`/`"second"`). Fall back to the user-supplied unit only when the file has none, and record `rt_unit_source: "file" | "user"` in session stats.
- Stop sending the Display-tab RT unit at upload; the Display selector becomes display-only. Bump the index-cache key version (`v2` → `v3`) so old caches rebuild.
- **Tests:** psims-generated fixtures declaring minutes and seconds both produce 0–20 min regardless of the display setting.

### ~~1.5 No silent polarity fallback (H5)~~
- **File:** `web/backend/app/services/lcms_service.py` (`_ms1_candidates`, ~255–264)
- **Change:** when a polarity is requested and has no scans, raise `LCMSLoadError("No negative-polarity MS1 scans in this file")` → 400. The frontend shows it in the relevant panel (dual mode shows "no scans of this polarity").
- **Tests:** positive-only file + negative request → 400 for spectrum, EIC, region and deconvolution.

### ~~1.6 MIC / 4PL (H1, M7, L4)~~
- **Files:** `lab_gui/plate_reader_model.py` (~490–590, 625–690), `web/frontend/src/views/PlateReaderView.tsx` (~189–205, 1380–1545)
- **Changes:**
  1. Fit 4PL **only** when the user has entered numeric concentrations. Auto 2ⁿ labels are display-only and never used as x. Otherwise return `four_pl: null` with `four_pl_skipped_reason`.
  2. Plot bars/points and the fitted curve on the same numeric axis (log₂ axis; draw the zero-concentration growth control as a separate, labelled category).
  3. Show the IC₅₀ with the unit taken from the x label, plus the parameter standard errors from `pcov`, and flag fits where the IC₅₀ lies outside the tested range.
  4. Store tick text / concentrations per session instead of globally.
  5. MIC threshold rule: lowest concentration at which it **and all higher concentrations** are ≤ threshold; exclude the growth-control column from the search.
  6. Blank propagation: use SD of the blank mean (`blank_std/√n_blank`) in quadrature; report n per concentration.
  7. `coerce_numeric_matrix`: raise if any requested row or column is missing instead of dropping it silently.
- **Tests:** known sigmoid (IC₅₀ 2.0, Hill 2) → 2.0 ± 2%; no concentrations → no fit; skipped-well pattern → correct MIC; missing column → 400.

### ~~1.7 FTIR transmittance handling (H6)~~
- **Files:** `lab_gui/ftir_analysis.py` (`preprocess_spectrum`), `web/backend/app/services/ftir_service.py`, `web/frontend/src/views/FTIRView.tsx` (~59–77)
- **Changes:**
  1. When `mode == "transmittance"`, convert to absorbance first (`A = −log10(T/100)` for %T, or `−log10(T)` for fractional; detect by range) and run baseline, normalisation, ATR, integration and fitting in absorbance. Display in %T only if the user asks, converting back.
  2. Auto-detect y-units on upload from file metadata (`YUNITS`, column header) and value range; store in `y_mode`; the UI default follows detection.
  3. Change `DEFAULT_PRE.mode` to follow the detected mode (fallback `absorbance`); fix the "KBr disc" preset accordingly.
- **Tests:** a synthetic %T spectrum with a sloped baseline gives the same peak areas (±2%) as its absorbance twin under rubberband, AsLS, airPLS and polyfit.

### ~~1.8 FTIR smaller corrections (M3, L1, L3)~~
- Remove `msc` from `Normalize` (router + UI), or implement it against a multi-spectrum mean reference. Recommendation: remove now.
- Pseudo-Voigt: parameterise so the Gaussian and Lorentzian share one FWHM (σ = FWHM/2.3548, γ = FWHM/2) and report the FWHM directly.
- Atmospheric mask: replace the broad 1340–1900 and 3400–4000 cm⁻¹ blocks with narrow water-vapour/CO₂ windows, or turn it into "suppress sharp vapour lines" rather than deleting regions; remove it from the presets.
- Label ATR correction in the UI as "approximate (ν/ν_ref)".
- **Tests:** Voigt FWHM round-trip; mask no longer removes 1735 cm⁻¹.

### ~~1.9 UV import time units (M4)~~
- **Files:** `lab_gui/lcms_io.py` (`infer_uv_columns`), `web/backend/app/routers/lcms.py` (UV upload), LCMS UV attach UI
- **Change:** never infer seconds from the value range alone; add an explicit "time unit: minutes/seconds" choice to UV attach (default minutes) and show the detected columns and unit with a warning in the UI. Detect headerless files and read them with `header=None` so the first data row isn't lost.
- **Tests:** headerless 70-minute file stays 0–70 min; the first row is kept.

### ~~1.10 EIC integration robustness (from the review's heuristics note)~~
- **File:** `web/frontend/src/lcms/analysis.ts` (`integrateEICPeak`)
- **Change:** light smoothing before choosing the apex near `referenceRt`; ignore local maxima below 5% of the window maximum. Report area units ("counts·min").
- **Tests:** noisy Gaussian + a nearby spike picks the Gaussian.

**Phase 1 exit:** all new tests green; CHANGELOG lists affected analyses (polymer z>1 labels, RT axes when the display unit was seconds, MIC IC₅₀, FTIR %T intensities, UV time axes).

---

## ~~Phase 2 — Reliability and silent failures (~2–3 days)~~ ✅ DONE 2026-09-23

> **Done:** one commit per task on `fix/review-phase-0-1`. 211 backend tests pass (also in the locked Python 3.12 venv; the full suite also passes on pandas 3.0.6) and 164 frontend tests pass. The restore-error banner was checked in the running app.
>
> - **2.2:** all four registries now share a `_restore_record` that logs failures and records them per session. They're served at `GET /api/workspaces/{wid}/restore-errors` and shown in a dismissable app-wide banner. A missing UV trace is reported too.
> - **Found in 2.2:** FTIR peak fits that failed returned the starting guesses as if they were results. They're now flagged (`converged`/`fit_error`) with a warning in the UI. Asking for more components than detected peaks crashed the fit; it now works.
> - **2.3/2.4 (Data Studio, kept minimal as agreed):** pandas-3 fixes; load options persist. The deployment stays pinned to pandas 2.3 (upgrading is now low-risk but still a deliberate step).
> - **2.6:** the bridge keeps one connection per tab and routes by `X-Browser-Id`; MCP clients fall back to the most recent tab. The action log lives in `MFP_DATA_DIR/automation/`.
>
> **Not done:** a better fit baseline for Lorentzian tails (from the Phase 1 notes). It's optional, so I left it.


### ~~2.1 UV attachment lost on restart (M1)~~ ✅ done with 1.9
- **File:** `lcms_service.py` (~177, 214)
- **Change:** pass `filename=extra.get("uv_filename") or uv_p.name`.
- **Test:** attach UV → new registry instance → list → UV available.

### ~~2.2 Replace bare `except: pass` (M2)~~
- **Files:** all `services/*.py` restore paths, `lcms_io.py` cache, `data_studio_io.py`
- **Change:** log with `logging.exception`, and surface a per-session `restore_error` so the UI can show "file missing / failed to load" instead of the session disappearing.
- Data Studio baseline: if the chosen baseline value is NaN, warn and skip rather than turning the column into NaN.
- Surface `transform_warnings` in the Data Studio UI.

### ~~2.3 Data Studio under pandas 3 (H9 follow-through)~~
- **File:** `lab_gui/data_studio_io.py` (~23–50, 212)
- **Change:** `_coerce_numeric` → try `pd.to_numeric(col)` and catch the error per column (no `errors="ignore"`); `_replace_decimal_commas` checks `is_string_dtype` / `is_object_dtype`; `fillna(method="ffill")` → `.ffill()`.
- **Tests:** run under both pandas 2.3 and 3.x in CI (matrix job); decimal-comma CSV numeric; ffill works.

### ~~2.4 Persist Data Studio load options~~
- Save `sheet_name`, `header_row` and `decimal_comma` into the session's `extra_json` and restore them.

### ~~2.5 FTIR metadata bloat (L6)~~
- Stop the metadata scan at the first numeric data line; cap `meta` at 100 keys.

### ~~2.6 Automation bridge with several users (M8, functional part)~~
- **File:** `automation/browser_bridge.py`
- **Change:** key connections by `browser_id` instead of one global active tab; route each action to the tab that requested it. Move the action log into `MFP_DATA_DIR` so it survives deploys. (Confirmation tokens stay as a safety prompt, not an access control.)

---

## ~~Phase 3 — Server hardening without auth (~1–1.5 days)~~ ✅ DONE 2026-09-23

> **Done:** 225 backend tests and 164 frontend tests pass. An end-to-end smoke test in the running app passed (browser → Vite proxy → API: upload, list and delete; the uploaded file was removed from disk).
>
> - **3.1:** both `from_path` routes are removed. The MCP server never used them. LCMS workspace-load now re-links only sessions that still exist on the server and asks you to re-upload the rest.
> - **3.2:** Vercel Blob is removed completely (the frontend never used it), including the temporary restore folders. The Ollama URL now comes only from `OLLAMA_BASE_URL`; the browser-side Ollama provider is unchanged.
> - **3.3:** no `path` field in any summary, UV summary, automation output or workspace export.
> - **3.4:** size limits via `MFP_MAX_UPLOAD_MB` and `MFP_MAX_DECOMPRESSED_MB`. Deleting a session removes its files and index cache once they're unreferenced, and never touches anything outside the data directory. **Skipped:** the optional OpenAI daily cap. Add it if the key is set on Railway.
> - **3.5:** no CORS by default; `MFP_CORS_ORIGINS` opts origins in.
> - **Also:** `test_workspaces.py` no longer redirects `MFP_DATA_DIR` in the middle of the test run.


These protect the server's own files and resources and are independent of the no-auth decision.

### ~~3.1 Remove server-path endpoints (H7)~~
- Delete `POST /api/lcms/sessions/from_path` and `/sessions/{sid}/uv/from_path`, plus their `api.ts` clients (check the MCP server for users first; if it needs them, restrict paths to inside `MFP_DATA_DIR` via `resolve().is_relative_to`).
- **Test:** 404 for both routes.

### ~~3.2 No server-side fetching of arbitrary URLs (H7)~~
- Remove `blob_url` / `blob_filename` from upload routes and `upload_utils.py`, and the Vercel blob restore code (`blob_store.py`, `get_or_restore` blob branches), unless Vercel Blob is still used — if so, allowlist the `*.blob.vercel-storage.com` host and sanitise the manifest filename (`Path(name).name`).
- Ollama base URL: only from the `OLLAMA_BASE_URL` env var; drop the request field.

### ~~3.3 Stop leaking server paths~~
- Remove `path` from session summaries (`lcms.py:_session_summary`, `_uv_summary`, FTIR, Plate, Data Studio) and from the SI summary sheet.

### ~~3.4 Resource limits (M6)~~
- Max upload size (env `MFP_MAX_UPLOAD_MB`, default 2048), enforced while streaming in `stream_upload_to_file`.
- Bounded gzip decompression (stop past `MAX_DECOMPRESSED_MB`).
- Deleting a session deletes its upload file (if no other session references the same hashed file) and its index cache.
- Temp restore dirs removed after use.
- Optional: cap OpenAI usage (env-configured max requests per day) since the key is shared.

### ~~3.5 CORS~~
- The SPA is same-origin in production; replace `allow_origins=["*"]` with an env-configured list (default: none beyond same-origin; dev: `http://127.0.0.1:5173`).

---

## Phase 4 — Performance (~2–3 days)

Baseline measurements (140 MB mzML, 2,400 scans): upload 4.0 s, spectrum click 1.6 s, EIC 3.3 s, region sum 2.6 s; server fully blocked during each.

### 4.1 Stop blocking the event loop (H8)
- Convert CPU-bound `async def` handlers that don't `await` I/O into plain `def` (FastAPI runs them in the thread pool), or wrap the work in `run_in_threadpool`. Covers the lcms, ftir, plate_reader, data_studio and publication routers.
- **Verify:** health check stays < 100 ms while an EIC runs (reuse the `block.py` measurement as a test or benchmark).

### 4.2 Persistent reader per session
- Keep one open `mzml.PreIndexedMzML` / `MzML` reader per session (under the existing lock), created once; close it on delete.
- **Target:** spectrum click < 100 ms on the 140 MB file.

### 4.3 Vectorise region summing
- Replace the per-point Python loop (`lcms_service.py:459`) with `np.concatenate` + `np.bincount`.
- **Target:** < 0.5 s for a 1-minute window.

### 4.4 Fast EIC
- At load, optionally build a compact centroided peak table (scan index, m/z, intensity) stored as `.npz` next to the index cache; EIC becomes a vectorised mask.
- **Target:** EIC < 0.3 s.

### 4.5 Memory caps
- Global LRU for scan caches (e.g. 500 MB total across sessions, env-configurable); evict idle sessions' parsed state after N minutes.
- `/api/ai/context` should list DB records only and not restore/parse files.

---

## Phase 5 — Reproducibility, then rebuild the SI package (~4–5 days)

### 5.1 Provenance record per result
- New table `analysis_results(id, session_id, module, kind, params_json, result_json, input_sha256, app_version, created_at)`.
- Write a row whenever the user runs MIC, FTIR peaks/fit/integrate, LCMS EIC integration, deconvolution or feature table.
- Every CSV/JSON/PNG export includes a small header or sidecar containing params, input hash and app version.
- `app_version` from the git SHA injected at Docker build (`ARG GIT_SHA`).

### 5.2 Rebuild the SI package (C1, real fix)
- Tables are built **only** from `analysis_results` rows (no placeholders; an empty section says "no stored results").
- The methods text is generated from the stored `params_json` (actual baseline method and λ, tolerances, fit model, n replicates); no claims about fit quality beyond the stored R² values.
- Optionally include the raw input files (the user chooses) and a `manifest.json` with hashes.
- Remove the LCMS `rt_min` crash path.
- Rename "Vector PDF" to "PDF (raster panels)", or render Plotly panels as SVG → PDF for true vector output (L1).
- **Tests:** exported values equal stored results; the methods text contains the actual λ; LCMS sessions no longer cause a 500; re-enable the endpoint and buttons.

---

## Phase 6 — UX, accessibility, maintainability, operations (ongoing)

### 6.1 UX
- Session list: show full names in a tooltip, plus upload time and a short hash to tell duplicates apart.
- Long operations: a server-side progress or spinner state per panel, and clear "this may take ~Ns for large files" hints.
- Error messages: map exceptions to user-facing text; keep details in the server logs.
- Help pages: document polarity handling, the concentration requirement for 4PL, and %T→A conversion.

### 6.2 Accessibility
- `aria-label`/`title` on row-role buttons ("Mark row 1 as sample/control/blank/none").
- Minimum 24×24 px targets for icon buttons; label the 2 unlabeled inputs; keyboard focus styles check.
- Test at a 390 px viewport (not verified in the review).

### 6.3 Maintainability (L5)
- Split `LCMSView.tsx` (9.8k lines) into panel components + hooks per feature (TIC, spectrum, UV, EIC, polymer), one PR per panel, no behaviour change.
- Single source for polymer defaults (`analysis.ts`); delete the copy in `LCMSView.tsx`.
- Keep one lockfile (npm or pnpm) and untrack `node_modules/.vite/...` and `tsconfig.tsbuildinfo`.
- Replace placeholder docstrings as files are touched.

### 6.4 CI
- GitHub Actions: backend pytest (pandas 2.3 and 3.x matrix), frontend lint + vitest, Docker build.

### 6.5 Operations and hosting (decide here)
- Railway: confirm a volume at `/data`; set `MFP_DATA_DIR=/data` explicitly so the index cache and automation log also persist; nightly backup of `/data` (SQLite `.backup` + uploads) to cloud storage; structured logging.
- Because there is no auth, choose one:
  - **(a)** Host on a lab-network machine / behind the university VPN (recommended for GB-scale files and private data), or
  - **(b)** Keep Railway but restrict access at the network level (e.g. Cloudflare Access with an `@mail.huji.ac.il` email rule — no code changes, no app login), or
  - **(c)** Accept public access knowingly.

---

## Suggested order and rough effort

| Order | Phase | Effort |
|---|---|---|
| 1 | ~~0 Safety net + SI disabled~~ ✅ | 0.5 d |
| 2 | ~~1 Scientific correctness~~ ✅ | 4–5 d |
| 3 | ~~2 Reliability~~ ✅ | 2–3 d |
| 4 | ~~3 Hardening without auth~~ ✅ | 1–1.5 d |
| 5 | 4 Performance | 2–3 d |
| 6 | 5 Provenance + real SI package | 4–5 d |
| 7 | 6 UX / a11y / refactor / ops | ongoing |

## Still to validate against reference data (not code changes)

- EIC areas vs vendor software on real files.
- Deconvolution on a protein standard (e.g. myoglobin).
- FTIR library assignments against known polymers.
- airPLS/AsLS vs `pybaselines`.
- Amide I fit vs a protein of known secondary structure.
- 4PL vs GraphPad Prism on real plates.
