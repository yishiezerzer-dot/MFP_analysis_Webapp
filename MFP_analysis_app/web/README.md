# MFP Analysis — Web Edition

A web port of the MFP Analysis desktop app. Built on top of the existing
pure-Python analysis modules (`lab_gui/lcms_io.py`, `lab_gui/lcms_model.py`,
`lab_gui/lcms_polymer_match.py`, `lab_gui/ftir_*`, `lab_gui/plate_reader_*`,
`lab_gui/data_studio_*`) so the science stays in lockstep with the desktop app.

## Architecture

```
/
├── lab_gui/                # existing Tk app + pure-Python science modules
├── web/
│   ├── backend/            # FastAPI server
│   │   ├── requirements.txt
│   │   └── app/
│   │       ├── main.py     # FastAPI app + CORS + router registration
│   │       ├── routers/
│   │       │   ├── lcms.py
│   │       │   ├── ftir.py
│   │       │   ├── plate_reader.py
│   │       │   ├── data_studio.py
│   │       │   └── ai.py
│   │       └── services/
│   │           ├── lcms_service.py         # wraps MzMLTICIndex + pyteomics
│   │           ├── ftir_service.py         # wraps ftir_io + ftir_analysis + ftir_assignment
│   │           ├── plate_reader_service.py # wraps plate_reader_io + plate_reader_model
│   │           ├── data_studio_service.py  # wraps data_studio_io.load_table + apply_transform_steps
│   │           └── ai_service.py           # wraps ai_assistant + ai_openai_client + ai_ollama_client
│   └── frontend/           # Vite + React + TypeScript + Tailwind + Plotly
├── package.json            # root — `pnpm dev` runs API + UI together
└── pnpm-workspace.yaml
```

- **Backend:** FastAPI on `127.0.0.1:8000`. Session state (loaded mzML files)
  lives in-process in `LCMSRegistry`; plenty for a local dev workflow, trivial
  to swap for Redis/disk later.
- **Frontend:** Vite dev server on `127.0.0.1:5173`, proxies `/api/*` to the
  backend.
- **Charts:** Plotly.js — chosen because the desktop app leans heavily on
  pan / zoom / click interactions that map cleanly to Plotly's event model.

## What's implemented

| Tab | Status |
|---|---|
| LCMS (mzML viewer) | Working: upload, TIC, click-to-spectrum, top-peak annotation, polarity filter, multiple sessions |
| Plate Reader | Working: upload (.xlsx/.xlsm/.xls/.csv/.tsv/.txt), sheet picker, preview table with click-to-assign sample/control rows and concentration columns, MIC wizard (bar/line/scatter + bars/line control style), error bars, auto 2^n tick labels, multiple sessions |
| FTIR | Working: upload (CSV/TXT/JASCO `XYDATA`), preprocess (SavGol smoothing + poly baseline + max/area normalize), peak picking (scipy `find_peaks` with pure-Python fallback), library-based bond assignment (FTIR_LIBRARY_V2), reverse-x Plotly plot, peaks table with scored candidates, multiple sessions |
| Data Studio | Working: upload (CSV/TSV/TXT/Excel), sheet/header/decimal-comma options, schema + live preview, transform pipeline (select/drop, rename, to_numeric, fillna, normalize, baseline, log, rolling mean) with ordered steps and warnings, plot builder (Line/Scatter/Line+markers/Bar/Bar stacked/Area/Step/Histogram), per-axis normalization + log, multi-Y overlay, decimated series for large tables |
| AI Assistant | Working: chat UI with provider switch (Demo / OpenAI / local Ollama), editable model name, app-context picker across LCMS/FTIR/Plate Reader/Data Studio sessions, shared `lab_gui.ai_assistant` system prompt, demo-mode fallback when no key / server is available |

## Prerequisites

- Python 3.11 in `.venv/` at the project root (see the top-level README for
  setup; on macOS make sure the Python build includes `_tkinter` if you also
  want to run the desktop app).
- Node.js ≥ 18 and pnpm.

## First-time setup

From the project root:

```bash
# 1. Python deps (desktop + web backend)
.venv/bin/pip install -r requirements.txt -r web/backend/requirements.txt

# 2. Frontend deps
pnpm install
```

## Run (dev)

```bash
pnpm dev
```

This starts the FastAPI backend (`uvicorn --reload` on :8000) and the Vite
frontend (:5173) in parallel via `concurrently`. Open
<http://127.0.0.1:5173>.

- API docs: <http://127.0.0.1:8000/docs>
- Health check: <http://127.0.0.1:8000/api/health>

Run them separately if you prefer:

```bash
pnpm dev:api    # backend only
pnpm dev:web    # frontend only
```

## Production build

```bash
pnpm build
```

Writes the frontend bundle to `web/frontend/dist/`. To serve it from the
FastAPI app in production, mount it as static files (not wired in yet — add an
`app.mount("/", StaticFiles(directory=..., html=True), name="ui")` in
`web/backend/app/main.py`).

## How the ports reuse desktop logic

The web app deliberately **does not reimplement** any analysis. The backend
routers call the same pure-Python modules the desktop app uses.

**LCMS**

- `MzMLTICIndex.build()` (`lab_gui/lcms_io.py`) is called on upload to
  produce the MS1 metadata index (RT / TIC / polarity).
- A per-session `pyteomics.mzml.MzML` reader is opened on demand in
  `fetch_spectrum_at_rt` to pull full `m/z` + `intensity` arrays for the scan
  closest to a requested RT — mirroring the pattern in `lab_gui/app.py`.
- `top_n_peaks` in `lcms_service.py` provides basic peak labels. Polymer
  matching (`lab_gui/lcms_polymer_match`) is a next step on the same service
  layer.

**Plate Reader**

- `list_excel_sheets`, `read_plate_file`, `preview_dataframe` from
  `lab_gui/plate_reader_io.py` handle file IO and table preview.
- `build_mic_wizard_config_and_result` from `lab_gui/plate_reader_model.py`
  is the single source of truth for the MIC computation (coerce numeric
  matrix, aggregate mean ± std, auto-generate 2^n tick labels). The web view
  renders it with Plotly instead of matplotlib but the numbers are
  bit-identical to the desktop app.

**Data Studio**

- `load_table` from `lab_gui/data_studio_io.py` handles CSV/TSV/TXT
  (python engine, delimiter sniffing, optional decimal-comma replacement)
  and Excel (`xlsx/xlsm/xls`) with sheet + header-row picking, plus
  numeric auto-cast — same behaviour as the desktop app.
- `apply_transform_steps(df, steps)` in the same module is the single
  source of truth for the transform pipeline. The UI just sends a list
  of `{type, columns, ...}` dicts; warnings raised during evaluation are
  surfaced next to the preview.
- `numeric_columns`, `column_type_map`, `schema_hash_from_columns` and
  `normalize_series` drive the schema view and plot normalization.

**AI Assistant**

- `AIAssistant` from `lab_gui/ai_assistant.py` is the single source of truth
  for the system prompt, the prompt-construction logic (`_build_user_prompt`)
  and the safe demo-mode fallback (`_mock_response`).
- `OpenAIChatClient` (`lab_gui/ai_openai_client.py`) and `OllamaChatClient`
  (`lab_gui/ai_ollama_client.py`) are reused verbatim as provider adapters.
- `ai_service.run_chat` adds one thing the desktop panel doesn't need: a
  multi-turn path that folds the shared system prompt + a read-only app
  context block into the `messages` array before calling the live
  provider. Demo mode still uses `AIAssistant.ask` directly.
- App context for the prompt is assembled on the fly from the web
  backend's own `lcms_service.registry`, `ftir_service.registry`,
  `plate_reader_service.registry` and `data_studio_service.registry`
  (just the session id + display name per module — never raw frames or
  arrays), mirroring the `AppAIContext` shape from
  `lab_gui/ai_context.py`.
- `OPENAI_API_KEY` enables the OpenAI provider; set `OLLAMA_BASE_URL` (or
  edit it inline in the sidebar) to point the Ollama provider at a
  non-default host.

**FTIR**

- `_parse_ftir_xy_numpy` from `lab_gui/ftir_io.py` reads JASCO-style
  exports (`XYDATA` blocks with CSV/TSV) as well as generic numeric
  text files — same parser the desktop app uses.
- `preprocess_spectrum` and `pick_peaks` from `lab_gui/ftir_analysis.py`
  drive the in-app controls (mode / smoothing_window / poly_order /
  baseline / normalize, plus min_prominence / min_distance_cm1 / top_n).
  When SciPy is installed `find_peaks` is used; otherwise the module falls
  back to its own local-maxima + prominence estimator automatically.
- `assign_ftir_peaks(..., FTIR_LIBRARY_V2, ...)` from
  `lab_gui/ftir_assignment.py` + `lab_gui/ftir_library.py` returns scored
  candidate bond assignments per peak. The frontend colour-codes scores
  (≥70 green, ≥40 amber, otherwise grey) and shows the top N alternates.

## Next steps

Roughly in order of value:

1. LCMS: UV CSV overlay, polymer matching, export spectrum/TIC CSV+PNG,
   custom label editing, multi-session overlays.
2. FTIR polish: overlay groups (`OverlayGroup`), draggable bond labels,
   workspace save/load, custom label overrides, min_height threshold UI.
3. AI Assistant polish: streaming responses (SSE), per-session snapshot
   blocks (peak tables, MIC summaries) in the prompt, conversation export.
4. Data Studio polish: saved plot recipes (`DataStudioWorkspace.recipes`),
   workspace save/load via `lab_gui.data_studio_workspace_io`, bubble /
   heatmap / box / violin plot kinds, export via `data_studio_export.py`.
5. Plate Reader polish: blank subtraction, MIC-wide detect-steps helpers
   (`detect_mic_wide_step_columns`, `default_mic_wide_step_to_conc`), persist
   workspace as `.plate_reader.workspace.json` via `lab_gui.data_studio_workspace_io`.
