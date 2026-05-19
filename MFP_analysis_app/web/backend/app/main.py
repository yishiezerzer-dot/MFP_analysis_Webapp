"""FastAPI entrypoint for the MFP Analysis web app.

Reuses the pure-Python modules under `lab_gui/` so the science stays in
lockstep with the desktop application.
"""
from __future__ import annotations

import sys
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Ensure the project root is on sys.path so we can import `lab_gui.*`
_PROJECT_ROOT = Path(__file__).resolve().parents[3]
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

from .automation import router as automation  # noqa: E402
from .routers import ai, data_studio, ftir, lcms, plate_reader  # noqa: E402

app = FastAPI(
    title="MFP Analysis Web API",
    version="0.1.0",
    description=(
        "Web API for the MFP analysis app. Wraps the existing pure-Python "
        "analysis modules (`lab_gui.lcms_io`, `lab_gui.lcms_model`, etc.)."
    ),
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


app.include_router(lcms.router, prefix="/api/lcms", tags=["lcms"])
app.include_router(plate_reader.router, prefix="/api/plate-reader", tags=["plate-reader"])
app.include_router(data_studio.router, prefix="/api/data-studio", tags=["data-studio"])
app.include_router(ftir.router, prefix="/api/ftir", tags=["ftir"])
app.include_router(ai.router, prefix="/api/ai", tags=["ai"])
app.include_router(automation.router, prefix="/api/automation", tags=["automation"])
