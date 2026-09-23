"""FastAPI entrypoint for the MFP Analysis web app.

Reuses the pure-Python modules under `lab_gui/` so the science stays in
lockstep with the desktop application.
"""
from __future__ import annotations

import logging
import os
import sys
import uuid
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

# Ensure the project root is on sys.path so we can import `lab_gui.*`
_PROJECT_ROOT = Path(__file__).resolve().parents[3]
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

from .automation import router as automation  # noqa: E402
from .db import init_db  # noqa: E402
from .routers import ai, data_studio, experiments, ftir, lcms, plate_reader, publication, workspaces  # noqa: E402

init_db()

app = FastAPI(
    title="MFP Analysis Web API",
    version="0.1.0",
    description=(
        "Web API for the MFP analysis app. Wraps the existing pure-Python "
        "analysis modules (`lab_gui.lcms_io`, `lab_gui.lcms_model`, etc.)."
    ),
)

# The SPA is served same-origin (by this app in production, via the Vite proxy in dev), so no
# CORS is needed by default; a wildcard would let any website read lab data from a visitor's
# browser. MFP_CORS_ORIGINS (comma-separated) opts specific origins in.
_cors_origins = [o.strip() for o in os.environ.get("MFP_CORS_ORIGINS", "").split(",") if o.strip()]
if _cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_cors_origins,
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )


@app.exception_handler(Exception)
async def unexpected_error(request: Request, exc: Exception) -> JSONResponse:
    # Full traceback to the server log; the browser gets a short message with a reference to
    # find it, not internal details (paths, library messages).
    ref = uuid.uuid4().hex[:8]
    logging.getLogger("mfp.errors").error("Unhandled error %s on %s %s", ref, request.method, request.url.path, exc_info=exc)
    return JSONResponse(
        status_code=500,
        content={"detail": f"Unexpected server error (reference {ref}). The details are in the server log."},
    )


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


app.include_router(lcms.router, prefix="/api/lcms", tags=["lcms"])
app.include_router(plate_reader.router, prefix="/api/plate-reader", tags=["plate-reader"])
app.include_router(data_studio.router, prefix="/api/data-studio", tags=["data-studio"])
app.include_router(ftir.router, prefix="/api/ftir", tags=["ftir"])
app.include_router(ai.router, prefix="/api/ai", tags=["ai"])
app.include_router(workspaces.router, prefix="/api/workspaces", tags=["workspaces"])
app.include_router(experiments.router, prefix="/api/experiments", tags=["experiments"])
app.include_router(publication.router, prefix="/api/publication", tags=["publication"])
app.include_router(automation.router, prefix="/api/automation", tags=["automation"])

_FRONTEND_DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"
if _FRONTEND_DIST.is_dir():
    _assets_dir = _FRONTEND_DIST / "assets"
    if _assets_dir.is_dir():
        app.mount("/assets", StaticFiles(directory=_assets_dir), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        if full_path.startswith("api/") or full_path == "api":
            raise HTTPException(status_code=404, detail="Not Found")
        target_file = (_FRONTEND_DIST / full_path).resolve()
        if target_file.is_relative_to(_FRONTEND_DIST.resolve()) and target_file.is_file():
            return FileResponse(target_file)
        return FileResponse(_FRONTEND_DIST / "index.html")
