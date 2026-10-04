"""Example datasets: list them, and open one as ordinary sessions (copies, display name "Example – …",
experiment tag "Example") so new users can practise without their own files."""
from __future__ import annotations

import shutil
import uuid
from pathlib import Path
from typing import Any, Dict, List

from fastapi import APIRouter, Header, HTTPException
from fastapi.concurrency import run_in_threadpool

from lab_gui.plate_mic import PlateLayout

from ..db import get_upload_dir, save_session_record, set_session_experiment_tag
from ..services.examples_service import DATA_DIR, EXAMPLE_TAG, EXAMPLES, Example, get_example
from ..services.ftir_service import registry as ftir_registry
from ..services.lcms_service import attach_uv_from_csv
from ..services.lcms_service import registry as lcms_registry
from ..services.plate_reader_service import registry as plate_registry
from ..services.plate_reader_service import save_layout
from .lcms import _MZML_UPLOAD_DIR, _UV_UPLOAD_DIR, _ingest_mzml

router = APIRouter()


def _copy(name: str, dest_dir: Path) -> Path:
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / f"example_{uuid.uuid4().hex[:12]}_{name}"
    shutil.copyfile(DATA_DIR / name, dest)
    return dest


def _open(example: Example, workspace_id: str) -> List[str]:
    ids: List[str] = []
    if example.module == "lcms":
        summary = _ingest_mzml(_copy(example.file, _MZML_UPLOAD_DIR), example.display_name, "minutes", workspace_id)
        sid = summary["session_id"]
        if example.uv_file:
            state = lcms_registry.get(sid)
            attach_uv_from_csv(state, _copy(example.uv_file, _UV_UPLOAD_DIR), filename=example.uv_file, rt_unit="auto")
        ids.append(sid)
    elif example.module == "ftir":
        state = ftir_registry.add_from_path(_copy(example.file, get_upload_dir("ftir")), workspace_id=workspace_id,
                                            display_name=example.display_name)
        save_session_record(state.session_id, state.workspace_id, "ftir", state.display_name, str(state.path))
        ids.append(state.session_id)
    elif example.module == "plate_reader":
        for plate in example.plates:
            session = plate_registry.add_from_path(_copy(plate.file, get_upload_dir("plate_reader")),
                                                   workspace_id=workspace_id, display_name=plate.display_name)
            save_layout(session, PlateLayout.from_dict(plate.layout))
            ids.append(session.session_id)
    for sid in ids:
        set_session_experiment_tag(sid, EXAMPLE_TAG)
    return ids


@router.get("")
def list_examples() -> List[Dict[str, Any]]:
    return [e.summary() for e in EXAMPLES]


@router.post("/{example_id}/open")
async def open_example(example_id: str, x_workspace_id: str = Header(default="general", alias="X-Workspace-Id")) -> Dict[str, Any]:
    example = get_example(example_id)
    if example is None:
        raise HTTPException(status_code=404, detail=f"Unknown example '{example_id}'")
    session_ids = await run_in_threadpool(_open, example, x_workspace_id)
    return {"example_id": example.id, "module": example.module, "route": example.route, "session_ids": session_ids}
