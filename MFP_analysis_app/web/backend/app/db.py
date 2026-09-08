"""SQLite database and persistence management for MFP Analysis Web.

Provides storage for:
- Workspaces / Lab Member profiles
- Session records across all modules (surviving server restarts)
- Active module analysis states (auto-save and restore)
"""
from __future__ import annotations

import json
import os
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

_PROJECT_ROOT = Path(__file__).resolve().parents[3]

def get_data_dir() -> Path:
    """Resolve persistent data directory.

    Priority:
    1. MFP_DATA_DIR environment variable
    2. /data (standard Railway mounted volume)
    3. .data directory in project root
    """
    env_dir = os.environ.get("MFP_DATA_DIR")
    if env_dir:
        p = Path(env_dir)
    elif Path("/data").is_dir():
        p = Path("/data")
    else:
        p = _PROJECT_ROOT / ".data"
    p.mkdir(parents=True, exist_ok=True)
    return p


def get_upload_dir(module: str) -> Path:
    """Return upload directory for a specific module."""
    upload_dir = get_data_dir() / "uploads" / module
    upload_dir.mkdir(parents=True, exist_ok=True)
    return upload_dir


_DB_LOCK = threading.Lock()
_INITIALIZED_PATHS: set[str] = set()


def _init_db_locked(conn: sqlite3.Connection) -> None:
    """Create schema and seed default workspaces."""
    with conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS workspaces (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                created_at TEXT NOT NULL,
                last_active_at TEXT NOT NULL
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS sessions (
                session_id TEXT PRIMARY KEY,
                workspace_id TEXT NOT NULL,
                module TEXT NOT NULL,
                display_name TEXT NOT NULL,
                file_path TEXT NOT NULL,
                extra_json TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
            )
        """)
        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_sessions_ws_mod 
            ON sessions(workspace_id, module)
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS workspace_state (
                workspace_id TEXT NOT NULL,
                module TEXT NOT NULL,
                state_json TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (workspace_id, module),
                FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
            )
        """)

        # Seed default workspace if empty
        cur = conn.execute("SELECT COUNT(*) as cnt FROM workspaces")
        if cur.fetchone()["cnt"] == 0:
            now = datetime.now(timezone.utc).isoformat()
            conn.execute(
                "INSERT INTO workspaces (id, name, created_at, last_active_at) VALUES (?, ?, ?, ?)",
                ("general", "General Lab", now, now),
            )
            conn.execute(
                "INSERT INTO workspaces (id, name, created_at, last_active_at) VALUES (?, ?, ?, ?)",
                ("yishi", "Yishi", now, now),
            )


def get_db_connection() -> sqlite3.Connection:
    db_path = get_data_dir() / "mfp_database.db"
    conn = sqlite3.connect(str(db_path), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    path_key = str(db_path)
    if path_key not in _INITIALIZED_PATHS:
        _init_db_locked(conn)
        _INITIALIZED_PATHS.add(path_key)
    return conn


def init_db() -> None:
    """Initialize database schema and default workspaces."""
    with _DB_LOCK:
        conn = get_db_connection()
        conn.close()


# --- Workspace CRUD -----------------------------------------------------------


def list_workspaces() -> List[Dict[str, Any]]:
    with _DB_LOCK:
        conn = get_db_connection()
        try:
            cur = conn.execute("""
                SELECT w.id, w.name, w.created_at, w.last_active_at,
                       COUNT(s.session_id) as session_count
                FROM workspaces w
                LEFT JOIN sessions s ON w.id = s.workspace_id
                GROUP BY w.id
                ORDER BY w.last_active_at DESC, w.name ASC
            """)
            return [dict(row) for row in cur.fetchall()]
        finally:
            conn.close()


def get_workspace(workspace_id: str) -> Optional[Dict[str, Any]]:
    with _DB_LOCK:
        conn = get_db_connection()
        try:
            cur = conn.execute(
                "SELECT id, name, created_at, last_active_at FROM workspaces WHERE id = ?",
                (workspace_id,),
            )
            row = cur.fetchone()
            return dict(row) if row else None
        finally:
            conn.close()


def create_workspace(workspace_id: str, name: str) -> Dict[str, Any]:
    now = datetime.now(timezone.utc).isoformat()
    with _DB_LOCK:
        conn = get_db_connection()
        try:
            with conn:
                conn.execute(
                    "INSERT INTO workspaces (id, name, created_at, last_active_at) VALUES (?, ?, ?, ?)",
                    (workspace_id, name, now, now),
                )
            return {"id": workspace_id, "name": name, "created_at": now, "last_active_at": now, "session_count": 0}
        finally:
            conn.close()


def touch_workspace(workspace_id: str) -> None:
    now = datetime.now(timezone.utc).isoformat()
    with _DB_LOCK:
        conn = get_db_connection()
        try:
            with conn:
                conn.execute(
                    "UPDATE workspaces SET last_active_at = ? WHERE id = ?",
                    (now, workspace_id),
                )
        finally:
            conn.close()


# --- Sessions DB Persistence --------------------------------------------------


def save_session_record(
    session_id: str,
    workspace_id: str,
    module: str,
    display_name: str,
    file_path: str,
    extra: Optional[Dict[str, Any]] = None,
) -> None:
    now = datetime.now(timezone.utc).isoformat()
    extra_json = json.dumps(extra or {})
    with _DB_LOCK:
        conn = get_db_connection()
        try:
            with conn:
                conn.execute(
                    """
                    INSERT INTO sessions (session_id, workspace_id, module, display_name, file_path, extra_json, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(session_id) DO UPDATE SET
                        display_name = excluded.display_name,
                        file_path = excluded.file_path,
                        extra_json = excluded.extra_json,
                        updated_at = excluded.updated_at
                    """,
                    (session_id, workspace_id, module, display_name, file_path, extra_json, now, now),
                )
        finally:
            conn.close()


def delete_session_record(session_id: str) -> None:
    with _DB_LOCK:
        conn = get_db_connection()
        try:
            with conn:
                conn.execute("DELETE FROM sessions WHERE session_id = ?", (session_id,))
        finally:
            conn.close()


def get_session_record(session_id: str) -> Optional[Dict[str, Any]]:
    with _DB_LOCK:
        conn = get_db_connection()
        try:
            cur = conn.execute(
                "SELECT session_id, workspace_id, module, display_name, file_path, extra_json, created_at, updated_at FROM sessions WHERE session_id = ?",
                (session_id,),
            )
            row = cur.fetchone()
            if not row:
                return None
            d = dict(row)
            d["extra"] = json.loads(d.get("extra_json") or "{}")
            return d
        finally:
            conn.close()


def list_session_records(workspace_id: Optional[str] = None, module: Optional[str] = None) -> List[Dict[str, Any]]:
    query = "SELECT session_id, workspace_id, module, display_name, file_path, extra_json, created_at, updated_at FROM sessions WHERE 1=1"
    params: List[Any] = []
    if workspace_id:
        query += " AND workspace_id = ?"
        params.append(workspace_id)
    if module:
        query += " AND module = ?"
        params.append(module)
    query += " ORDER BY created_at DESC"

    with _DB_LOCK:
        conn = get_db_connection()
        try:
            cur = conn.execute(query, params)
            results = []
            for row in cur.fetchall():
                d = dict(row)
                d["extra"] = json.loads(d.get("extra_json") or "{}")
                results.append(d)
            return results
        finally:
            conn.close()


# --- Workspace Module State (Auto-save / Restore) -----------------------------


def save_workspace_state(workspace_id: str, module: str, state: Dict[str, Any]) -> None:
    now = datetime.now(timezone.utc).isoformat()
    state_json = json.dumps(state)
    with _DB_LOCK:
        conn = get_db_connection()
        try:
            with conn:
                conn.execute(
                    """
                    INSERT INTO workspace_state (workspace_id, module, state_json, updated_at)
                    VALUES (?, ?, ?, ?)
                    ON CONFLICT(workspace_id, module) DO UPDATE SET
                        state_json = excluded.state_json,
                        updated_at = excluded.updated_at
                    """,
                    (workspace_id, module, state_json, now),
                )
        finally:
            conn.close()


def get_workspace_state(workspace_id: str, module: str) -> Optional[Dict[str, Any]]:
    with _DB_LOCK:
        conn = get_db_connection()
        try:
            cur = conn.execute(
                "SELECT state_json FROM workspace_state WHERE workspace_id = ? AND module = ?",
                (workspace_id, module),
            )
            row = cur.fetchone()
            if not row:
                return None
            return json.loads(row["state_json"])
        finally:
            conn.close()
