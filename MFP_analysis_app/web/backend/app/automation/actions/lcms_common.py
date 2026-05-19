"""Shared helpers for LCMS automation actions."""
from __future__ import annotations

from typing import Any, Dict, Optional

from ...services.lcms_service import LCMSSessionState, registry
from ..registry import SessionNotFound


def get_lcms_session(session_id: str) -> LCMSSessionState:
    state = registry.get(session_id)
    if state is None:
        raise SessionNotFound("session not found")
    return state


def uv_summary(state: LCMSSessionState) -> Dict[str, Any]:
    uv = state.uv
    if uv is None:
        return {"available": False}
    return {
        "available": True,
        "filename": uv.filename,
        "path": str(uv.path),
        "n_points": int(uv.rt_min.size),
        "rt_min": float(uv.rt_range[0]),
        "rt_max": float(uv.rt_range[1]),
        "x_col": uv.x_col,
        "y_col": uv.y_col,
        "x_label": uv.x_label,
        "y_label": uv.y_label,
        "unit_guess": uv.unit_guess,
        "warnings": list(uv.warnings),
    }


def session_summary(state: LCMSSessionState) -> Dict[str, Any]:
    metas = state.index.ms1
    rts = [float(m.rt_min) for m in metas]
    polarities = sorted({m.polarity for m in metas if m.polarity})
    return {
        "session_id": state.session_id,
        "display_name": state.display_name,
        "path": str(state.path),
        "ms1_count": len(metas),
        "rt_min": float(min(rts)) if rts else None,
        "rt_max": float(max(rts)) if rts else None,
        "polarities": polarities,
        "stats": {k: v for k, v in state.index.stats.items()},
        "uv": uv_summary(state),
    }


def tic_payload(state: LCMSSessionState, polarity: Optional[str] = None) -> Dict[str, Any]:
    metas = state.index.ms1
    if polarity in ("positive", "negative"):
        metas = [m for m in metas if m.polarity == polarity]
    return {
        "session_id": state.session_id,
        "display_name": state.display_name,
        "rt_min": [float(m.rt_min) for m in metas],
        "tic": [float(m.tic) for m in metas],
        "polarity": [m.polarity for m in metas],
    }

