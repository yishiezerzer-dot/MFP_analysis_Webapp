"""Publication API: the SI package (supplementary information built from recorded results)."""
from __future__ import annotations

import re
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel

from ..db import get_experiment_bundle, get_session_record
from ..services.si_package import build_si_package

router = APIRouter()

class SIPackageRequest(BaseModel):
    experiment_tag: Optional[str] = None
    session_ids: Optional[List[str]] = None
    include_raw_files: bool = False


@router.post("/si-package")
def generate_si_package(req: SIPackageRequest) -> Response:
    """Supplementary Information ZIP built only from recorded analysis results (see services/si_package.py)."""
    tag = (req.experiment_tag or "").strip()
    if tag:
        records = get_experiment_bundle(tag)["sessions"]
    elif req.session_ids:
        records = [r for r in (get_session_record(sid) for sid in req.session_ids) if r]
    else:
        raise HTTPException(status_code=400, detail="Choose an experiment tag (or sessions) for the SI package.")
    if not records:
        raise HTTPException(status_code=404, detail="No sessions found for this experiment.")
    content = build_si_package(records, experiment_tag=tag, include_raw_files=req.include_raw_files)
    stem = re.sub(r"[^\w\-.]", "_", tag) if tag else "SI"
    filename = f"{stem}_SI_Package.zip"
    return Response(
        content=content,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
