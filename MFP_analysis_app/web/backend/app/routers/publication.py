"""Publication API: Journal figure builder, vector PDF generator, and SI package packager."""
from __future__ import annotations

import base64
import io
import json
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, HTTPException, Query, Response
from pydantic import BaseModel, Field

from reportlab.lib import pagesizes
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader
from PIL import Image

router = APIRouter()

JOURNAL_PRESETS: Dict[str, Dict[str, float]] = {
    "acs_single": {"width_mm": 82.5, "height_mm": 60.0, "columns": 1},
    "acs_double": {"width_mm": 177.8, "height_mm": 100.0, "columns": 2},
    "nature_single": {"width_mm": 89.0, "height_mm": 60.0, "columns": 1},
    "nature_double": {"width_mm": 180.0, "height_mm": 100.0, "columns": 2},
    "rsc_single": {"width_mm": 83.0, "height_mm": 60.0, "columns": 1},
    "rsc_double": {"width_mm": 171.0, "height_mm": 100.0, "columns": 2},
}


class PanelSpec(BaseModel):
    panel_label: str = "a"
    title: Optional[str] = None
    image_data: Optional[str] = None  # base64 data URI or raw base64 string
    caption: Optional[str] = None
    source_module: Optional[str] = None


class FigureRenderRequest(BaseModel):
    title: Optional[str] = "Multi-Panel Analytical Figure"
    journal_preset: str = "nature_double"
    width_mm: Optional[float] = None
    height_mm: Optional[float] = None
    layout_columns: Optional[int] = None
    font_family: str = "Helvetica"
    panels: List[PanelSpec] = Field(default_factory=list)


def _decode_image(data_uri: str) -> Optional[Image.Image]:
    """Decode a base64 data URI into a PIL Image."""
    if not data_uri:
        return None
    try:
        if "," in data_uri:
            b64 = data_uri.split(",", 1)[1]
        else:
            b64 = data_uri
        raw_bytes = base64.b64decode(b64)
        return Image.open(io.BytesIO(raw_bytes))
    except Exception:
        return None


@router.post("/render-figure-pdf")
def render_figure_pdf(req: FigureRenderRequest) -> Response:
    """Render a multi-panel figure into a publication-ready Vector PDF with embedded typography."""
    preset = JOURNAL_PRESETS.get(req.journal_preset)
    width = (req.width_mm if req.width_mm else (preset["width_mm"] if preset else 180.0)) * mm
    height = (req.height_mm if req.height_mm else (preset["height_mm"] if preset else 120.0)) * mm
    columns = req.layout_columns if req.layout_columns else (preset["columns"] if preset else 2)

    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(width, height))
    c.setTitle(req.title or "Figure")

    margin = 5.0 * mm
    usable_width = width - (2 * margin)
    usable_height = height - (2 * margin)

    num_panels = max(len(req.panels), 1)
    rows = (num_panels + columns - 1) // columns
    cell_w = usable_width / columns
    cell_h = usable_height / rows

    for idx, panel in enumerate(req.panels):
        r = idx // columns
        col = idx % columns

        x0 = margin + col * cell_w
        y0 = height - margin - (r + 1) * cell_h

        # Panel content margin
        px = x0 + 2.0 * mm
        py = y0 + 2.0 * mm
        pw = cell_w - 4.0 * mm
        ph = cell_h - 4.0 * mm

        # Draw panel image if provided
        img = _decode_image(panel.image_data) if panel.image_data else None
        if img:
            img_buf = io.BytesIO()
            img.save(img_buf, format="PNG")
            img_buf.seek(0)
            img_reader = ImageReader(img_buf)

            # Fit image within (pw, ph - 5mm for label)
            avail_h = max(ph - 4.0 * mm, 10.0 * mm)
            aspect = img.width / max(img.height, 1)
            target_w = pw
            target_h = target_w / aspect
            if target_h > avail_h:
                target_h = avail_h
                target_w = target_h * aspect

            c.drawImage(img_reader, px, py, width=target_w, height=target_h, preserveAspectRatio=True)
        else:
            # Draw scientific bounding box frame
            c.setStrokeColorRGB(0.7, 0.7, 0.7)
            c.setLineWidth(0.75)
            c.rect(px, py, pw, ph, stroke=1, fill=0)
            if panel.title:
                c.setFont(f"{req.font_family}", 8)
                c.setFillColorRGB(0.4, 0.4, 0.4)
                c.drawString(px + 4.0 * mm, py + ph / 2, panel.title)

        # Draw bold scientific panel tag: e.g. "a", "b", "c"
        c.setFont(f"{req.font_family}-Bold", 10)
        c.setFillColorRGB(0.1, 0.1, 0.1)
        tag_text = panel.panel_label.strip() or chr(ord("a") + idx)
        c.drawString(px + 1.0 * mm, py + ph - 3.5 * mm, tag_text)

    c.showPage()
    c.save()
    buf.seek(0)

    return Response(
        content=buf.getvalue(),
        media_type="application/pdf",
        headers={"Content-Disposition": "inline; filename=figure.pdf"},
    )


@router.post("/si-package")
def generate_si_package() -> Response:
    # Disabled: the previous implementation wrote placeholder numbers and a fixed methods text
    # instead of the user's actual results. Rebuilt from stored analysis results in plan.md Phase 5.
    raise HTTPException(
        status_code=410,
        detail="The SI package export is temporarily disabled while it is rebuilt to use real analysis results.",
    )
