# MFP Analysis — Web App

A browser-based port of the MFP Analysis lab toolkit. Upload your instrument files and get interactive plots, peak tables, and AI-assisted interpretation — no installation required.

Built on top of the same pure-Python analysis modules as the desktop app, so the science stays in lockstep across both.

## Modules

| Module | Status |
|---|---|
| LCMS (mzML viewer) | Working |
| Plate Reader | Working |
| FTIR | Working |
| Data Studio | Working |
| AI Assistant | Working |

## Quick start

```bash
# 1. Python deps
.venv/bin/pip install -r MFP_analysis_app/requirements.txt -r MFP_analysis_app/web/backend/requirements.txt

# 2. Frontend deps
pnpm install

# 3. Run
pnpm dev
```

Open <http://127.0.0.1:5173> — API docs at <http://127.0.0.1:8000/docs>.

## Stack

- **Backend:** FastAPI + Python 3.11
- **Frontend:** Vite + React + TypeScript + Tailwind + Plotly.js
- **Analysis:** shared `lab_gui/` modules (same as desktop app)

## Full documentation

See [MFP_analysis_app/web/README.md](MFP_analysis_app/web/README.md) for architecture, setup details, and next steps.

## Desktop app

The original desktop application lives in [MFP_analysis_app/](MFP_analysis_app/) and runs via Tkinter/Qt.
