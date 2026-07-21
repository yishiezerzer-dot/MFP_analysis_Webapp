import json
import os
import re
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse

import httpx

BLOB_TOKEN = os.environ.get("BLOB_READ_WRITE_TOKEN", "")
_BLOB_API = "https://blob.vercel-storage.com"


def blob_enabled() -> bool:
    return bool(BLOB_TOKEN)


def _safe_segment(value: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9._-]+", "_", value.strip())
    return cleaned or "file"


async def download_bytes(url: str) -> bytes:
    async with httpx.AsyncClient(timeout=300, follow_redirects=True) as client:
        response = await client.get(url)
        response.raise_for_status()
        return response.content


def filename_from_blob_url(url: str, fallback: str = "upload.bin") -> str:
    path = unquote(urlparse(url).path)
    name = Path(path).name
    return name or fallback


async def put_json(key: str, payload: dict[str, Any]) -> str | None:
    if not BLOB_TOKEN:
        return None
    pathname = key.lstrip("/")
    async with httpx.AsyncClient(timeout=60) as client:
        response = await client.put(
            f"{_BLOB_API}/{pathname}",
            content=json.dumps(payload).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {BLOB_TOKEN}",
                "Content-Type": "application/json",
                "x-vercel-blob-access": "public",
            },
        )
        response.raise_for_status()
        body = response.json()
        return str(body.get("url") or "")


async def get_json(key: str) -> dict[str, Any] | None:
    if not BLOB_TOKEN:
        return None
    pathname = key.lstrip("/")
    url = f"{_BLOB_API}/{pathname}"
    async with httpx.AsyncClient(timeout=60) as client:
        response = await client.get(
            url,
            headers={"Authorization": f"Bearer {BLOB_TOKEN}"},
        )
        if response.status_code == 404:
            return None
        response.raise_for_status()
        return response.json()


def manifest_key(module: str, session_id: str) -> str:
    return f"mfp-sessions/{_safe_segment(module)}/{_safe_segment(session_id)}.json"
