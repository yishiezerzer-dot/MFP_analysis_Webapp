"""One-click LCMS pipeline: upload mzML + UV CSV (or use an open run), run as a background job,
then review labels and download the figure and workbook.

POST   /api/lcms/pipeline                 multipart: mzml, uv, settings (JSON) [, session_id] -> {job_id}
GET    /api/lcms/pipeline/{id}            status, progress, step, messages
GET    /api/lcms/pipeline/{id}/result     the PipelineResult
GET    /api/lcms/pipeline/{id}/figure.svg | figure.png | figure-print.png | peaks.xlsx
PATCH  /api/lcms/pipeline/{id}/labels     approve/reject labels, outputs regenerated
DELETE /api/lcms/pipeline/{id}            cancel
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, File, Form, Header, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse
from pydantic import BaseModel, ValidationError

from ..db import get_job, get_session_record
from ..provenance import app_version, record, session_input_sha256
from ..services.jobs import JobContext, job_manager
from ..services.lcms_pipeline import PipelineResult, PipelineSettings, apply_layout, peak_spectrum, run_pipeline
from ..services.lcms_pipeline_report import write_outputs
from ..services.lcms_service import LCMSSessionState, attach_uv_from_csv, registry
from ..upload_utils import stream_upload_to_file
from .lcms import _MZML_UPLOAD_DIR, _UV_UPLOAD_DIR, _ingest_mzml

router = APIRouter()
KIND = "pipeline"


class LabelReview(BaseModel):
    id: str
    review: Literal["approved", "rejected", "pending"]


class LabelReviewRequest(BaseModel):
    updates: List[LabelReview]


def parse_settings(raw: str) -> PipelineSettings:
    try:
        return PipelineSettings.model_validate(json.loads(raw or "{}"))
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=422, detail=f"settings is not valid JSON: {exc}") from exc
    except ValidationError as exc:
        first = exc.errors()[0]
        where = ".".join(str(p) for p in first.get("loc", ()))
        raise HTTPException(status_code=422, detail=f"settings.{where}: {first.get('msg')}") from exc


def _provenance(state: LCMSSessionState, job_id: str) -> Dict[str, Any]:
    rec = get_session_record(state.session_id) or {}
    return {
        "job_id": job_id,
        "app_version": app_version(),
        "mzml_file": state.display_name,
        "mzml_sha256": session_input_sha256(rec) if rec else None,
        "uv_file": state.uv.filename if state.uv else None,
        "session_id": state.session_id,
    }


def _finish(ctx: JobContext, state: LCMSSessionState, settings: PipelineSettings) -> Dict[str, Any]:
    result = run_pipeline(state, settings, lambda f, step: ctx.progress(0.1 + 0.85 * f, step))
    for message in result.messages:
        ctx.log(message)
    ctx.progress(0.96, "Writing figure and workbook")
    write_outputs(result, ctx.output_dir, _provenance(state, ctx.job_id))
    approved = [lab.text for lab in result.labels if lab.review == "approved"]
    record(state.session_id, "lcms_pipeline", settings.model_dump(), {
        "job_id": ctx.job_id,
        "offset_min": result.alignment.offset_min,
        "n_peaks": len(result.peaks),
        "approved_labels": approved,
    })
    ctx.log(f"{len(result.peaks)} UV peaks, {len(approved)} label(s) approved automatically.")
    return {"session_id": state.session_id}


def _require_job(job_id: str) -> Dict[str, Any]:
    job = get_job(job_id)
    if job is None or job["kind"] != KIND:
        raise HTTPException(status_code=404, detail="Pipeline job not found.")
    return job


def _require_done(job_id: str) -> Dict[str, Any]:
    job = _require_job(job_id)
    if job["status"] != "done":
        raise HTTPException(status_code=409, detail=f"The pipeline is {job['status']}, not finished.")
    return job


def _load_result(job: Dict[str, Any]) -> PipelineResult:
    path = Path(job["output_dir"]) / "result.json"
    if not path.is_file():
        raise HTTPException(status_code=404, detail="The pipeline result file is missing.")
    return PipelineResult.model_validate_json(path.read_text(encoding="utf-8"))


def start_pipeline_job(settings: PipelineSettings, workspace_id: str, *, session_id: Optional[str] = None,
                       mzml: Optional[tuple[Path, str]] = None, uv: Optional[tuple[Path, str]] = None, rt_unit: str = "minutes") -> str:
    """Queue a pipeline run on an open session or on freshly uploaded files; returns the job id."""

    def work(ctx: JobContext) -> Dict[str, Any]:
        ctx.progress(0.01, "Opening the run")
        if mzml is not None:
            summary = _ingest_mzml(mzml[0], mzml[1], rt_unit, workspace_id)
            state = registry.get(summary["session_id"])
            ctx.log(f"Opened {mzml[1]}.")
        else:
            state = registry.get(str(session_id))
        if state is None:
            raise ValueError("The LCMS run is no longer open.")
        if uv is not None:
            ctx.progress(0.06, "Reading the UV chromatogram")
            attach_uv_from_csv(state, uv[0], filename=uv[1], rt_unit="auto")
            ctx.log(f"Attached UV {uv[1]}.")
        if state.uv is None:
            raise ValueError("This run has no UV chromatogram; add a UV CSV.")
        return _finish(ctx, state, settings)

    params = {"settings": settings.model_dump(), "mzml": mzml[1] if mzml else None, "uv": uv[1] if uv else None}
    return job_manager().submit(KIND, work, params=params, workspace_id=workspace_id, session_id=session_id)


@router.post("")
async def create_pipeline(
    settings: str = Form(...),
    mzml: Optional[UploadFile] = File(None),
    uv: Optional[UploadFile] = File(None),
    session_id: Optional[str] = Form(None),
    rt_unit: str = Form("minutes"),
    x_workspace_id: str = Header(default="general", alias="X-Workspace-Id"),
) -> Dict[str, str]:
    parsed = parse_settings(settings)
    if mzml is not None:
        if uv is None:
            raise HTTPException(status_code=422, detail="Upload the UV CSV exported with this run.")
    elif session_id:
        state = registry.get(session_id)
        if state is None:
            raise HTTPException(status_code=404, detail="LCMS run not found.")
        if state.uv is None and uv is None:
            raise HTTPException(status_code=422, detail="This run has no UV chromatogram; upload a UV CSV too.")
    else:
        raise HTTPException(status_code=422, detail="Upload an mzML file or choose an open run (session_id).")
    mz_saved = (
        await stream_upload_to_file(mzml, _MZML_UPLOAD_DIR, allowed_extensions={".mzml", ".mzml.gz"}) if mzml else None
    )
    uv_saved = await stream_upload_to_file(uv, _UV_UPLOAD_DIR, allowed_extensions={".csv", ".tsv", ".txt"}) if uv else None
    job_id = start_pipeline_job(
        parsed, x_workspace_id, session_id=None if mzml else session_id, mzml=mz_saved, uv=uv_saved, rt_unit=rt_unit
    )
    return {"job_id": job_id}


@router.get("/{job_id}")
def pipeline_status(job_id: str) -> Dict[str, Any]:
    job = _require_job(job_id)
    return {
        "job_id": job["id"],
        "status": job["status"],
        "progress": job["progress"],
        "step": job["step"],
        "messages": [entry["message"] for entry in job["log"]],
        "error": job["error"],
        "session_id": job["session_id"],
        "created_at": job["created_at"],
        "updated_at": job["updated_at"],
    }


@router.get("/{job_id}/result")
def pipeline_result(job_id: str) -> Dict[str, Any]:
    return _load_result(_require_done(job_id)).model_dump()


def _file(job_id: str, name: str, media_type: str) -> FileResponse:
    job = _require_done(job_id)
    path = Path(job["output_dir"]) / name
    if not path.is_file():
        raise HTTPException(status_code=404, detail=f"{name} is missing.")
    result = _load_result(job)
    stem = Path(result.display_name).stem or "lcms"
    return FileResponse(path, media_type=media_type, filename=f"{stem}_pipeline_{name}")


@router.get("/{job_id}/peaks/{peak_id}/spectrum")
def pipeline_peak_spectrum(job_id: str, peak_id: str) -> Dict[str, Any]:
    """The summed (and background-subtracted) spectrum the pipeline labelled this UV peak from."""
    result = _load_result(_require_done(job_id))
    state = registry.get(result.session_id)
    if state is None:
        raise HTTPException(status_code=404, detail="The LCMS run of this pipeline is no longer open.")
    try:
        return peak_spectrum(state, result, peak_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"No UV peak {peak_id} in this result.") from None


@router.get("/{job_id}/figure.svg")
def pipeline_figure_svg(job_id: str) -> FileResponse:
    return _file(job_id, "figure.svg", "image/svg+xml")


@router.get("/{job_id}/figure.png")
def pipeline_figure_png(job_id: str) -> FileResponse:
    return _file(job_id, "figure.png", "image/png")


@router.get("/{job_id}/figure-print.png")
def pipeline_figure_print_png(job_id: str) -> FileResponse:
    """180 × 100 mm at 600 dpi, labels laid out for that size."""
    return _file(job_id, "figure-print.png", "image/png")


@router.get("/{job_id}/peaks.xlsx")
def pipeline_workbook(job_id: str) -> FileResponse:
    return _file(job_id, "peaks.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")


@router.patch("/{job_id}/labels")
async def review_labels(job_id: str, body: LabelReviewRequest) -> Dict[str, Any]:
    job = _require_done(job_id)
    result = _load_result(job)
    by_id = {lab.id: lab for lab in result.labels}
    missing = [u.id for u in body.updates if u.id not in by_id]
    if missing:
        raise HTTPException(status_code=422, detail=f"Unknown label id(s): {', '.join(missing)}")
    for update in body.updates:
        by_id[update.id].review = update.review
    apply_layout(result)
    state = registry.get(result.session_id)
    provenance = _provenance(state, job_id) if state else {"job_id": job_id, "app_version": app_version()}
    await run_in_threadpool(write_outputs, result, Path(job["output_dir"]), provenance)
    return result.model_dump()


@router.delete("/{job_id}")
def cancel_pipeline(job_id: str) -> Dict[str, Any]:
    job = _require_job(job_id)
    return {"cancelled": job_manager().cancel(job_id), "status": (get_job(job_id) or job)["status"]}
