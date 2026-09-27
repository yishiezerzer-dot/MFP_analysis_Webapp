"""Plate Reader API (plate maps and MIC analysis).

1. POST   /sessions                       Upload a plate (Gen5 export or any labelled 8x12 grid).
2. GET    /sessions, /sessions/{sid}      Plate values, Gen5 metadata/notes and the layout.
3. PUT    /sessions/{sid}/layout          Save the plate layout.
4. POST   /sessions/{sid}/analysis        Blank, % growth, mean/SD per concentration, checks (recorded).
5. GET    /sessions/{sid}/workbook        Excel workbook with every step as a live formula.
6. GET/POST/DELETE /templates            Named layouts shared by the lab.
7. GET    /experiments/{tag}              All plates with an experiment tag, analysed.
8. DELETE /sessions/{sid}
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, File, Header, HTTPException, Query, Response, UploadFile
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field, field_validator

from lab_gui.plate_gen5 import PlateReadError
from lab_gui.plate_mic import PlateLayout, analyse_plate

from ..db import (
    delete_plate_template,
    get_session_record,
    get_upload_dir,
    list_plate_templates,
    list_session_records,
    remove_unreferenced_files,
    save_plate_template,
)
from ..provenance import record
from ..services.plate_reader_service import layout_for, registry, save_layout
from ..services.plate_workbook import build_workbook
from ..upload_utils import stream_upload_to_file

router = APIRouter()

_ALLOWED = {".xlsx", ".xlsm", ".xls", ".csv", ".txt", ".tsv"}
_WELL = re.compile(r"^[A-H](?:[1-9]|1[0-2])$")


def _summary(s) -> Dict[str, Any]:
    rec = get_session_record(s.session_id)
    layout, source = layout_for(s)
    return {
        "session_id": s.session_id,
        "workspace_id": s.workspace_id,
        "display_name": s.display_name,
        "experiment_tag": rec.get("experiment_tag", "") if rec else "",
        "uploaded_at": rec.get("created_at") if rec else None,
        "metadata": s.read.metadata,
        "notes": s.read.notes,
        "label": s.read.label,
        "values": s.read.values,
        "layout": layout.to_dict(),
        "layout_source": source,
    }


def _require_session(sid: str):
    s = registry.get(sid)
    if s is None:
        raise HTTPException(status_code=404, detail="session not found")
    return s


class DilutionModel(BaseModel):
    top: float = Field(1024.0, gt=0)
    unit: str = "µg/mL"
    factor: float = Field(2.0, gt=1)
    direction: Literal["columns", "rows"] = "columns"
    first: int = Field(1, ge=1, le=12)
    last: int = Field(11, ge=1, le=12)


class GroupModel(BaseModel):
    id: str
    name: str = Field(min_length=1)
    kind: Literal["sample", "reference"] = "sample"
    wells: List[str] = Field(default_factory=list)
    colour: Optional[str] = None

    @field_validator("wells")
    @classmethod
    def _wells(cls, v: List[str]) -> List[str]:
        return _check_wells(v)


class LayoutModel(BaseModel):
    dilution: DilutionModel = Field(default_factory=DilutionModel)
    groups: List[GroupModel] = Field(default_factory=list)
    growth_control: List[str] = Field(default_factory=list)
    blank: List[str] = Field(default_factory=list)
    excluded: List[str] = Field(default_factory=list)

    @field_validator("growth_control", "blank", "excluded")
    @classmethod
    def _wells(cls, v: List[str]) -> List[str]:
        return _check_wells(v)

    def to_layout(self) -> PlateLayout:
        return PlateLayout.from_dict(self.model_dump())


def _check_wells(wells: List[str]) -> List[str]:
    bad = [w for w in wells if not _WELL.match(w)]
    if bad:
        raise ValueError(f"not a 96-well position: {', '.join(bad[:5])}")
    return wells


@router.get("/status")
def status() -> Dict[str, str]:
    return {"status": "ok"}


@router.post("/sessions")
async def create_session(
    file: UploadFile = File(...),
    x_workspace_id: str = Header(default="general", alias="X-Workspace-Id"),
) -> Dict[str, Any]:
    dest, name = await stream_upload_to_file(file, get_upload_dir("plate_reader"), allowed_extensions=_ALLOWED)
    try:
        session = await run_in_threadpool(registry.add_from_path, dest, workspace_id=x_workspace_id, display_name=name)
    except PlateReadError as exc:
        remove_unreferenced_files({"file_path": str(dest), "extra": {}})
        raise HTTPException(status_code=400, detail=f"{name}: {exc}")
    return _summary(session)


@router.get("/sessions")
def list_sessions(x_workspace_id: str = Header(default="general", alias="X-Workspace-Id")) -> List[Dict[str, Any]]:
    return [_summary(s) for s in registry.list(workspace_id=x_workspace_id)]


@router.get("/sessions/{sid}")
def get_session(sid: str) -> Dict[str, Any]:
    return _summary(_require_session(sid))


@router.put("/sessions/{sid}/layout")
def put_layout(sid: str, body: LayoutModel) -> Dict[str, Any]:
    s = _require_session(sid)
    save_layout(s, body.to_layout())
    return body.model_dump()


class AnalysisRequest(BaseModel):
    layout: Optional[LayoutModel] = None
    subtract_blank: bool = True
    fit_4pl: bool = False


def _analyse(s, layout: PlateLayout, *, subtract_blank: bool, fit_4pl: bool) -> Dict[str, Any]:
    return analyse_plate(s.read.values, layout, subtract_blank=subtract_blank, fit_4pl=fit_4pl)


@router.post("/sessions/{sid}/analysis")
def run_analysis(sid: str, req: AnalysisRequest) -> Dict[str, Any]:
    s = _require_session(sid)
    layout = req.layout.to_layout() if req.layout else layout_for(s)[0]
    out = _analyse(s, layout, subtract_blank=req.subtract_blank, fit_4pl=req.fit_4pl)
    stored = {**out, "groups": [
        {**g, "fit": {k: v for k, v in (g["fit"] or {}).items() if not k.startswith("curve_")} or None} for g in out["groups"]
    ]}
    record(sid, "mic_plate", {"layout": layout.to_dict(), "subtract_blank": req.subtract_blank, "fit_4pl": req.fit_4pl}, stored)
    return out


@router.get("/sessions/{sid}/workbook")
def download_workbook(sid: str, subtract_blank: bool = Query(True)) -> Response:
    s = _require_session(sid)
    layout = layout_for(s)[0]
    analysis = _analyse(s, layout, subtract_blank=subtract_blank, fit_4pl=False)
    content = build_workbook(s.read, layout, analysis, subtract_blank=subtract_blank)
    stem = re.sub(r"[^\w\-.]", "_", s.display_name.rsplit(".", 1)[0]) or "plate"
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{stem}_calculation.xlsx"'},
    )


class TemplateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    layout: LayoutModel


@router.get("/templates")
def get_templates() -> List[Dict[str, Any]]:
    return list_plate_templates()


@router.post("/templates")
def post_template(body: TemplateRequest) -> Dict[str, Any]:
    return save_plate_template(body.name.strip(), body.layout.model_dump())


@router.delete("/templates/{template_id}")
def remove_template(template_id: str) -> Dict[str, bool]:
    if not delete_plate_template(template_id):
        raise HTTPException(status_code=404, detail="template not found")
    return {"deleted": True}


@router.get("/experiments/{tag}")
def get_experiment(tag: str, subtract_blank: bool = Query(True)) -> Dict[str, Any]:
    plates = []
    for rec in list_session_records(module="plate_reader", experiment_tag=tag):
        s = registry.get(rec["session_id"])
        if s is None:
            continue
        layout, source = layout_for(s)
        plates.append({
            "session_id": s.session_id,
            "display_name": s.display_name,
            "metadata": s.read.metadata,
            "layout_source": source,
            "analysis": _analyse(s, layout, subtract_blank=subtract_blank, fit_4pl=False),
        })
    return {"experiment_tag": tag, "plates": plates}


@router.delete("/sessions/{sid}")
def delete_session(sid: str) -> Dict[str, bool]:
    if not registry.remove(sid):
        raise HTTPException(status_code=404, detail="session not found")
    return {"deleted": True}
