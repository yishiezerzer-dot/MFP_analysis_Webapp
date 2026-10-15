"""In-process background jobs: one at a time, cancellable, progress and log stored in the jobs table.

A job function gets a JobContext and reports through ctx.progress(fraction, step) and ctx.log(msg);
progress() also raises JobCancelled once the job has been cancelled, which is how cancelling
stops the work. Outputs go under MFP_DATA_DIR/<kind>/<job_id>/.
"""
from __future__ import annotations

import logging
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Dict, Optional

from ..db import create_job, fail_unfinished_jobs, get_data_dir, get_job, update_job

log = logging.getLogger("mfp.jobs")


class JobCancelled(Exception):
    pass


@dataclass
class JobContext:
    job_id: str
    output_dir: Path
    _cancel: threading.Event

    @property
    def cancelled(self) -> bool:
        return self._cancel.is_set()

    def progress(self, fraction: float, step: str) -> None:
        if self._cancel.is_set():
            raise JobCancelled()
        update_job(self.job_id, progress=round(max(0.0, min(1.0, float(fraction))), 4), step=step)

    def log(self, message: str) -> None:
        update_job(self.job_id, log=message)


JobFunction = Callable[[JobContext], Optional[Dict[str, Any]]]


class JobManager:
    def __init__(self, max_workers: int = 1) -> None:
        self._pool = ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="mfp-job")
        self._cancel: Dict[str, threading.Event] = {}
        self._lock = threading.Lock()
        try:
            n = fail_unfinished_jobs("The server restarted while this job was running; run it again.")
            if n:
                log.info("Marked %d interrupted job(s) as failed", n)
        except Exception:  # noqa: BLE001 - never block startup on bookkeeping
            log.exception("Could not mark interrupted jobs")

    def submit(self, kind: str, fn: JobFunction, *, params: Dict[str, Any], workspace_id: str, session_id: Optional[str] = None) -> str:
        job_id = uuid.uuid4().hex[:16]
        output_dir = get_data_dir() / kind / job_id
        output_dir.mkdir(parents=True, exist_ok=True)
        create_job(job_id, kind, params=params, workspace_id=workspace_id, output_dir=str(output_dir), session_id=session_id)
        event = threading.Event()
        with self._lock:
            self._cancel[job_id] = event
        self._pool.submit(self._run, JobContext(job_id, output_dir, event), fn)
        return job_id

    def _run(self, ctx: JobContext, fn: JobFunction) -> None:
        try:
            if ctx.cancelled:
                update_job(ctx.job_id, status="cancelled", step="Cancelled", log="Cancelled before it started.")
                return
            update_job(ctx.job_id, status="running", step="Starting", log="Started.")
            extra = fn(ctx) or {}
            update_job(ctx.job_id, status="done", progress=1.0, step="Done", log="Finished.", **extra)
        except JobCancelled:
            update_job(ctx.job_id, status="cancelled", step="Cancelled", log="Cancelled.")
        except Exception as exc:  # noqa: BLE001 - the job's failure is reported to the user, not raised
            log.exception("Job %s failed", ctx.job_id)
            message = getattr(exc, "detail", None) or str(exc) or exc.__class__.__name__
            update_job(ctx.job_id, status="failed", error=str(message), log=f"Failed: {message}")
        finally:
            with self._lock:
                self._cancel.pop(ctx.job_id, None)

    def cancel(self, job_id: str) -> bool:
        """Ask a queued or running job to stop; False when it is unknown or already finished."""
        job = get_job(job_id)
        if job is None or job["status"] not in ("queued", "running"):
            return False
        with self._lock:
            event = self._cancel.get(job_id)
        if event is not None:
            event.set()
        if job["status"] == "queued":
            update_job(job_id, status="cancelled", step="Cancelled", log="Cancelled before it started.")
        return True


_manager: Optional[JobManager] = None
_manager_lock = threading.Lock()


def job_manager() -> JobManager:
    global _manager
    with _manager_lock:
        if _manager is None:
            _manager = JobManager()
        return _manager
