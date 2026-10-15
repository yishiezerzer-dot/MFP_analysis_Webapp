"""Automation action: start the one-click LCMS pipeline on an open run that has a UV trace."""
from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from ...routers.pipeline import start_pipeline_job
from ...services.lcms_pipeline import PipelineSettings
from ..registry import ActionInputError, ActionSpec, register
from .lcms_common import get_lcms_session


class LCMSRunPipelineInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    session_id: str
    settings: PipelineSettings
    workspace_id: str = "general"


class LCMSRunPipelineOutput(BaseModel):
    job_id: str
    status_url: str = Field(description="Poll this for progress; the result is at <status_url>/result.")


@register(
    ActionSpec(
        id="lcms.run_pipeline",
        summary="Run the one-click LCMS pipeline (align UV, pick peaks, label, check) on an open run with UV.",
        input_model=LCMSRunPipelineInput,
        output_model=LCMSRunPipelineOutput,
        risk="safe",
        scope="backend",
    )
)
async def run_pipeline_action(args: LCMSRunPipelineInput) -> LCMSRunPipelineOutput:
    state = get_lcms_session(args.session_id)
    if state.uv is None:
        raise ActionInputError("This run has no UV chromatogram attached.")
    job_id = start_pipeline_job(args.settings, args.workspace_id, session_id=args.session_id)
    return LCMSRunPipelineOutput(job_id=job_id, status_url=f"/api/lcms/pipeline/{job_id}")
