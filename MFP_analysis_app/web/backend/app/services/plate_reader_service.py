"""Plate Reader service: plate sessions (one 8x12 read per file) and their layouts.

Plates are parsed with `lab_gui.plate_gen5` (BioTek Gen5 exports or any labelled 8x12 grid) and
analysed with `lab_gui.plate_mic` from a plate layout saved on the session record.
"""
from __future__ import annotations

import threading
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional

from lab_gui.plate_gen5 import PlateRead, parse_layout_notes, read_plate
from lab_gui.plate_mic import PlateLayout, layout_from_suggestions


@dataclass
class PlateSession:
    session_id: str
    display_name: str
    path: Path
    read: PlateRead
    workspace_id: str = "general"


def layout_for(session: PlateSession) -> tuple[PlateLayout, str]:
    """The saved layout, else one suggested from the Gen5 notes, else an empty layout."""
    from ..db import get_session_record

    rec = get_session_record(session.session_id)
    saved = (rec or {}).get("extra", {}).get("layout")
    if saved:
        return PlateLayout.from_dict(saved), "saved"
    suggestions = parse_layout_notes(session.read.notes)
    if suggestions:
        return layout_from_suggestions(suggestions), "notes"
    return PlateLayout(), "empty"


def save_layout(session: PlateSession, layout: PlateLayout) -> None:
    from ..db import get_session_record, save_session_record

    rec = get_session_record(session.session_id) or {}
    extra = dict(rec.get("extra") or {})
    extra["layout"] = layout.to_dict()
    save_session_record(
        session.session_id, session.workspace_id, "plate_reader", session.display_name, str(session.path), extra=extra,
    )


class PlateReaderRegistry:
    def __init__(self) -> None:
        self._sessions: Dict[str, PlateSession] = {}
        self._lock = threading.Lock()

    def add_from_path(self, path: Path, *, workspace_id: str = "general", display_name: Optional[str] = None) -> PlateSession:
        read = read_plate(path)  # raises PlateReadError before anything is registered
        session = PlateSession(uuid.uuid4().hex, display_name or path.name, path, read, workspace_id)
        with self._lock:
            self._sessions[session.session_id] = session
        from ..db import save_session_record

        save_session_record(session.session_id, workspace_id, "plate_reader", session.display_name, str(path), extra={})
        return session

    def restore_from_path(self, session_id: str, path: Path, *, workspace_id: str = "general",
                          display_name: Optional[str] = None) -> PlateSession:
        session = PlateSession(session_id, display_name or path.name, path, read_plate(path), workspace_id)
        with self._lock:
            self._sessions[session_id] = session
        return session

    def get(self, sid: str) -> Optional[PlateSession]:
        with self._lock:
            state = self._sessions.get(sid)
        if state is not None:
            return state
        from ..db import get_session_record

        rec = get_session_record(sid)
        if rec and rec.get("module") == "plate_reader":
            return self._restore_record(rec)
        return None

    def _restore_record(self, rec: Dict[str, Any]) -> Optional[PlateSession]:
        from ..db import clear_restore_error, record_restore_error

        p = Path(rec["file_path"])
        if not p.exists():
            record_restore_error(rec, f"File not found: {p.name}")
            return None
        try:
            restored = self.restore_from_path(
                rec["session_id"], p, workspace_id=rec.get("workspace_id", "general"), display_name=rec.get("display_name"),
            )
        except Exception as exc:  # noqa: BLE001 - any parser failure is reported, not raised
            record_restore_error(rec, f"Could not load {p.name}: {exc}", exc)
            return None
        clear_restore_error(rec["session_id"])
        return restored

    def remove(self, sid: str) -> bool:
        from ..db import delete_session_record, get_session_record, remove_unreferenced_files

        rec = get_session_record(sid)
        delete_session_record(sid)
        if rec:
            remove_unreferenced_files(rec)
        with self._lock:
            in_memory = self._sessions.pop(sid, None) is not None
        return in_memory or rec is not None

    def list(self, workspace_id: Optional[str] = None) -> List[PlateSession]:
        from ..db import list_session_records

        for rec in list_session_records(workspace_id=workspace_id, module="plate_reader"):
            with self._lock:
                already = rec["session_id"] in self._sessions
            if not already:
                self._restore_record(rec)
        with self._lock:
            if workspace_id:
                return [s for s in self._sessions.values() if s.workspace_id == workspace_id]
            return list(self._sessions.values())


registry = PlateReaderRegistry()
