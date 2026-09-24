"""Backups of the data directory.

Nightly: consistent SQLite snapshots in <data>/backups (small; uploads are never rewritten, so
they need an off-site copy rather than versions). On demand: `python -m app.backup OUT.tar.gz`
writes the databases plus all uploads into one archive to copy off the server.
"""
from __future__ import annotations

import logging
import shutil
import sqlite3
import sys
import tarfile
import tempfile
import threading
from contextlib import closing
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

from .db import get_data_dir

_log = logging.getLogger("mfp.backup")
_SKIP_DIRS = {"backups", "cache"}
_PREFIX = "db-"
_STAMP = "%Y%m%d-%H%M%S"
_INTERVAL = timedelta(days=1)


def _databases(data_dir: Path) -> list[Path]:
    found = []
    for pattern in ("*.db", "*.sqlite3"):
        for p in data_dir.rglob(pattern):
            if p.relative_to(data_dir).parts[0] not in _SKIP_DIRS:
                found.append(p)
    return sorted(found)


def _copy_db(src: Path, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    # The backup API gives a consistent copy even while the app is writing.
    with closing(sqlite3.connect(src)) as s, closing(sqlite3.connect(dest)) as d:
        s.backup(d)


def _snapshots(data_dir: Path) -> list[Path]:
    root = data_dir / "backups"
    return sorted(p for p in root.glob(_PREFIX + "*") if p.is_dir() and not p.name.endswith(".partial")) if root.is_dir() else []


def snapshot_databases(data_dir: Path, keep: int = 7, now: Optional[datetime] = None) -> Path:
    now = now or datetime.now(timezone.utc)
    target = data_dir / "backups" / f"{_PREFIX}{now.strftime(_STAMP)}"
    tmp = target.with_name(target.name + ".partial")
    shutil.rmtree(tmp, ignore_errors=True)
    for db in _databases(data_dir):
        _copy_db(db, tmp / db.relative_to(data_dir))
    tmp.mkdir(parents=True, exist_ok=True)
    tmp.rename(target)
    for old in _snapshots(data_dir)[:-keep]:
        shutil.rmtree(old, ignore_errors=True)
    return target


def backup_due(data_dir: Path, now: datetime) -> bool:
    snaps = _snapshots(data_dir)
    if not snaps:
        return True
    last = datetime.strptime(snaps[-1].name[len(_PREFIX):], _STAMP).replace(tzinfo=timezone.utc)
    return now - last >= _INTERVAL


def write_archive(data_dir: Path, out_path: Path) -> Path:
    with tempfile.TemporaryDirectory() as tmp:
        with tarfile.open(out_path, "w:gz") as tar:
            for db in _databases(data_dir):
                rel = db.relative_to(data_dir)
                _copy_db(db, Path(tmp) / rel)
                tar.add(Path(tmp) / rel, arcname=rel.as_posix())
            uploads = data_dir / "uploads"
            if uploads.is_dir():
                tar.add(uploads, arcname="uploads")
    return out_path


def _nightly_loop(stop: threading.Event) -> None:
    while not stop.is_set():
        data_dir = get_data_dir()
        if backup_due(data_dir, datetime.now(timezone.utc)):
            try:
                _log.info("Database snapshot written to %s", snapshot_databases(data_dir))
            except Exception:
                _log.exception("Database snapshot failed")
        stop.wait(3600)


def start_nightly_backups() -> threading.Event:
    stop = threading.Event()
    threading.Thread(target=_nightly_loop, args=(stop,), name="mfp-backup", daemon=True).start()
    return stop


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: python -m app.backup OUT.tar.gz")
    print(write_archive(get_data_dir(), Path(sys.argv[1])))
