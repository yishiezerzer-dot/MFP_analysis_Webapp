# MFP Analysis App

Full-stack laboratory data analysis platform for mass spectrometry (LCMS), FTIR spectroscopy, plate-reader MIC assays, flexible tabular plotting (Data Studio), and an AI assistant that can reason over your active sessions. The web app reuses the same pure-Python analysis code as the original desktop application, so results stay consistent across interfaces.

**Live development URLs**

| Service | URL |
| --- | --- |
| Frontend (Vite) | http://127.0.0.1:5173 |
| Backend API | http://127.0.0.1:8000 |
| API health check | http://127.0.0.1:8000/api/health |
| OpenAPI docs | http://127.0.0.1:8000/docs |

All frontend `/api/*` requests are proxied to the backend on port 8000.

---

## What the app does

### LCMS (Liquid Chromatography–Mass Spectrometry)

- Load **mzML** files and browse MS1 total-ion chromatograms (TIC), UV traces, and individual spectra.
- Extract ion chromatograms (EICs) by *m/z*, integrate features, overlay multiple runs, and search polymer-related expected products.
- Kendrick mass-defect plots, spectrum labeling, region summation, and **publication-ready figure export** (PNG/SVG with journal-style width presets).
- Session-based workflow: upload files, keep analysis state server-side while you work.

### FTIR (Fourier-Transform Infrared Spectroscopy)

- Load FTIR spectra from common text/CSV formats.
- Preprocessing (baseline correction, smoothing, atmospheric masking), peak picking (including second-derivative mode), peak assignment against a built-in library, reference-spectrum matching, integration, normalization, and peak fitting.
- Interactive Plotly charts with publication export toolbar.

### Plate Reader

- Import plate-reader Excel or delimited files.
- MIC (minimum inhibitory concentration) wizard: define sample/control/blank rows, choose plot types, and visualize dose–response style results.
- Publication figure export for MIC charts.

### Data Studio

- Import CSV or Excel tables (including multi-sheet workbooks).
- Build a transform pipeline (column select/rename, numeric coercion, fill-NA, normalize, baseline, log, rolling mean).
- Create line, scatter, bar, area, step, and histogram plots from transformed data.

### AI Assistant

- Chat interface with context from your active LCMS / FTIR / Plate Reader / Data Studio sessions.
- **Providers:**
  - **Demo** — always available; canned responses, no network.
  - **OpenAI** — requires `OPENAI_API_KEY` and the `openai` Python package (included in requirements).
  - **Ollama** — local LLM at `OLLAMA_BASE_URL` (default `http://127.0.0.1:11434`); install and run [Ollama](https://ollama.com/) separately.
- Can invoke backend **automation actions** (EIC creation, integration, exports, etc.) through the same action catalog used by MCP clients.

### Automation & MCP (optional)

- The backend exposes a structured **automation API** (`/api/automation/*`) with preview/confirm flows for destructive actions.
- A separate **MCP server** in `MFP_analysis_app/mcp_server/` lets Claude Code, Cursor, or other MCP clients drive LCMS analysis through the backend. See [`MFP_analysis_app/mcp_server/README.md`](MFP_analysis_app/mcp_server/README.md).

### Desktop app (legacy)

The original Tkinter + Matplotlib desktop GUI lives in `MFP_analysis_app/lab_gui/`. The web backend imports only the **analysis modules** from that folder (not the UI). To run the desktop app you need additional dependencies (see [Desktop app requirements](#desktop-app-optional) below).

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Browser  →  React 18 + TypeScript + Vite + Plotly          │
│              http://127.0.0.1:5173                          │
└──────────────────────────┬──────────────────────────────────┘
                           │  /api/*  (Vite proxy)
┌──────────────────────────▼──────────────────────────────────┐
│  FastAPI backend  →  uvicorn on :8000                       │
│  Routers: lcms | ftir | plate-reader | data-studio | ai     │
│           automation                                        │
└──────────────────────────┬──────────────────────────────────┘
                           │  imports
┌──────────────────────────▼──────────────────────────────────┐
│  MFP_analysis_app/lab_gui/  (shared pure-Python analysis)   │
│  lcms_io, lcms_model, ftir_analysis, plate_reader_io, …     │
└─────────────────────────────────────────────────────────────┘
```

**Tech stack**

| Layer | Stack |
| --- | --- |
| Frontend | React 18, TypeScript, Vite 5, Tailwind CSS, Plotly (`react-plotly.js`), React Router, Redux Toolkit (installed; store wired per-feature) |
| Backend | Python 3.10+, FastAPI, Uvicorn, Pydantic v2 |
| Analysis | NumPy, Pandas, SciPy, Pyteomics, openpyxl |
| AI | OpenAI SDK, httpx (Ollama HTTP) |

---

## Repository layout

```
.
├── README.md                          ← this file
├── requirements.txt                   ← Python deps (includes backend file)
└── MFP_analysis_app/
    ├── lab_gui/                       ← Shared analysis code + desktop Tk app
    ├── web/
    │   ├── frontend/                  ← React SPA (Vite)
    │   │   ├── package.json
    │   │   └── src/views/           ← LCMS, FTIR, PlateReader, DataStudio, AI
    │   ├── backend/
    │   │   ├── requirements.txt       ← Canonical backend Python deps
    │   │   └── app/
    │   │       ├── main.py
    │   │       ├── routers/
    │   │       ├── services/
    │   │       └── automation/
    │   └── shared_fixtures/           ← Test/sample data
    ├── mcp_server/                    ← Optional MCP bridge (separate install)
    └── PUBLICATION_PLOT_EXPORT_ROADMAP.md
```

> **Important:** The backend adds `MFP_analysis_app/` to `sys.path` and imports `lab_gui.*`. Both folders must exist in the same checkout — do not delete or relocate `lab_gui/` when running the web app.

---

## Requirements

### System requirements

| Requirement | Version / notes |
| --- | --- |
| **Python** | **3.10 or newer** (3.11+ recommended) |
| **Node.js** | **18 or newer** (20 LTS recommended) |
| **npm** or **pnpm** | For frontend dependencies. The combined `npm run dev` script invokes **pnpm** internally — see [Known setup notes](#known-setup-notes). |
| **Git** | To clone the repository |
| **OS** | Windows, macOS, or Linux. Paths in examples use Windows PowerShell; adapt for your shell. |

### Python dependencies (web app)

Install from the **repository root**:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1    # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
```

Root `requirements.txt` includes `MFP_analysis_app/web/backend/requirements.txt`:

| Package | Purpose |
| --- | --- |
| `fastapi`, `uvicorn[standard]`, `python-multipart` | Web API, file uploads |
| `numpy`, `pandas`, `scipy` | Numerical analysis (FTIR peaks, baselines, tables) |
| `pyteomics` | mzML parsing (LCMS) |
| `openpyxl` | Modern Excel (`.xlsx`) read/write |
| `xlrd` | Legacy Excel (`.xls`) via pandas |
| `lxml` | Optional pandas/HTML engine support |
| `httpx`, `openai` | Ollama HTTP client, OpenAI provider |

`pydantic` is not pinned separately; it is installed automatically as a **FastAPI dependency**.

### Node.js dependencies (frontend)

```powershell
cd MFP_analysis_app\web\frontend
npm install
```

Dependencies are declared in `package.json` (React, Plotly, Tailwind toolchain, Vitest, etc.). Lockfiles present: `package-lock.json` and `pnpm-lock.yaml`.

### Optional environment variables

| Variable | Required for | Default |
| --- | --- | --- |
| `OPENAI_API_KEY` | OpenAI AI provider | unset → demo/fallback |
| `OLLAMA_BASE_URL` | Local Ollama LLM | `http://127.0.0.1:11434` |

No `.env` file is required for core analysis modules — only for AI providers you choose to enable.

### Desktop app (optional)

Not covered by the main `requirements.txt`. The Tkinter desktop GUI additionally needs:

- **tkinter** — usually bundled with Python on Windows/macOS; on some Linux distros install `python3-tk`.
- **matplotlib** — `pip install matplotlib`

Run from `MFP_analysis_app/lab_gui/` (see module docstrings / `app.py` entry point).

### MCP server (optional)

Separate package under `MFP_analysis_app/mcp_server/` with its own `pyproject.toml` (`mcp`, `httpx`, `pydantic`). Not included in root `requirements.txt`. See the [MCP server README](MFP_analysis_app/mcp_server/README.md).

### Development / testing (optional)

Backend tests use **pytest** but pytest is **not** listed in `requirements.txt`. To run backend tests:

```powershell
pip install pytest
cd MFP_analysis_app\web\backend
pytest tests/
```

Frontend tests use Vitest (included in `devDependencies`):

```powershell
cd MFP_analysis_app\web\frontend
npm run test:run
```

---

## Requirements audit — are the `requirements.txt` files enough?

There are **two** Python requirements files:

1. **`requirements.txt`** (repo root) — convenience wrapper; `-r MFP_analysis_app/web/backend/requirements.txt`
2. **`MFP_analysis_app/web/backend/requirements.txt`** — canonical backend list

### Verdict for running the **web app**

**Yes — the Python requirements are sufficient for the web backend and all five analysis modules**, provided you also install Node dependencies for the frontend.

Verified against actual imports in `web/backend/app/` and the `lab_gui` modules the backend uses (`lcms_io`, `ftir_analysis`, `plate_reader_io`, `data_studio_io`, `ai_assistant`, etc.):

| Dependency | In requirements? | Used by web backend? |
| --- | --- | --- |
| fastapi / uvicorn / multipart | ✓ | API layer |
| numpy / pandas | ✓ | All modules |
| scipy | ✓ | FTIR peak picking, Savitzky–Golay, baselines (`ftir_analysis.py`) |
| pyteomics | ✓ | mzML (LCMS) |
| openpyxl | ✓ | `.xlsx` in Data Studio & Plate Reader |
| xlrd | ✓ | Legacy `.xls` in `load_table` / plate reader |
| lxml | ✓ | Not directly imported; safe optional pandas extra |
| httpx / openai | ✓ | AI assistant |
| pydantic | transitive | FastAPI models & automation |
| matplotlib / tkinter | **not listed** | **Not needed for web** — desktop UI only |

### Gaps and caveats (documented, not blockers)

1. **`npm run dev` calls `pnpm`** — The frontend `package.json` `"dev"` script runs `pnpm run dev:frontend` and `pnpm run dev:backend`. If you only installed npm, either install pnpm (`npm install -g pnpm`) or start frontend and backend in **two terminals** (see below).
2. **Python venv must be active** when the frontend starts the backend via `dev:backend` (`python -m uvicorn …`).
3. **`lab_gui/` must be present** — documented in requirements comments; missing folder causes import errors at startup.
4. **pytest not in requirements.txt** — only affects contributors running backend tests, not normal app use.
5. **Ollama is external** — not a pip package; install the Ollama application separately if you want local LLM chat.
6. **MCP server is a separate install** — intentional; not required to use the web UI.
7. **No pinned upper bounds** — `>=` versions allow newer releases; if you hit a breakage, pin versions in a fresh venv and report an issue.

### Frontend `package.json`

All runtime and build dependencies for the SPA are declared. **`npm install`** (or `pnpm install`) is required in addition to Python — there is no single file that installs both stacks.

---

## Quick start

### 1. Clone and create a Python environment

```powershell
git clone <your-repo-url>
cd "Yishi's app"
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

### 2. Install frontend dependencies

```powershell
cd MFP_analysis_app\web\frontend
npm install
```

### 3. Start the app

**Option A — two terminals (works with npm only)**

Terminal 1 — backend:

```powershell
cd MFP_analysis_app\web\backend
python -m uvicorn app.main:app --reload --port 8000
```

Terminal 2 — frontend:

```powershell
cd MFP_analysis_app\web\frontend
npm run dev:frontend
```

**Option B — single command (requires pnpm on PATH)**

```powershell
cd MFP_analysis_app\web\frontend
pnpm install
npm run dev
```

Opens http://127.0.0.1:5173 with hot reload on both frontend and backend.

### 4. Verify

- Browser: http://127.0.0.1:5173 — LCMS tab loads.
- API: http://127.0.0.1:8000/api/health → `{"status":"ok"}`

Sample fixture data for manual testing: `MFP_analysis_app/web/shared_fixtures/`.

---

## Production build (frontend only)

The backend is typically run with uvicorn directly; the frontend can be built to static assets:

```powershell
cd MFP_analysis_app\web\frontend
npm run build
npm run preview
```

For production deployment you would serve `dist/` behind a reverse proxy that forwards `/api` to the FastAPI process. That deployment layout is project-specific and not automated in this repo.

---

## Theming

Three visual themes: **day**, **night**, and **night-vision**, toggled via `data-theme` on the document root. Charts use Plotly with theme tokens for background and ink colors.

---

## API overview

| Prefix | Module |
| --- | --- |
| `/api/lcms` | LCMS sessions, TIC, EIC, spectra, polymer search, exports |
| `/api/ftir` | FTIR load, preprocess, peaks, assignment, matching, fit |
| `/api/plate-reader` | Plate import, MIC analysis, plotting |
| `/api/data-studio` | Table load, transforms, plot generation |
| `/api/ai` | Chat, provider status, context snapshot |
| `/api/automation` | Action catalog, preview/execute, browser WebSocket bridge |

Interactive OpenAPI documentation: http://127.0.0.1:8000/docs

---

## Known setup notes

- **Combined dev script and pnpm:** Prefer two-terminal startup if you do not use pnpm.
- **Windows paths with spaces:** Quote paths when `cd`-ing (as in examples above).
- **Large mzML files:** First load can take time while the backend builds the MS1 index; subsequent operations use in-memory session state.
- **AI demo mode:** Works offline; switch provider in the AI tab after setting API keys or starting Ollama.

---

## Contributing / verification

```powershell
# Frontend type-check
cd MFP_analysis_app\web\frontend
npm run lint

# Frontend unit tests
npm run test:run

# Backend tests (after pip install pytest)
cd ..\backend
pytest tests/
```

---

## License

Add your license here if not already specified in the repository.

## Contact

Moran's lab — update with maintainer contact or issue tracker URL as appropriate.
