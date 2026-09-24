import sqlite3
import tarfile
from datetime import datetime, timedelta, timezone

from app.backup import backup_due, snapshot_databases, write_archive


def _make_db(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.execute("CREATE TABLE t (v TEXT)")
    conn.execute("INSERT INTO t VALUES (?)", (value,))
    conn.commit()
    return conn


def _read(path):
    with sqlite3.connect(path) as conn:
        return [r[0] for r in conn.execute("SELECT v FROM t")]


def test_snapshot_copies_every_database_consistently_while_open(tmp_path):
    data = tmp_path / "data"
    open_conn = _make_db(data / "mfp_database.db", "main")
    _make_db(data / "automation" / "action_log.sqlite3", "log").close()
    _make_db(data / "cache" / "ignored.db", "cache").close()

    snap = snapshot_databases(data)

    assert _read(snap / "mfp_database.db") == ["main"]
    assert _read(snap / "automation" / "action_log.sqlite3") == ["log"]
    assert not (snap / "cache").exists()
    open_conn.close()


def test_snapshots_keep_only_the_newest(tmp_path):
    data = tmp_path / "data"
    _make_db(data / "mfp_database.db", "x").close()
    start = datetime(2026, 1, 1, tzinfo=timezone.utc)
    for day in range(5):
        snapshot_databases(data, keep=3, now=start + timedelta(days=day))

    (data / "backups" / "db-20260106-000000.partial").mkdir()  # left by an interrupted run
    assert not backup_due(data, start + timedelta(days=4, hours=1))
    names = sorted(p.name for p in (data / "backups").iterdir() if not p.name.endswith(".partial"))
    assert names == ["db-20260103-000000", "db-20260104-000000", "db-20260105-000000"]


def test_backup_due_after_a_day(tmp_path):
    data = tmp_path / "data"
    _make_db(data / "mfp_database.db", "x").close()
    now = datetime(2026, 1, 2, 12, tzinfo=timezone.utc)
    assert backup_due(data, now)
    snapshot_databases(data, now=now)
    assert not backup_due(data, now + timedelta(hours=23))
    assert backup_due(data, now + timedelta(hours=24))


def test_archive_holds_databases_and_uploads_but_not_caches_or_backups(tmp_path):
    data = tmp_path / "data"
    _make_db(data / "mfp_database.db", "main").close()
    (data / "uploads" / "lcms" / "mzml").mkdir(parents=True)
    (data / "uploads" / "lcms" / "mzml" / "run.abc.mzML").write_text("<mzML/>")
    (data / "cache" / "lcms_index").mkdir(parents=True)
    (data / "cache" / "lcms_index" / "x.peaks.mz.f64").write_bytes(b"0" * 8)
    snapshot_databases(data)

    out = write_archive(data, tmp_path / "out.tar.gz")

    with tarfile.open(out) as tar:
        names = set(tar.getnames())
        assert "mfp_database.db" in names
        assert "uploads/lcms/mzml/run.abc.mzML" in names
        assert not any(n.startswith(("cache", "backups")) for n in names)
        tar.extract("mfp_database.db", tmp_path / "restored", filter="data")
    assert _read(tmp_path / "restored" / "mfp_database.db") == ["main"]
