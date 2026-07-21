import tempfile
from pathlib import Path
from typing import Optional

import httpx
from fastapi import File, Form, HTTPException, UploadFile

from .blob_store import blob_enabled, download_bytes, filename_from_blob_url

VERCEL_PAYLOAD_LIMIT = 4 * 1024 * 1024


async def read_upload_bytes(
    file: Optional[UploadFile],
    blob_url: Optional[str],
    blob_filename: Optional[str],
    *,
    field_name: str = "file",
) -> tuple[bytes, str]:
    if blob_url:
        name = blob_filename or filename_from_blob_url(blob_url)
        try:
            data = await download_bytes(blob_url)
        except httpx.HTTPError as exc:
            raise HTTPException(status_code=400, detail=f"Failed to download blob: {exc}") from exc
        return data, name

    if file is None:
        raise HTTPException(
            status_code=400,
            detail=f"{field_name} or blob_url is required.",
        )

    name = file.filename or "upload.bin"
    data = await file.read()
    if len(data) > VERCEL_PAYLOAD_LIMIT and not blob_enabled():
        raise HTTPException(
            status_code=413,
            detail="File is too large for this deployment's upload limit.",
        )
    return data, name
