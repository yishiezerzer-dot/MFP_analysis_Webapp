"""Provenance for analysis results: which input file, which settings, which app version."""
from __future__ import annotations

import functools
import hashlib
import json
import os
import subprocess
from pathlib import Path
from typing import Any, Dict, Optional

from .db import get_session_record, save_result, save_session_record

APP_VERSION = "0.1.0"


@functools.lru_cache(maxsize=1)
def _git_sha_from_checkout() -> str:
    try:
        out = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=Path(__file__).resolve().parent,
            capture_output=True,
            text=True,
            timeout=5,
        )
        return out.stdout.strip() if out.returncode == 0 else ""
    except (OSError, subprocess.SubprocessError):
        return ""


def app_version() -> str:
    """e.g. "0.1.0+abcdef1". Railway sets RAILWAY_GIT_COMMIT_SHA; MFP_GIT_SHA overrides it."""
    sha = os.environ.get("MFP_GIT_SHA") or os.environ.get("RAILWAY_GIT_COMMIT_SHA") or _git_sha_from_checkout()
    return f"{APP_VERSION}+{sha[:7]}" if sha else f"{APP_VERSION}+unknown"


def session_input_sha256(record: Dict[str, Any]) -> Optional[str]:
    """Full SHA-256 of the session's input file, computed once and stored in the session record."""
    extra = dict(record.get("extra") or {})
    if extra.get("sha256"):
        return str(extra["sha256"])
    path = Path(record["file_path"])
    if not path.is_file():
        return None
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(chunk)
    extra["sha256"] = digest.hexdigest()
    save_session_record(
        record["session_id"], record["workspace_id"], record["module"], record["display_name"], record["file_path"], extra
    )
    return extra["sha256"]


def record(session_id: str, kind: str, params: Dict[str, Any], result: Dict[str, Any]) -> None:
    """Store one analysis result with its provenance. Never raises: recording must not break analyses."""
    try:
        rec = get_session_record(session_id)
        if rec is None:
            return
        canonical = json.dumps(params, sort_keys=True, default=str)
        save_result(
            session_id=session_id,
            workspace_id=rec["workspace_id"],
            module=rec["module"],
            kind=kind,
            params_hash=hashlib.sha256(canonical.encode()).hexdigest(),
            params=params,
            result=result,
            input_name=rec.get("display_name"),
            input_sha256=session_input_sha256(rec),
            app_version=app_version(),
        )
    except Exception:  # noqa: BLE001
        import logging

        logging.getLogger("mfp.provenance").warning("Could not record %s result for %s", kind, session_id, exc_info=True)
